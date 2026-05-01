# Inline Planner Mode + R3 Robustness Bundle

**Status:** Approved
**planpong:** R5/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | detail | 3P2 1P3 → 1P1 3P2 → 3P1 → 1P1 → 0 | Accepted: 11 | Deferred: 1 | +107/-0 lines | 1054m 55s | Approved after 5 rounds

## Context

Three problems with the current flow, all reinforcing each other at R3 (the detail phase, where most rounds spend their time):

1. **The agent that invoked `/pong-review` is disengaged.** Today, `planpong_revise` ships the plan + reviewer feedback to a *separate* planner provider (claude or codex). The agent the user is actively working with — which has the full conversation context, knows the constraints the user mentioned offhand, and understands what the user is actually trying to build — sees only the round summaries. The user's stated best experiences with planpong are when the active agent reads the issues, discusses them with the user, and revises the plan inline. The current architecture optimizes against that.

2. **The `approved_with_notes` Zod refinement is terminal.** `ReviewFeedbackSchema` (`src/schemas/feedback.ts:14-39`) has a `.refine()` that rejects `approved_with_notes` verdicts paired with non-P3 issues. The state machine (`src/core/operations.ts:642-657`) treats `ZodValidationError` as terminal — no retry, no downgrade. The reviewer prompt explicitly forbids this combination, but models violate it occasionally, killing the round outright. Detail phase is the only phase where this fires (direction and risk verdicts can't be `approved_with_notes`).

3. **The cite-evidence prompt added in 0.5.3 is misaligned with incremental review.** `CITE_EVIDENCE_BLOCK` (`src/prompts/reviewer.ts`) instructs the reviewer to ensure `quoted_text` "appears in the plan markdown above." That's correct in `buildReviewPrompt` (full plan above) but wrong in `buildIncrementalReviewPrompt` at R2+ where only a `buildPlanDiff()` output is above. The reviewer either (a) quotes a diff line and gets the `+ ` / `- ` prefix in the quote, failing verification, or (b) quotes a deleted line still present in R1's session memory, failing verification against the *current* plan, or (c) drops issues it can't quote, including legitimate codebase-grounded findings. The plan content isn't actually missing — it's all in session memory — but the prompt forces the reviewer to do reconstruction work without telling it to.

These three problems are bundled because the fixes reinforce each other:

- **Inline planner makes the verifier advisory rather than gating.** Today, `verified: false` triggers the planner-side rejection prompt. With the agent in the planner role, `verified: false` becomes a hint the agent can sanity-check against the plan it has in conversation context. The cite-evidence misalignment stops cascading into no-progress convergence loops.
- **`approved_with_notes` coercion turns a terminal failure into a recoverable one.** Independent fix, but cuts one of the highest-frequency hard-stop modes at R3. Both planner modes benefit.
- **Grounding incremental review with the full plan text helps the reviewer produce better quotes regardless of planner mode.** With inline planner, the agent can compensate for remaining edge cases; with external planner, fewer bad quotes means fewer wasted "unverified evidence" rejections.

Shipping these together at 0.5.4. Inline planner is opt-in (`planner_mode` flag); `/pong-review` keeps the `external` default in this release. The default flips to `inline` in a follow-up after bench validation confirms non-inferiority on catch rate and convergence.

## Steps

- [ ] **Add `planner_mode` to `PlanpongConfigSchema` in `src/schemas/config.ts`**
  - `planner_mode: z.enum(["inline", "external"]).default("external")`
  - `external` (default) preserves today's behavior: `planpong_revise` sends plan + feedback to a planner provider.
  - `inline` flips the loop: `planpong_revise` errors out, the agent uses a new `planpong_record_revision` tool to log responses + advance the round after editing the plan with its own tools.
  - Loadable from `planpong.yaml` and from CLI overrides via `loader.ts`.

- [ ] **Update `DEFAULT_CONFIG` in `src/config/defaults.ts`**
  - Add `planner_mode: "external"` to the `DEFAULT_CONFIG` object. Required because `PlanpongConfig` is `z.infer<typeof PlanpongConfigSchema>` (output type), which makes all `.default()` fields required in the inferred type. Without this, `tsc --noEmit` fails under strict mode.

- [ ] **Persist `planner_mode` on the session in `src/schemas/session.ts`**
  - Add `planner_mode: z.enum(["inline", "external"]).default("external")` to the session schema, set at `createSession` time from the config.
  - The field is optional with a `.default()` so that existing session files (written before this change) deserialize as `"external"` without a migration step. No schema version bump or migration script needed — Zod's `.default()` handles it at parse time.
  - **Runtime normalization in `readSessionState`:** Because `readSessionState` (`session.ts:63`) uses `JSON.parse(...) as Session` without Zod validation, `.default()` alone is insufficient for old sessions. Add explicit normalization in `readSessionState`: after JSON.parse, set `planner_mode = "external"` when the field is absent. This ensures old sessions work correctly regardless of whether the read path goes through Zod. Keep the Zod `.default()` for schema documentation and any future paths that parse through the schema.
  - Sticky for the session lifetime — `planner_mode` cannot change mid-loop.
  - `planpong_start_review` accepts an optional `planner_mode` input that overrides the config default for this session only.
  - **Tests:** (1) Schema test: deserialize a session fixture lacking `planner_mode` through `SessionSchema.parse()` — assert it defaults to `"external"`. (2) `readSessionState` compatibility test (authoritative): write a session JSON file without `planner_mode`, read it via `readSessionState`, assert `planner_mode === "external"`. The second test is the one that would have caught this bug.

- [ ] **Extract `finalizeRevision` helper in `src/core/operations.ts`**
  - Extract the post-revision finalization logic from `runRevisionRound` (operations.ts:957-1005) into a shared `finalizeRevision` function.
  - The helper handles: response persistence to `round-N-response.json` via `writeRoundResponse`, plan hash update via `hashFile`, session state persistence via `writeSessionState`, and response tallying (accepted/rejected/deferred counts).
  - **Not** included in the shared helper: round advancement (stays with current owners — see below), edits application (mode-specific — external mode applies edits from the provider response; inline mode has the agent apply edits beforehand via Edit/Write), metrics file writing (callers pass mode-specific data), and status line update (callers use mode-specific suffix text).
  - **Round advancement stays with callers.** Today, `currentRound` is advanced by `get-feedback.ts:63` (`session.currentRound++`) in MCP mode and by `loop.ts:169`/`loop.ts:313` (`session.currentRound = round`) in CLI mode. `finalizeRevision` does NOT touch `currentRound`. Moving advancement into finalization would double-advance in MCP mode (get-feedback increments, then finalize increments again) and break the "no behavioral change for external mode" invariant.
  - **Write ordering contract:** writes proceed in this fixed order: (1) `round-N-response.json` via `writeRoundResponse`, (2) plan hash update via `hashFile`, (3) session state via `writeSessionState`. Session state is the commit point — if the process crashes before step 3, a retry re-enters with the same round number and overwrites the response file (safe, idempotent). If it crashes after step 3, the round is committed and the response file is guaranteed to exist.
  - **Idempotency:** if the response file for the current round already exists and its content matches, `finalizeRevision` returns the existing tally from the already-written response file without re-writing artifacts. This prevents duplicate work from retries or stale calls, without relying on round-number comparison (since `finalizeRevision` doesn't own round advancement).
  - `runRevisionRound` calls `finalizeRevision` after applying edits. No behavioral change for external mode.
  - `planpong_record_revision` calls `finalizeRevision` after validating the agent's responses.
  - This eliminates duplicate round-finalization paths that would otherwise diverge over time.

- [ ] **Add `planpong_record_revision` MCP tool at `src/mcp/tools/record-revision.ts`**
  - Inputs: `session_id`, `expected_round: number`, `responses: { issue_id, action, rationale, severity_dispute? }[]`. Optional `cwd`. **No** `edits` field — the agent applies plan changes via its own Edit/Write tools before calling this.
  - Behavior:
    1. Validate session is `in_review` and `planner_mode === "inline"` (else error).
    2. Validate `expected_round === session.currentRound`. Error with `"round N already finalized"` if mismatched. This prevents double-submission from retries or stale tool calls.
    3. Read the current round's feedback from `round-N-feedback.json`. Validate every feedback issue has a corresponding response — error if any are missing (mirrors the planner prompt's "every issue MUST have an entry in `responses`" constraint).
    4. Construct a `PlannerRevision`-shape payload (`{ responses, updated_plan: <current-plan-from-disk> }` for the synthetic-direction shape, or `{ responses, edits: [] }` for risk/detail).
    5. Call `finalizeRevision` (shared helper) to persist response, update plan hash, and write session state. Tally results.
    6. Write `round-N-revision-metrics.json` as a fully valid `RoundMetrics` object: `schema_version: 1`, `session_id` from session, `round` from `expected_round`, `phase` derived from round number via existing phase logic, `role: "revision"`, `started_at` and `completed_at` set to current ISO timestamp (inline revision has no measurable provider duration), `total_duration_ms: 0`, `attempts: []`, and `planner_mode: "inline"`. This passes `RoundMetricsSchema.parse()` validation, ensuring bench analysis in `bench/run.ts:226` includes inline rounds rather than silently dropping them.
    7. Update plan status line via `writeStatusLineToPlan` with suffix `Revision recorded`.
    8. If plan hash is unchanged since round start and any response has `action: "accepted"`, emit a stderr warn. Not blocking — sometimes all issues are legitimately rejected.
    9. Return `{ round, accepted, rejected, deferred, unverified_rejected, plan_updated, status_line, planner_mode }` matching `planpong_revise`'s response surface so the slash-command skill can consume either tool's output uniformly.

- [ ] **Make `planpong_revise` error in `inline` mode**
  - `src/mcp/tools/revise.ts` checks `session.planner_mode === "inline"` early and returns `{ error: "session is in inline planner mode — use planpong_record_revision instead" }`.
  - Same shape as the existing error responses (no isError mismatch).

- [ ] **Register `planpong_record_revision` in `src/mcp/server.ts`**
  - One new `registerRecordRevision(server)` call alongside the existing register-X functions.
  - Update the server-instructions block in `server.ts` to document the inline-mode flow: "If `planner_mode: inline` was set on `planpong_start_review`, call `planpong_record_revision` after editing the plan; otherwise call `planpong_revise`."

- [ ] **Coerce `approved_with_notes` refinement violations instead of throwing**
  - Move the refinement check OUT of `ReviewFeedbackSchema` (drop the `.refine()` block) into `parseFeedback` and `parseStructuredFeedbackForPhase`.
  - Post-`safeParse`/post-`.parse()`, if `verdict === "approved_with_notes"` and any issue has severity P1 or P2, downgrade `verdict` to `needs_revision` and emit `console.warn("[planpong] approved_with_notes with non-P3 issues — coercing to needs_revision")`.
  - This mirrors the existing pattern for blocked-without-rationale coercion (`convergence.ts:215-232`).
  - **Why move out of the schema:** as long as the refinement is in the schema, `safeParse` returns `{success: false, error: ZodError}` for the violation, and the structured parser converts that to a terminal `ZodValidationError`. The refinement-as-Zod design conflates "structurally invalid" (must throw) with "semantically wrong but recoverable" (can coerce). Moving it out makes the intent explicit.
  - **Single parser entrypoint enforcement:** during implementation, grep for all production usages of `ReviewFeedbackSchema.parse()` and `.safeParse()` outside of `parseFeedback` and `parseStructuredFeedbackForPhase`. Confirmed: all production feedback parsing routes through `parseFeedbackForPhase` or `parseStructuredFeedbackForPhase` (convergence.ts). Add a JSDoc comment on `ReviewFeedbackSchema` noting that production callers must use `parseFeedback`/`parseStructuredFeedbackForPhase` (which apply semantic coercions) rather than calling `.parse()` directly. This prevents future callers from silently bypassing coercion.
  - Existing tests in `feedback.test.ts` that expect the schema to throw on refinement violation must be updated to expect coercion (`expect(parsed.verdict).toBe("needs_revision")`).

- [ ] **Ground incremental review with full plan text**
  - In `src/prompts/reviewer.ts`, split `CITE_EVIDENCE_BLOCK` into two strings:
    - `CITE_EVIDENCE_BLOCK_FRESH` — used by `buildReviewPrompt`. Says "appear in the plan markdown above." (unchanged from today)
    - `CITE_EVIDENCE_BLOCK_INCREMENTAL` — used by `buildIncrementalReviewPrompt`. Says "appear in the current plan text provided below."
  - `buildIncrementalReviewPrompt` (reviewer.ts:233-295) updated to include both the diff (for change context) AND the full current plan text (for quoting). The full plan is appended after the diff under a clear header (e.g., `## Current Plan (full text — quote from this)`).
  - This eliminates model-side reconstruction from diffs. The reviewer always has an authoritative, up-to-date source for quoting. Higher prompt cost (full plan text repeated in every incremental round) but plans are typically < 10KB — the cost is marginal and far cheaper than a wasted round from bad quotes.
  - The instruction-builders (`buildDirectionReviewInstructions`, `buildRiskReviewInstructions`, `buildDetailReviewInstructions`) remain unaware of fresh vs. incremental. The cite-evidence block is appended at the prompt-builder level (`buildReviewPrompt` / `buildIncrementalReviewPrompt`) AFTER the instruction-builders return. This keeps the instruction-builder API simple.
  - `buildIncrementalReviewPrompt` gains a new `currentPlanContent: string` parameter alongside the existing diff content.

- [ ] **Add `planner_mode` field to `RoundMetrics` in `src/schemas/metrics.ts`**
  - `planner_mode: z.enum(["inline", "external"]).optional()` on the round metrics shape.
  - Set by both `runRevisionRound` (external mode, value `"external"`) and `planpong_record_revision` (inline mode, value `"inline"`).
  - Optional in the schema for back-compat with metrics files written before this change.
  - Unblocks per-round filtering in `bench/run.ts` (e.g., "compare external-only rounds to inline-only rounds" — useful for measuring the quality delta).

- [ ] **Update `/pong-review` skill — document inline mode as opt-in**
  - Keep `external` as the default planner mode in the skill. Do NOT flip to `inline` in this release.
  - Document `planner_mode: "inline"` as an opt-in flag in the skill instructions so users can try it explicitly.
  - Add instructions for the inline flow: after `planpong_get_feedback` returns issues, the agent should (1) summarize them to the user, (2) edit the plan with its Edit/Write tools, (3) call `planpong_record_revision` with one response per issue. Not `planpong_revise`.
  - The default flips to `inline` in a follow-up release after bench validation confirms non-inferiority on catch rate and convergence rate.
  - **Out of scope for this change:** an "interactive checkpoint" where the agent pauses to discuss each issue with the user before deciding. The skill instructions can encourage this pattern but the tool surface doesn't enforce it.

- [ ] **Unit tests**
  - `src/core/operations.test.ts` (new or extend existing): verify `finalizeRevision` helper persists response, updates hash, writes session state, and returns correct tally. Verify it does NOT advance `currentRound`. New case: calling `finalizeRevision` twice for the same round (response file already exists) returns the existing tally without re-writing artifacts (idempotency).
  - `src/mcp/tools/record-revision.test.ts` (new): valid responses path; missing-response-for-issue error; wrong planner_mode error; `expected_round` mismatch error (returns `"round N already finalized"`); metrics file written as fully valid `RoundMetrics` (passes `RoundMetricsSchema.parse()`); metrics include `planner_mode: "inline"`, `schema_version: 1`, `session_id`, `round`, `phase`, `role`, `started_at`, `completed_at`; status line updated; calls `finalizeRevision` for round advancement.
  - `src/mcp/tools/revise.test.ts`: new case asserting `planner_mode === "inline"` triggers the route-to-record_revision error response.
  - `src/core/convergence.test.ts`: the existing `rejects approved_with_notes when issues have P1/P2` case (`convergence.test.ts:100-117`) flips to expect coerced `needs_revision`. Add a separate case asserting the warn fires. Add a case verifying raw `ReviewFeedbackSchema.parse()` (without parser functions) accepts `approved_with_notes` + P2 — confirming the refinement is gone from the schema and coercion lives only in the parser functions.
  - `src/prompts/reviewer.test.ts`: new case asserting `buildIncrementalReviewPrompt` includes the full plan text and the incremental cite-evidence wording (and does NOT include "the plan markdown above"); new case asserting `buildReviewPrompt` still uses the fresh wording and does not include duplicate plan text.
  - `src/schemas/session.test.ts` (new or extend): (1) Schema test: deserialize a session fixture lacking `planner_mode` through `SessionSchema.parse()` — assert it defaults to `"external"`. (2) `readSessionState` compatibility test: write a session JSON file without `planner_mode`, read it via `readSessionState`, assert `planner_mode === "external"`.

- [ ] **Manual validation (not merge-blocking)**
  - Run `/pong-review docs/plans/inline-planner-and-r3-robustness.md` (this plan) with `planner_mode: "inline"` opt-in. Self-test: the plan should converge under its own intended flow.
  - Run `bench/quality/run.ts --mode planpong` against 0.5.3-baseline and 0.5.4-after (external mode), judge with the same model both times. Catch rate should not drop. This validates the robustness fixes in isolation.
  - After external-mode bench validation passes, run the same bench with `planner_mode: "inline"` to measure the inline delta separately. This data gates the follow-up default flip.

## File References

| File | Change |
|---|---|
| `src/schemas/config.ts` | Add `planner_mode` enum to `PlanpongConfigSchema` |
| `src/config/defaults.ts` | Add `planner_mode: "external"` to `DEFAULT_CONFIG` to satisfy the inferred `PlanpongConfig` type |
| `src/schemas/session.ts` | Add `planner_mode` field to session schema (optional with `.default("external")` for backward compat), set at create time |
| `src/core/session.ts` | Add runtime normalization in `readSessionState`: set `planner_mode = "external"` when absent after JSON.parse |
| `src/schemas/metrics.ts` | Add optional `planner_mode` field to `RoundMetrics` |
| `src/schemas/feedback.ts` | Remove `.refine()` from `ReviewFeedbackSchema`; add JSDoc directing callers to parser functions |
| `src/core/operations.ts` | Extract `finalizeRevision` shared helper from `runRevisionRound` — persists response, updates hash, writes session state, returns tally. Does NOT advance round (callers own that). Idempotent on duplicate calls. |
| `src/core/operations.test.ts` | New tests for `finalizeRevision` helper including idempotency and non-advancement of currentRound |
| `src/core/convergence.ts` | Add post-parse `approved_with_notes` coercion in `parseFeedback` and `parseStructuredFeedbackForPhase` |
| `src/core/convergence.test.ts` | Update refinement test to expect coercion; add warn-fires test; add raw-schema-accepts test |
| `src/prompts/reviewer.ts` | Split `CITE_EVIDENCE_BLOCK` into fresh + incremental; `buildIncrementalReviewPrompt` gains `currentPlanContent` param and appends full plan text |
| `src/prompts/reviewer.test.ts` | New cases for fresh-vs-incremental cite-evidence wording; verify full plan text in incremental prompt |
| `src/mcp/tools/record-revision.ts` | New — implements `planpong_record_revision` with `expected_round` validation, writes fully valid `RoundMetrics`, calls shared `finalizeRevision` |
| `src/mcp/tools/record-revision.test.ts` | New — unit tests for the new tool including `expected_round` mismatch and full `RoundMetrics` validation |
| `src/mcp/tools/revise.ts` | Error early when `planner_mode === "inline"` |
| `src/mcp/tools/revise.test.ts` | New case for the inline-mode error response |
| `src/mcp/tools/start-review.ts` | Accept optional `planner_mode` input; persist on session |
| `src/mcp/server.ts` | Register `planpong_record_revision`; update server-instructions to document inline flow |
| `src/config/loader.ts` | Plumb `planner_mode` through CLI overrides |
| `src/schemas/session.test.ts` | New cases: schema default test + `readSessionState` compatibility test (authoritative) |
| `.claude/<pong-review-skill>` (or wherever the skill is defined) | Document `planner_mode: "inline"` as opt-in; add inline-flow instructions; keep `external` as default |

## Verification Criteria

- A session created with `planner_mode: "inline"` returns an error from `planpong_revise` and accepts `planpong_record_revision`.
- A session created with `planner_mode: "external"` (or no override) behaves exactly as today.
- Existing session files written before this change (lacking `planner_mode`) load successfully via `readSessionState` and have `planner_mode === "external"` at runtime. Verified by `readSessionState` compatibility test, not just schema test.
- `runRevisionRound` (external mode) calls `finalizeRevision` and produces identical artifacts to pre-refactor behavior. `finalizeRevision` does not advance `currentRound`.
- `planpong_record_revision` (inline mode) calls `finalizeRevision` and produces the same artifact shape (response file, session state, hash update) as the external path.
- Calling `finalizeRevision` twice for the same round (response file already exists) returns the existing tally without re-writing artifacts (idempotency).
- `planpong_record_revision` with `expected_round` mismatching `session.currentRound` returns an error.
- `planpong_record_revision` writes a `round-N-revision-metrics.json` that passes `RoundMetricsSchema.parse()` — includes all required fields (`schema_version`, `session_id`, `round`, `phase`, `role`, `started_at`, `completed_at`, `total_duration_ms`, `attempts`) plus `planner_mode: "inline"`.
- A reviewer that returns `approved_with_notes` with a P2 issue produces feedback with `verdict: "needs_revision"` and a stderr warn — not a terminal round failure.
- Raw `ReviewFeedbackSchema.parse()` accepts `approved_with_notes` + P2 (no refinement) — coercion is parser-side only.
- No production code path calls `ReviewFeedbackSchema.parse()` or `.safeParse()` directly outside of `parseFeedback` and `parseStructuredFeedbackForPhase`.
- `buildIncrementalReviewPrompt(...)` output contains both the diff and the full current plan text, with the incremental cite-evidence wording referencing the plan text below; `buildReviewPrompt(...)` uses the fresh wording and does not duplicate the plan.
- `bench/quality/run.ts` runs unchanged against an external-mode session and produces the same shape of `results.json`. Inline-mode metrics are included (not dropped) because they pass `RoundMetricsSchema.parse()`.
- Bench quality run (external mode) shows non-inferior catch rate vs. 0.5.3 baseline before the inline default flip can proceed.
- `npm test` passes; existing 203 tests stay green plus the new cases.
- `npm run typecheck` passes — `DEFAULT_CONFIG` in `src/config/defaults.ts` includes `planner_mode: "external"`, satisfying the `PlanpongConfig` type.

## Key Decisions

- **Bundle the code changes; stage the default.** The three changes ship in one PR because they reinforce each other at R3. But the `/pong-review` default stays `external` in this release. Inline mode is available as opt-in. The default flips in a follow-up release after bench validation confirms non-inferiority — this isolates the inline planner's behavioral impact from the robustness fixes for clean causal attribution.
- **Inline mode is opt-in via session-level state, not per-call.** Mid-loop mode switches are an unnecessary footgun; agents are more likely to stay consistent within a session. `planpong_start_review` is the single decision point.
- **Staged rollout: ship opt-in, validate, then default.** The inline planner ships as opt-in in 0.5.4. The `/pong-review` default stays `external`. After running bench quality against 0.5.3-baseline with both modes, the follow-up flips the default if catch rate and convergence rate are non-inferior. This separates causal attribution of the robustness fixes (which help both modes) from the inline behavioral shift.
- **No edit-applier in `record_revision`.** The agent owns plan editing via its existing tools (Edit/Write). The MCP tool only records what was decided. This keeps `record_revision` simple — no edits-mode parsing, no whitespace tolerance, no retry logic. All of that is the agent's problem, and the agent has Edit which is already proven.
- **Shared `finalizeRevision` helper over duplicated finalization.** Both `runRevisionRound` (external) and `planpong_record_revision` (inline) need to persist responses, update plan hash, and write session state. Extracting a shared helper keeps the two paths semantically aligned and prevents drift. Mode-specific logic (edits application for external; validation for inline; round advancement for callers; metrics and status line text for both) stays in the callers.
- **Round advancement stays with current owners, not in `finalizeRevision`.** Today, `currentRound` is advanced by `get-feedback.ts:63` (`session.currentRound++`) in MCP mode and by `loop.ts:169`/`loop.ts:313` (`session.currentRound = round`) in CLI mode. Moving advancement into `finalizeRevision` would double-advance in MCP mode and break the "no behavioral change for external mode" invariant. `finalizeRevision` persists whatever round state the caller has already set.
- **Refinement removal over hybrid coercion.** Could keep the refinement and special-case the structured-output path to retry-with-coercion. Simpler to remove the refinement and put the check post-parse, where it's adjacent to the existing blocked-rationale coercion. One pattern, not two.
- **Full plan in incremental prompts over model-side reconstruction.** Could keep the incremental cite-evidence block as a rewording instructing the model to reconstruct current plan state from diffs. More robust to include the authoritative full plan text alongside the diff. Marginal prompt cost increase (plans are < 10KB) but eliminates the core fragility of model context loss over long sessions. The diff still provides change-context (what happened since last round); the full plan provides the quoting source.
- **Per-prompt-builder cite-evidence selection.** Could thread a `mode: "fresh" | "incremental"` arg through `buildXReviewInstructions`. Cleaner to keep the instruction-builders unaware and append the right block at the prompt-builder level — the instruction-builders are already long.
- **Runtime normalization over Zod-only defaults for session loading.** `readSessionState` uses `JSON.parse(...) as Session` without Zod validation. Relying solely on Zod `.default()` would leave `planner_mode` undefined at runtime for old sessions. Explicit normalization in `readSessionState` is the authoritative compatibility mechanism; the Zod default is documentation.
- **Explicit `DEFAULT_CONFIG` update over relying on Zod defaults.** `PlanpongConfig` is `z.infer<typeof PlanpongConfigSchema>` (output type), making all `.default()` fields required in the TypeScript type. `DEFAULT_CONFIG` is explicitly typed as `PlanpongConfig`, so it must include every field the schema defines. Adding `planner_mode: "external"` keeps schema, loader, and typed defaults consistent and passes `tsc --noEmit` under strict mode.

## Risks & Mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Inline planner produces softer revisions because Claude is reviewing its own work without an external adversary | Reviewer is still external (codex by default). The cross-family adversarial property is preserved on the *review* side. The planner-side softening is a real tradeoff but offset by the agent's full session context. Measurable via bench v1 catch-rate. Staged rollout (inline is opt-in, not default) means the behavioral shift is explicitly evaluated before becoming the default flow. |
| R2 | Agent forgets to edit the plan before calling `record_revision`, producing a no-op round | Detect via plan-hash comparison: if `planHash` is unchanged since round started and any response is `accepted`, write a stderr warn. Not blocking — sometimes the right answer is "all issues rejected, plan stays as-is" — so we surface, don't gate. |
| R3 | Agent calls `record_revision` with responses that don't cover all issues from the round's feedback | Validate explicitly in the tool: every issue in `round-N-feedback.json` must have a matching `issue_id` in `responses`. Error response with the missing IDs listed. |
| R4 | `approved_with_notes` coercion masks reviewer bugs (e.g., consistently misjudging severity) | The coercion emits a stderr warn with `[planpong]` prefix, same as other coercions. The MCP response also surfaces this via the existing `fallback_used` path or a new `coerced_verdict` flag. (Pick: extend `fallback_used`, or add a separate flag — leaning toward separate flag for clarity.) |
| R5 | Existing tests break from the refinement removal | Inventory and update upfront: `feedback.test.ts` and `convergence.test.ts` are the only files referencing the refinement directly. Both updates are surgical (one assertion flip per case). |
| R6 | `pong-review` skill update introduces drift between docs and implementation | The skill is in `.claude/` (per repo convention); its update lives in this same PR so they ship together. No follow-up doc PR. |
| R7 | The new `planner_mode` field in `RoundMetrics` breaks existing bench analysis | Field is optional. Existing files without it parse cleanly. New analyses can filter on it; old analyses ignore it. |
| R8 | Cite-evidence wording change confuses the reviewer model on round 1 (fresh prompt) | Fresh-prompt wording is unchanged. Only incremental gets the new wording plus the full plan text. R1 behavior is identical. |
| R9 | Full plan text in incremental prompts increases prompt cost and may push long plans toward context limits | Plans are typically < 10KB. Even at 10 rounds, the cumulative cost is < 100KB of plan text — well within provider context windows. For unusually large plans (> 50KB), this could matter; if observed, add a size threshold that falls back to diff-only with the reconstruction wording. Not worth pre-building. |
| R10 | Existing sessions without `planner_mode` fail to load after schema change | Runtime normalization in `readSessionState` sets `planner_mode = "external"` when absent, independent of Zod schema. Verified by both a schema parse test and a `readSessionState` compatibility test. |
| R11 | Partial finalization crash leaves session in inconsistent state | Write ordering ensures session state (the commit point) is written last. Retry is idempotent — `finalizeRevision` detects the existing response file and returns the existing tally without re-writing artifacts. |
| R12 | Duplicate `record_revision` call double-advances round | `expected_round` input validated against `session.currentRound`. Mismatched round returns an error. Combined with `finalizeRevision` idempotency, this provides two layers of defense. Round advancement is not in `finalizeRevision` — it stays with the callers that own it today (`get-feedback.ts` for MCP, `loop.ts` for CLI). |
| R13 | Direct `ReviewFeedbackSchema.parse()` bypasses post-parse coercion | Single parser entrypoint enforced: JSDoc on schema directs callers to parser functions, grep verification during implementation confirms no direct production usage, and test confirms raw schema parse is permissive (no refinement). |
| R14 | `record_revision` metrics file silently dropped by bench analysis | Inline metrics are written as fully valid `RoundMetrics` objects (all required fields populated), not partial stubs. Verified by test that `RoundMetricsSchema.parse()` succeeds on the written file. |
| R15 | Missing `DEFAULT_CONFIG` update causes type-check failure | `src/config/defaults.ts` is updated in the same step as the schema change. Verification criterion: `npm run typecheck` passes. |

## Out of Scope

- Mid-session mode switching (`planner_mode` is sticky).
- Removing `planpong_revise` entirely. External mode stays for non-interactive consumers (CLI, automated pipelines, future programmatic uses).
- Flipping `/pong-review` default to `inline` in this release. Ships as opt-in; the default flip is a follow-up after bench validation.
- Auto-detecting "agent forgot to edit" and auto-rejecting the round. Surface, don't gate.
- A multi-reviewer quorum interaction with inline planner. The quorum plan (`docs/plans/multi-reviewer-quorum.md`) is unrelated and unshipped; this plan does not block or pre-resolve it.
- An "interactive review" mode where every issue triggers a user confirmation. Skill instructions can encourage discussion-with-user but tool semantics don't enforce it.
- Coercing `blocked` verdicts in detail phase. Detail's `blocked` already has its own rationale check and isn't a frequent failure mode like `approved_with_notes`.
- Per-issue edit verification in `record_revision` (checking whether accepted issues correspond to specific plan edits). The plan-hash warning covers the gross case; per-issue granularity adds complexity without evidence of need.

## Limitations & Future Work

- **Inline planner gives up the planner-side adversarial signal.** Empirically we may find revisions are too compliant. The staged rollout gives us bench data before the default flips. The fallback is to allow per-round mode override (R1 inline, R3 external) — but that's complexity we don't need until we have evidence. Re-evaluate after the bench comparison.
- **`record_revision`'s response-validation is structural, not semantic.** It checks that every issue has a response, but doesn't check whether the plan was actually edited in a way consistent with the responses. A lying agent that records `accepted` without making the edit is undetectable beyond the plan-hash warn. Acceptable — the agent is a trusted local process, not adversarial.
- **The `approved_with_notes` coercion is a symptom-fix.** The root cause is that the reviewer prompt allows the model to self-classify into a verdict that's structurally constrained by issue severity. A cleaner long-term fix is to *derive* the verdict from severity counts post-parse rather than have the model assert it. Out of scope for this change.
- **Full plan in incremental prompts trades cost for reliability.** For very large plans (> 50KB), the repeated full text may become significant. A future optimization: send a compact canonical excerpt (section headers + first lines) instead of the full text, falling back to full text only when the reviewer reports quoting difficulty. Not worth pre-building until we see plans of that scale.

## Reviewer Feedback

**Summary:** Direction is mostly right: it targets real R3 convergence friction and preserves backward compatibility, but the rollout and architecture choices leave meaningful risk of regression and hard-to-diagnose behavior drift.

### F1 (P2): Bundled release obscures causality and rollback paths
**Section:** Key Decisions / Bundle the three changes
**Description:** The plan ships robustness fixes together with a user-facing planner-behavior shift (inline default in `/pong-review`). If convergence or quality regresses, attribution will be unclear, which can force broad rollback or significant rework.
**Suggestion:** Stage the rollout or gate each change independently, and define explicit non-inferiority thresholds (catch rate, convergence, wall time) before making inline the default user flow.

### F2 (P2): Prompt rewording does not remove core fragility
**Section:** Reword CITE_EVIDENCE_BLOCK for incremental review
**Description:** The incremental path still depends on the reviewer reconstructing current plan state from prior diffs and conversation memory. In long sessions, context loss/truncation can still produce unverifiable quotes and repeated churn.
**Suggestion:** Ground incremental reviews with an authoritative current-plan snapshot (full plan or compact canonical excerpt/hash) rather than relying on model-side reconstruction alone.

### F3 (P2): Two revision execution paths risk semantic drift
**Section:** Add `planpong_record_revision` / Round advancement handling
**Description:** Keeping `planpong_revise` and `planpong_record_revision` with separate round-finalization behavior increases the chance of divergent outcomes between modes (metrics, advancement, status semantics), creating maintenance and debugging risk.
**Suggestion:** Centralize revision finalization into a shared core path and keep mode-specific logic only at the tool interface/input layer.

### F4 (P3): No-op revisions can pass too easily
**Section:** Limitations & Future Work / Structural-only validation
**Description:** The plan intentionally allows accepted responses without corresponding plan edits, only warning on unchanged hash. This can let low-signal rounds advance and mask convergence quality issues.
**Suggestion:** Add a lightweight policy check (for example, require change when any issue is accepted unless an explicit no-change rationale is provided).

## Reviewer Feedback

**Summary:** The plan is close, but there are concrete implementation mismatches with the current codebase that would break behavior unless addressed.

### F1 (P1): Round advancement ownership conflicts with existing flow
**Section:** Extract `finalizeRevision` helper / Write ordering + idempotency
**Description:** The plan makes `finalizeRevision` advance `session.currentRound`, but today round advancement is owned by callers before review (`session.currentRound++` in `src/mcp/tools/get-feedback.ts:63`, and `session.currentRound = round` in `src/core/loop.ts:313`). If revision also advances, MCP mode will skip rounds (R1 -> revise -> R2, then next get_feedback increments to R3), and external-mode behavior is no longer "no behavioral change" as claimed.
**Suggestion:** Define one owner for round advancement. Either: (a) keep advancement in callers and make `finalizeRevision` non-advancing, or (b) move advancement fully into finalization and remove caller-side increments in both MCP and loop paths, then update status/phase logic accordingly.

### F2 (P1): Schema default does not apply to runtime session loads
**Section:** Persist `planner_mode` on the session (`.default("external")` back-compat claim)
**Description:** The plan relies on Zod `.default()` in `SessionSchema` for old-session compatibility, but runtime session reads do not use the schema. `readSessionState` returns `JSON.parse(...) as Session` in `src/core/session.ts:63` with no `SessionSchema.parse`, so missing `planner_mode` will remain missing at runtime.
**Suggestion:** Either parse session JSON through `SessionSchema` in `readSessionState`, or add explicit runtime normalization there (set `planner_mode = "external"` when absent). Keep the schema test, but add a `readSessionState` compatibility test as the authoritative check.

### F3 (P1): Planned inline metrics payload is incompatible with `RoundMetricsSchema`
**Section:** Add `planpong_record_revision` (metrics write step)
**Description:** The plan specifies writing `round-N-revision-metrics.json` with `attempts: []`, `total_duration_ms: 0`, and `planner_mode`. But `RoundMetricsSchema` requires additional fields (`schema_version`, `session_id`, `round`, `phase`, `role`, `started_at`, `completed_at`) in `src/schemas/metrics.ts:27-44`. Bench parsing uses `RoundMetricsSchema.parse` (`bench/run.ts:223-226`), so partial metrics files will fail parsing and be dropped.
**Suggestion:** Write a fully valid `RoundMetrics` object (preferably via shared construction/helper + `writeRoundMetrics`) and then add `planner_mode` as an optional field.

## Reviewer Feedback

**Summary:** Most prior blockers are now addressed, but one concrete type/compile mismatch remains in the config path.

### F1 (P1): Plan misses required `DEFAULT_CONFIG` update for new `planner_mode` field
**Section:** Persist `planner_mode` config changes (`src/schemas/config.ts`, `src/config/loader.ts`)
**Description:** The plan adds `planner_mode` to `PlanpongConfigSchema`, which changes `PlanpongConfig` (inferred type) to require that field. `DEFAULT_CONFIG` is explicitly typed as `PlanpongConfig` in `src/config/defaults.ts:3-14`, but the plan does not include updating this file. With strict TypeScript settings (`tsconfig.json` has `strict: true`), this will fail type-check/build unless `DEFAULT_CONFIG.planner_mode` is added.
**Suggestion:** Add `src/config/defaults.ts` to the change list and set `planner_mode: "external"` in `DEFAULT_CONFIG` so schema, loader, and typed defaults stay consistent.