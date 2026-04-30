# Per-Invocation Observability & Metrics

**Status:** Approved
**planpong:** R4/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | detail | 3P2 1P3 → 6P2 → 1P2 1P3 → 0 | Accepted: 7 | Rejected: 5 | +63/-0 lines | 28m 59s | Approved after 4 rounds

## Context

Planpong invocations are a black box today. A single `claude -p` revision call can run 5–15 minutes with no indication of what's happening, and the only post-hoc artifact is the revision's output JSON. `ProviderResponse.duration` is computed inside each provider (see `src/providers/claude.ts:133`, `src/providers/codex.ts:101`) and then discarded when the caller unwraps `response.output`. Debugging a slow or stuck run currently requires attaching `ps` to the process tree.

This plan adds two cheap mechanisms:

1. **Live stderr logs** — one line at the start and end of every provider invocation, grep-friendly.
2. **Persisted per-round metrics files** in `.planpong/sessions/<id>/` so a session can be analyzed after the fact (or by a separate `planpong_timing` tool later).

Both hang off the invocation state machine in `src/core/operations.ts` (`invokeWithStateMachine`), which is the single owner of every provider call during a round.

**Limitation:** Start/end lines improve traceability but do not provide in-flight visibility during multi-minute provider calls. A call that has been running for 10 minutes is indistinguishable from a hung call until it completes or times out. Heartbeat/progress events are queued as the next observability milestone (see Limitations & Future Work).

## Steps

- [ ] Define a metrics schema at `src/schemas/metrics.ts`
  - `InvocationAttempt`: `{ mode: "structured" | "legacy", provider, model: string | null, effort: string | null, prompt_chars, prompt_lines, output_chars, output_lines: number | null, duration_ms, ok, error_kind: "capability" | "fatal" | "parse" | "zod" | null, error_exit_code: number | null }`
  - `RoundMetrics`: `{ schema_version: 1, session_id, round, phase: "direction" | "risk" | "detail", role: "review" | "revision", started_at, completed_at, total_duration_ms, attempts: InvocationAttempt[] }`
  - `schema_version` is a literal `1` — included so future schema changes can be detected by consumers without resorting to shape-sniffing. No migration logic is added now (no prior versions exist).
  - All timestamps are ISO-8601 UTC strings (e.g., `"2026-04-24T18:30:00.000Z"` via `new Date().toISOString()`)
  - Zod schema + TypeScript types exported together (mirrors existing `schemas/` files)
- [ ] Add metrics I/O helpers to `src/core/session.ts`
  - `writeRoundMetrics(cwd, sessionId, round, role, metrics)` → writes `.planpong/sessions/<id>/round-<N>-<role>-metrics.json`
  - `readRoundMetrics(cwd, sessionId, round, role)` → returns parsed `RoundMetrics | null`
  - Filename convention includes `role` (two metrics files per round max) so review and revision metrics don't collide
  - Both helpers are **fail-open**: write errors are caught, logged to stderr as `[planpong] warn: failed to write metrics: {message}`, and swallowed. Read errors return `null`. Telemetry I/O never propagates exceptions to callers.
- [ ] Refactor `invokeWithStateMachine` in `src/core/operations.ts` to emit + collect metrics
  - **Return type changes to `{ result: T, metrics: RoundMetrics }`** — the in-memory metrics object is returned alongside the invocation result so callers have timing data without a filesystem round-trip
  - Accept a new optional arg: `metricsContext: { sessionId, round, phase, role }`
  - At each attempt: record `started_at`, compute `prompt_chars` / `prompt_lines` from the prompt string, log a start line to stderr
  - After each attempt: record `duration_ms` (use existing `response.duration`), `output_chars` / `output_lines` (on success), `ok`, `error_kind`, `error_exit_code`, log an end line
  - `error_kind` mapping: provider `capability` → `"capability"`, provider `fatal` → `"fatal"`, `StructuredOutputParseError` → `"parse"`, `ZodValidationError` → `"zod"`
  - After the state machine exits (success or thrown), write the accumulated `RoundMetrics` via `writeRoundMetrics` in a `finally` block so partial runs still emit a file
  - **All stderr logging and metrics persistence is wrapped in try/catch.** If metrics collection or writing fails, a warning is logged to stderr (best-effort) and the original invocation outcome (success or error) is preserved unchanged. Observability failures must never alter the invocation result.
  - **When `metricsContext` is not provided**, the function still returns `{ result, metrics: null }` — the return type is `{ result: T, metrics: RoundMetrics | null }` to keep the signature uniform. Metrics collection is skipped entirely in this case.
- [ ] Thread `metricsContext` through the two callers in `operations.ts`
  - `runReviewRound` passes `{ sessionId: session.id, round, phase, role: "review" }`
  - `runRevisionRound` passes `{ sessionId: session.id, round, phase, role: "revision" }`
  - Both functions destructure `{ result, metrics }` from `invokeWithStateMachine` and include a `timing` summary (`{ duration_ms, attempts }`) in their return types, sourced from the in-memory `metrics` object — **not** from a filesystem read
- [ ] Choose a single stderr line format and use it everywhere
  - Start: `[planpong] R{n} {role} | {providerLabel} | {mode} | prompt={K}c`
  - End (ok): `[planpong] R{n} {role} | {providerLabel} | {mode} | prompt={K}c output={K}c duration={m}m{s}s | ok`
  - End (fail): `[planpong] R{n} {role} | {providerLabel} | {mode} | prompt={K}c duration={m}m{s}s | fail ({error_kind}: {short message})`
  - `providerLabel` reuses `formatProviderLabel` from `operations.ts` so model/effort show up when set
  - Remove the ad-hoc `process.stderr.write` transition logs in `invokeWithStateMachine` (lines 445-446, 479-480) — they're subsumed by the new end-of-attempt line
  - All stderr writes are individually try/caught — a logging failure never propagates
- [ ] Wire a minimal summary into the MCP tool responses
  - `planpong_get_feedback` response gains `timing: { duration_ms, attempts }` sourced from the in-memory metrics returned by `runReviewRound` — **no filesystem read** on the response path
  - `planpong_revise` response gains the same from `runRevisionRound`
  - If metrics are `null` (collection failed or context not provided), `timing` is omitted from the response rather than populated with stale/empty data
  - Small, non-breaking addition — existing fields unchanged. MCP tool responses are built as plain objects (Record<string, unknown> in get-feedback.ts, plain object in revise.ts) with no output schema validation. The MCP protocol allows additional fields in tool response content, and the consumer (Claude Code) interprets JSON flexibly.
- [ ] Unit tests in `src/core/operations.test.ts`
  - **State machine metrics tests:**
    - Structured success path: `invokeWithStateMachine` returns `{ result, metrics }` where metrics has one attempt, `mode: "structured"`, `ok: true`, and `schema_version: 1`
    - Structured→legacy downgrade on `capability` error: metrics has two attempts, first `ok: false error_kind: "capability"`, second `ok: true mode: "legacy"`
    - Structured→legacy downgrade on `parse` error: first attempt `ok: false error_kind: "parse"`
    - Zod validation failure: one attempt with `error_kind: "zod"` then throws (no second attempt)
    - Metrics file is written even when state machine throws (partial run is still observable)
    - **Metrics write failure does not alter invocation outcome**: mock `writeRoundMetrics` to throw, verify the state machine still returns the correct `{ result, metrics }` (or throws the correct original error), and a warning appears on stderr
  - **Timing propagation tests:**
    - `runReviewRound` result includes `timing` with `duration_ms` and `attempts` count matching the metrics
    - `writeRoundMetrics` throws → invocation outcome unchanged and `timing` still present in the round function return (disk failure does not affect in-memory metrics)
    - Metrics context absent or collection itself errors → `timing` is `undefined` in the round function return
    - Verify `timing.duration_ms` is a positive number and `timing.attempts` is a positive integer
- [ ] MCP tool boundary tests in `src/mcp/tools/get-feedback.test.ts` and `src/mcp/tools/revise.test.ts`
  - Mock the round function (`runReviewRound` / `runRevisionRound`) to return a result with known `timing` data; invoke the tool handler and assert the response JSON includes `timing: { duration_ms, attempts }` with expected values
  - Mock the round function to return a result with `timing` absent (`undefined`); invoke the tool handler and assert the response JSON omits `timing` entirely (no `null`, no empty object)
- [ ] Manual verification
  - Run planpong against `docs/plans/observability-metrics.md` itself (or a small test plan), confirm stderr lines appear and `round-1-review-metrics.json` / `round-1-revision-metrics.json` land on disk with expected fields

## File References

| File | Change |
|---|---|
| `src/schemas/metrics.ts` | Create — Zod + types for `InvocationAttempt`, `RoundMetrics` with `schema_version: 1` and ISO-8601 UTC timestamps |
| `src/core/session.ts` | Add `writeRoundMetrics` / `readRoundMetrics` helpers with fail-open error handling |
| `src/core/operations.ts` | Extend `invokeWithStateMachine` to return `{ result, metrics }` instead of bare result; accept `metricsContext` arg; collect + persist attempts; replace existing transition logs with unified format; wrap all telemetry I/O in try/catch. Update `runReviewRound` / `runRevisionRound` to propagate `timing` in return types from in-memory metrics. |
| `src/core/operations.test.ts` | Add tests for 4 attempt-path scenarios + the `finally`-write guarantee + metrics-write-failure resilience + timing propagation through round functions (disk-write-failure and collection-failure as separate cases) |
| `src/mcp/tools/get-feedback.ts` | Surface `timing` in response payload (sourced from in-memory round result, not disk) |
| `src/mcp/tools/get-feedback.test.ts` | Create — boundary tests verifying `timing` presence/absence in tool response JSON |
| `src/mcp/tools/revise.ts` | Surface `timing` in response payload (sourced from in-memory round result, not disk) |
| `src/mcp/tools/revise.test.ts` | Create — boundary tests verifying `timing` presence/absence in tool response JSON |
| `.planpong/sessions/<id>/round-N-<role>-metrics.json` | New runtime artifact (not committed) |

## Verification Criteria

- After a review or revision round, `.planpong/sessions/<id>/round-<N>-<role>-metrics.json` exists and parses against `RoundMetricsSchema`, including `schema_version: 1` and ISO-8601 UTC timestamps.
- File exists even when the round throws (e.g., Zod validation failure) — the `finally` block guarantees this.
- Stderr contains exactly one start line and one end line per attempt; no duplicate logging from the old `[planpong]` transition writes.
- Downgrade scenarios (`capability` error, `parse` error) produce a metrics file with two attempts in order: structured failure then legacy result.
- MCP tool responses (`planpong_get_feedback`, `planpong_revise`) include the `timing` field sourced from in-memory metrics — not from a filesystem read. When metrics are unavailable, `timing` is omitted (not null or empty). Verified by handler-level boundary tests that assert the response JSON shape for both cases.
- **Fail-open guarantee:** If `writeRoundMetrics` throws (e.g., disk full, permissions error), the invocation returns its original result (or throws its original error) unchanged. A warning is logged to stderr. Metrics file may be absent, but the round is not disrupted. The in-memory `timing` in the MCP response is still available since it doesn't depend on the write succeeding.
- **Collection failure:** If metrics collection itself fails (e.g., metricsContext absent, error during attempt recording), `timing` is `undefined` in the round function return and omitted from MCP responses. This is distinct from a disk-write failure where in-memory metrics remain valid.
- **Timing propagation:** `invokeWithStateMachine` returns `{ result, metrics }`. Round functions include `timing` in their return type. MCP tools read timing from the round result. No filesystem read on the response path.
- Unit tests cover: structured-ok, capability→legacy, parse→legacy, zod-terminal, throw-before-completion, metrics-write-failure-resilience, timing-propagation-through-round-functions (with separate cases for disk-write-failure vs collection-failure), MCP-tool-boundary-timing-presence-and-absence.

## Key Decisions

- **Metrics live in the session directory, not a global log.** Sessions are already the unit of work; colocating metrics keeps the artifact lifecycle simple (delete the session dir → metrics go with it).
- **One metrics file per (round, role) pair, not one per attempt.** Keeps the filesystem shallow and mirrors how feedback and response are already stored. Attempt-level detail lives inside as an array.
- **Single-writer invariant is guaranteed by the execution model.** `invokeWithStateMachine` is a sequential state machine (2-attempt cap, no internal parallelism). MCP tools are called one at a time by the orchestrator (Claude Code). Session I/O uses synchronous `readFileSync`/`writeFileSync`. There is no concurrent execution path for the same (session, round, role) tuple. If a user retries a round, the overwrite is correct behavior (latest run wins). No locking is needed.
- **`invokeWithStateMachine` owns the metrics emission, not the providers.** The providers are single-shot and already return `duration`; the state machine is where retry/downgrade decisions happen, so it's where an invocation's full story can be recorded. Pushing metrics into the providers would duplicate work across two providers and miss the mode-transition signal.
- **Telemetry is fail-open.** All metrics collection, persistence, and stderr logging is wrapped in try/catch. Failures emit a best-effort stderr warning and are swallowed. The invocation outcome (success or the original provider/parse/validation error) is always preserved. Observability must never degrade reliability.
- **Stderr format is unified, not layered.** The existing `invokeWithStateMachine` already writes transition logs — we replace those rather than add more. A single consistent grep target beats two partial ones.
- **No sampling, no log levels.** Volume is low (≤ 2 lines per attempt, ≤ 4 attempts per round, ≤ 10 rounds per session). Always-on keeps it honest; gating behind a verbose flag invites the "I wish I'd had this yesterday" problem that motivated the change.
- **`timing` in MCP responses is sourced from in-memory metrics, not disk.** `invokeWithStateMachine` returns `{ result, metrics }`. Round functions propagate timing from the in-memory object. The disk write is a fire-and-forget side-effect for retrospective analysis; the MCP response path has no filesystem dependency for timing data. This decouples user-facing responsiveness from persistence reliability. *(Added in response to F3.)*
- **Schema includes a version field but no migration logic.** `schema_version: 1` is set on `RoundMetrics` so future changes can be detected. No backward-compatibility reader is implemented now — there are zero prior versions and no external consumers. When a breaking change arrives, the version field will be there to key off. *(Added in response to F1.)*

## Limitations & Future Work

- **No in-flight visibility.** Start/end stderr lines bracket each provider call but provide no signal during multi-minute invocations. A call running for 10 minutes looks identical to a hung call until it completes or the process is killed. **Next milestone:** heartbeat or progress events — either periodic stderr lines emitted by a timer during the provider call, or provider-level streaming that surfaces partial output indicators. This requires either a watchdog timer in the state machine or cooperation from the provider layer (e.g., tailing the subprocess's stderr).
- **No token counts.** Provider CLIs don't expose usage metadata in a standard way. Parsing provider-specific output formats is out of scope but would add cost visibility per invocation.
- **No `planpong_timing` summary tool.** A dedicated MCP tool to query/aggregate metrics across rounds is a natural next step but deferred to keep this change focused on emission.
- **No speed fixes.** This plan is pure observability — diagnosing slow runs, not fixing them. Performance work sits on item 3 in the broader thread.

**Not in scope:** token counts (requires per-provider usage parsing), streaming progress updates, a `planpong_timing` summary tool, or any speed fix. Those sit on item 3 in the broader thread.

## Reviewer Feedback

**Summary:** The plan is directionally solid, but several medium-impact assumptions around persistence, crash behavior, and response wiring could make observability unreliable exactly when failures occur.

### F1 (P3, downgraded from P2): Metrics schema has no explicit versioning — Accepted (partial)
Added `schema_version: 1` to `RoundMetrics` and explicit ISO-8601 UTC timestamp convention. Rejected the migration path and backward-read strategy as premature — no prior versions exist and no external consumers are implemented. The version field is there for future use.

### F2 (P3, downgraded from P2): Crash/kill scenarios bypass `finally` — Rejected
The risk is inherent to every Node.js process and applies equally to all existing session I/O (state, feedback, response files). None of those use write-ahead logs or signal handlers. The stderr start line emitted before the provider call covers the "what was running when I killed it?" scenario. Adding initial-record-before-invocation and signal flush handlers introduces significant complexity (new states, lifecycle management) for a rare, self-evident scenario.

### F3 (P2): User-facing `timing` coupled to filesystem I/O — Accepted
Changed architecture so `invokeWithStateMachine` returns `{ result, metrics }` and timing flows in-memory through round functions to MCP tools. Disk persistence is a fire-and-forget side-effect. This eliminates the filesystem dependency from the response path entirely.

### F4 (P3, downgraded from P2): Non-atomic overwrite risk — Rejected
All existing writes in the codebase (`writeSessionState`, `writeRoundFeedback`, `writeRoundResponse`, plan file updates) use bare `writeFileSync`. Adding atomic writes for metrics alone while session state uses direct writes would be inconsistent. This is a project-wide infrastructure concern, not specific to telemetry files.

### F5 (P3, downgraded from P2): Failure logs may leak sensitive stderr content — Rejected
Existing code already logs raw provider stderr (claude.ts:160, operations.ts:479-481). The new format standardizes what's already exposed without expanding the surface. Sanitization would need to be applied project-wide to be meaningful — out of scope for this change.

### F6 (P2): Integration tests for MCP timing responses missing — Accepted
Added timing propagation tests: verify `invokeWithStateMachine` returns metrics alongside result, verify `runReviewRound` propagates timing in its return type, verify timing is absent when metrics collection fails. Scoped to the propagation chain rather than full MCP tool integration tests (which would require broader test infrastructure).

### F7 (P2): MCP timing contract is not tested at the tool boundary — Accepted
The propagation tests from F6 verify the chain through round functions but stop short of the MCP tool handlers where the final response JSON is constructed. Added handler-level boundary tests for `get-feedback.ts` and `revise.ts` that mock the round function return and assert the response JSON includes `timing` when present and omits it when unavailable. These are handler-level unit tests with mocked dependencies — not full MCP server integration tests, keeping the test infrastructure lightweight.

### F8 (P3): Write-failure and collection-failure expectations are conflated — Accepted
Split the conflated timing propagation test case into two distinct scenarios: (1) `writeRoundMetrics` throws → in-memory timing still present in round return (disk failure is independent of in-memory metrics), (2) metrics collection itself fails or context absent → timing is `undefined`. Added a corresponding "Collection failure" bullet to Verification Criteria to make the distinction explicit alongside the existing "Fail-open guarantee" bullet.