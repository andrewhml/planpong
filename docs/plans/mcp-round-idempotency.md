# MCP Round Idempotency

**Status:** Draft
**planpong:** R0/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | Awaiting review

## Context

The MCP flow is split across separate tools:

1. `planpong_start_review` creates a session and writes the initial status line.
2. `planpong_get_feedback` advances `session.currentRound`, invokes the reviewer, writes `round-N-feedback.json`, and updates status.
3. `planpong_revise` or `planpong_record_revision` records the planner response and updates the plan.

That split is the right interface for Claude Code, but the current state transitions are not fully idempotent. `planpong_get_feedback` increments `session.currentRound` before the reviewer call. If the provider fails, the MCP client retries, or the process dies after incrementing but before feedback is written, the next call can skip a round. `planpong_revise` has no `expected_round` input, so a stale or repeated tool call can invoke the planner again before the existing finalization guard has a chance to help. `planpong_record_revision` has better duplicate protection through `expected_round`, but its mismatch response always says the round was already finalized even when the session is actually behind or otherwise inconsistent.

The existing `finalizeRevision` helper is a good base: it treats `round-N-response.json` as an idempotency key and makes response persistence the stable artifact. This plan extends that principle to the whole MCP round lifecycle:

- The session file tracks the current workflow state, but round artifacts are the durable source of truth.
- Calling a tool twice for the same completed step returns the already-written artifact instead of repeating model work.
- Advancing a round becomes a committed transition, not a side effect that can be stranded before feedback exists.
- Stale calls produce precise errors with enough state for the orchestrator to recover.

The goal is not to make concurrent MCP calls fully supported. The goal is to make retries, duplicated tool calls, provider failures, and interrupted processes safe enough that they do not skip rounds, repeat expensive provider invocations, or produce inconsistent output.

## Steps

- [ ] Add explicit round-phase helpers in `src/core/operations.ts` or a new `src/core/round-state.ts`
  - Create `getRoundState(cwd, session): RoundState`, based on `session.currentRound` plus existing `round-N-feedback.json` and `round-N-response.json`.
  - Return enough information to drive MCP tools:
    - `currentRound`
    - `hasFeedback`
    - `hasResponse`
    - `nextAction: "get_feedback" | "revise" | "terminal_or_next_round"`
    - `latestFeedback`
    - `latestResponse`
  - Keep this helper read-only. It should never mutate `session.json`.
  - This centralizes round-state interpretation so `get-feedback.ts`, `revise.ts`, `record-revision.ts`, `status.ts`, and future tools do not each infer state differently.

- [ ] Make `planpong_get_feedback` replay-safe
  - Before incrementing anything, inspect the current round artifacts.
  - If `session.currentRound > 0`, `round-N-feedback.json` exists, and no `round-N-response.json` exists:
    - Return the existing feedback payload and status line.
    - Do not invoke the reviewer.
    - Include `idempotent_replay: true` in the JSON response.
  - If `round-N-feedback.json` and `round-N-response.json` both exist:
    - Advance to round `N + 1` only if the session is still `in_review` and `N < max_rounds`.
    - Write `session.currentRound = N + 1` as the transition into the next review round.
    - Then invoke the reviewer for the new round.
  - If `session.currentRound === 0`, start round 1 as today.
  - If `session.currentRound > 0` and feedback is missing for that round:
    - Treat this as an incomplete review transition.
    - Retry the reviewer for the same `session.currentRound`; do not increment again.
    - Include `resumed_incomplete_round: true` in the response when the retry succeeds.
  - If `session.currentRound >= config.max_rounds` and the previous round has a response, return a terminal max-rounds response instead of incrementing past the configured limit.

- [ ] Persist feedback with an idempotency check
  - Add a `finalizeFeedback` helper, mirroring `finalizeRevision`, responsible for:
    1. Writing `round-N-feedback.json`
    2. Updating reviewer session ID fields if needed
    3. Updating session status for blocked feedback
    4. Writing `session.json` as the commit point
  - If `round-N-feedback.json` already exists, return the existing feedback and `fresh: false`.
  - The idempotency comparison can be strict JSON equality for now, but the common replay path should avoid invoking the reviewer before this helper is reached.
  - Keep metrics writes fail-open and separate from the commit point, as they are today.

- [ ] Add `expected_round` to `planpong_revise`
  - Input schema: `expected_round: z.number().int().positive()`.
  - Validate `expected_round === session.currentRound`.
  - If `round-N-response.json` already exists for `expected_round`, return it without invoking the planner.
  - Include `idempotent_replay: true` in that replay response.
  - If `expected_round < session.currentRound`, return a stale-call error with `current_round` and `expected_round`.
  - If `expected_round > session.currentRound`, return an out-of-order error telling the caller to fetch feedback first.
  - This should match `planpong_record_revision`'s stale-call protection so external and inline planner modes behave consistently.

- [ ] Tighten `planpong_record_revision` round mismatch handling
  - Keep `expected_round` required.
  - If the matching `round-N-response.json` already exists and responses match, return the existing tally with `idempotent_replay: true`.
  - If `expected_round < session.currentRound`, report a stale call.
  - If `expected_round > session.currentRound`, report an out-of-order call.
  - If `expected_round === session.currentRound` but feedback is missing, report that `planpong_get_feedback` must be called first.
  - Preserve the current "every issue must have a response" validation.

- [ ] Use artifact state to prevent duplicate provider calls
  - In `planpong_get_feedback`, check `round-N-feedback.json` before calling `runReviewRound`.
  - In `planpong_revise`, check `round-N-response.json` before calling `runRevisionRound`.
  - In `runReviewRound` and `runRevisionRound`, add defensive early checks as well. Tool-level checks prevent normal duplicate calls; operation-level checks protect future callers.
  - Return existing artifacts with the same response shape as fresh calls, plus `idempotent_replay: true`.

- [ ] Normalize MCP response shapes
  - Both fresh and replayed `planpong_get_feedback` responses should include:
    - `round`
    - `phase`
    - `verdict`
    - `summary`
    - `issues`
    - `severity_counts`
    - `is_converged`
    - `status_line`
    - optional timing/verification fields when available
    - `idempotent_replay`
  - Both fresh and replayed revision responses should include:
    - `round`
    - `responses`
    - `accepted`
    - `rejected`
    - `deferred`
    - `unverified_rejected`
    - `plan_updated`
    - `status_line`
    - `planner_mode`
    - `idempotent_replay`
  - Replayed responses may omit provider `timing` if metrics are unavailable. Do not fabricate timing.

- [ ] Add a lightweight session mutation lock
  - Add `withSessionLock(cwd, sessionId, fn)` in `src/core/session.ts`.
  - Use an exclusive lock file at `.planpong/sessions/<id>/lock`.
  - Prefer `openSync(lockPath, "wx")` with a short retry/backoff loop.
  - Always remove the lock in `finally`.
  - Include stale-lock handling using lock file mtime and a conservative timeout, e.g. 10 minutes, matching provider timeout scale.
  - Use this wrapper in mutating MCP tools:
    - `planpong_get_feedback`
    - `planpong_revise`
    - `planpong_record_revision`
    - `planpong_start_review` does not need the per-session lock because the session does not exist yet.
  - This is not a concurrency feature; it is a guard against duplicate overlapping MCP tool calls.

- [ ] Make status-line writes replay-safe
  - Replayed feedback/revision calls should not keep appending suffix variants or changing elapsed time unnecessarily.
  - `writeStatusLineToPlan` should be safe to call repeatedly for the same logical state.
  - Prefer computing the status line from persisted artifacts and a deterministic suffix:
    - feedback replay: same suffix as fresh feedback, e.g. `Reviewed - N issues`
    - revision replay: same suffix as fresh revision, e.g. `Revision submitted` or `Revision recorded`
  - If exact elapsed time changes on replay, accept that as a status-line refresh, but ensure it does not alter round counters or artifact files.

- [ ] Update `planpong_status`
  - Surface per-round state from the new round-state helper:
    - `feedback_written`
    - `response_written`
    - `next_action`
    - `incomplete_transition` when `session.currentRound` points at a round with neither feedback nor response.
  - This makes interrupted states diagnosable without inspecting `.planpong/sessions` manually.

- [ ] Add unit tests for MCP feedback idempotency
  - First `getFeedbackHandler` call writes round 1 feedback and returns `idempotent_replay: false`.
  - Second call before revision returns the same round 1 feedback and does not invoke the provider.
  - If `session.currentRound = 1` but `round-1-feedback.json` is missing, `getFeedbackHandler` retries round 1 instead of advancing to round 2.
  - If round 1 feedback and response both exist, `getFeedbackHandler` advances to round 2.
  - If max rounds are reached and the latest round has a response, no new round is started.

- [ ] Add unit tests for external revision idempotency
  - `reviseHandler` requires `expected_round`.
  - Duplicate call with existing matching `round-N-response.json` returns `idempotent_replay: true` and does not invoke planner provider.
  - `expected_round < currentRound` returns stale-call error.
  - `expected_round > currentRound` returns out-of-order error.
  - Missing feedback for the expected round returns a "call get_feedback first" error.

- [ ] Extend inline revision tests
  - Duplicate `recordRevisionHandler` call with matching responses returns replay payload.
  - Duplicate call does not rewrite metrics or status unnecessarily, except for allowed status-line refresh if retained.
  - Mismatch errors distinguish stale, out-of-order, and missing-feedback cases.

- [ ] Add crash-state tests at the helper level
  - Simulate `session.currentRound = 2` with no `round-2-feedback.json`; round state reports incomplete review transition.
  - Simulate `round-2-feedback.json` with no response; next action is revision.
  - Simulate feedback + response for current round; next action is next feedback round or terminal if max rounds reached.
  - Simulate `round-N-response.json` without feedback and report corruption/inconsistent artifacts rather than silently continuing.

- [ ] Manual verification
  - Start a real MCP review session.
  - Call `planpong_get_feedback` twice before revising; confirm second call does not invoke the reviewer and returns the same round.
  - Call external `planpong_revise` twice with the same `expected_round`; confirm second call does not invoke the planner.
  - Interrupt a session after `session.currentRound` is advanced but before feedback exists by editing session state in a temp fixture, then call `planpong_get_feedback`; confirm it resumes that round.
  - Run `npm test` and `npm run typecheck`.

## File References

| File | Change |
|---|---|
| `src/core/session.ts` | Add `withSessionLock`; optionally add artifact read helpers if round-state helper lives here |
| `src/core/round-state.ts` | New helper for interpreting session/current-round artifact state |
| `src/core/operations.ts` | Add `finalizeFeedback`; add defensive artifact replay checks; expose shared response-building helpers if useful |
| `src/mcp/tools/get-feedback.ts` | Make round advancement artifact-aware and replay-safe |
| `src/mcp/tools/revise.ts` | Add required `expected_round`; replay existing responses before invoking planner |
| `src/mcp/tools/record-revision.ts` | Tighten mismatch semantics and replay behavior |
| `src/mcp/tools/status.ts` | Surface round artifact state and next action |
| `src/mcp/tools/get-feedback.test.ts` | Add feedback replay, incomplete transition, and max-round tests |
| `src/mcp/tools/revise.test.ts` | Add `expected_round`, duplicate-call, stale-call, and out-of-order tests |
| `src/mcp/tools/record-revision.test.ts` | Extend duplicate and mismatch tests |
| `src/core/operations.test.ts` | Add `finalizeFeedback` and defensive replay tests |
| `src/core/round-state.test.ts` | New tests for artifact-derived round state |

## Verification Criteria

- Calling `planpong_get_feedback` twice before revision returns the same round feedback on the second call and does not invoke the reviewer.
- A session with `currentRound = N` and no `round-N-feedback.json` retries round N instead of advancing to N+1.
- `planpong_revise` requires `expected_round` and does not invoke the planner when `round-N-response.json` already exists.
- `planpong_revise` and `planpong_record_revision` both distinguish stale calls from out-of-order calls.
- Replayed tool responses have the same JSON shape as fresh responses plus `idempotent_replay: true`.
- `planpong_status` exposes enough state to diagnose an incomplete transition.
- Session mutation tools acquire a per-session lock and release it on success and failure.
- Existing CLI `runReviewLoop` behavior is unchanged.
- `npm test` passes.
- `npm run typecheck` passes.

## Key Decisions

- **Artifacts are the idempotency keys.** `session.currentRound` is useful but not sufficient. `round-N-feedback.json` and `round-N-response.json` prove whether the expensive side effect happened.
- **Tool-level replay before provider calls.** The best retry is the one that does not spend model time. Operation-level checks are secondary protection.
- **Keep round advancement outside `finalizeRevision`.** Existing callers already own advancement. This plan improves the guardrails around advancement rather than moving ownership and risking CLI/MCP divergence.
- **Add `expected_round` to external revision.** Inline mode already has this protection. External mode should have the same stale-call defense.
- **Use a lightweight lock, not a database.** The persistence model is filesystem JSON. A lock file is enough to prevent overlapping MCP mutations without changing storage architecture.
- **Do not make timing deterministic on replay.** Timing is telemetry, not state. Replayed responses should not fake provider duration if metrics are absent.

## Risks & Mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Replay logic hides a genuinely corrupted session | Round-state helper explicitly detects impossible artifact combinations, such as response without feedback, and returns an error instead of guessing |
| R2 | Lock files become stale after a crash | Store lock metadata and clear locks older than a conservative timeout |
| R3 | Adding `expected_round` to `planpong_revise` breaks existing callers | Update MCP server instructions and tests in the same change; this is a tool API tightening, but it prevents expensive duplicate planner calls |
| R4 | Status line elapsed time changes on replay, making exact output comparisons noisy | Tests should assert round/status semantics and replay flags, not exact elapsed seconds |
| R5 | Defensive checks in `runReviewRound` complicate CLI behavior | Keep CLI path unchanged by making replay checks no-op unless matching artifacts already exist for the same session/round |
| R6 | Provider metrics files are overwritten on replay | Replay paths should not invoke providers or write new metrics; helper tests should assert metrics file mtime/content where practical |

## Out of Scope

- Atomic writes for every session artifact. This plan benefits from atomic writes, but full write-hardening is a separate infrastructure change.
- Changing the CLI loop semantics. The focus is MCP retry/idempotency.
- True multi-client concurrent editing support. The lock prevents overlap; it does not merge concurrent intentions.
- Automatic repair of corrupted sessions. This plan detects inconsistent artifact states and reports them.
- Changing reviewer or planner prompts.

## Limitations & Future Work

- **Existing sessions may already be inconsistent.** The new state helper should report those clearly, but it does not migrate or repair them.
- **`expected_round` is a small API break for external MCP callers.** It is worth it because duplicate external revision calls are expensive and currently hard to distinguish from fresh work.
- **Replay responses may not include original timing.** If metrics exist, they can be surfaced. If not, replay should avoid inventing values.
- **Atomic write hardening remains important.** This plan reduces duplicate side effects, but a crash during a direct `writeFileSync` can still corrupt a JSON artifact. A follow-up should add a shared atomic writer for session files and plan rewrites.
