# Structured Output Schemas for Feedback & Revision Parsing

**Status:** Approved
**planpong:** R5/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | detail | 3P2 1P3 → 6P2 → 1P2 1P3 → 1P2 → 1P3 | Accepted: 11 | Rejected: 1 | Deferred: 1 | +121/-0 lines | 19m 34s | Approved after 5 rounds

## Context

Planpong currently extracts JSON from freeform model output using a multi-strategy parser: `<planpong-feedback>` sentinel tags, JSON code fences, raw JSON detection, with phase-specific schema fallback to base schema. Both Claude Code (`--output-format json --json-schema '...'`) and Codex CLI (`--output-schema <file>`) now support constrained JSON output, which guarantees the model produces valid JSON matching a given schema. This eliminates the most common failure mode — malformed or unwrapped JSON — and can simplify the parsing pipeline.

## Steps

- [ ] Add `zod-to-json-schema` dependency
- [ ] Create JSON Schema generation module (`src/schemas/json-schema.ts`)
  - Export functions that convert the four Zod schemas (DirectionFeedback, RiskFeedback, ReviewFeedback, PlannerRevision) to JSON Schema objects
  - Generate at module load time (schemas are static), cache as constants
  - Document which Zod features do NOT round-trip to JSON Schema: refinements (e.g., the `approved_with_notes` severity constraint on `ReviewFeedbackSchema`) and transforms are not representable. The generated JSON Schema enforces structure; Zod enforces semantic rules post-parse.
  - Add contract tests: for each schema, generate JSON Schema from Zod, validate sample payloads against both JSON Schema (via ajv or similar) and Zod, assert structural equivalence
- [ ] Run provider schema acceptance smoke tests during development (F1 mitigation)
  - For each of the 4 generated JSON Schemas, run a real invocation through each provider's structured output mode with a trivial prompt (e.g., "Generate a sample feedback response")
  - Verify: (1) the provider accepts the schema without error, (2) the output parses as valid JSON, (3) the output passes Zod validation
  - Document any schema features that a provider rejects or silently ignores — adjust the generated schema if needed (e.g., remove unsupported `$schema` or `format` keywords)
  - This is a dev-time gate, not a runtime check — the runtime capability probe + auto-downgrade handles production failures
- [ ] Extend `InvokeOptions` with an optional `jsonSchema` field
  - Type: `Record<string, unknown> | undefined`
  - When provided, providers pass it to their respective CLI flags
- [ ] Update Claude provider to use `--output-format json --json-schema` when `jsonSchema` is set
  - When `jsonSchema` is present: replace `--output-format text` with `--output-format json --json-schema '<stringified>'`
  - When absent: keep current `--output-format text` behavior (backward compat for non-structured calls)
- [ ] Update Codex provider to use `--output-schema <file>` when `jsonSchema` is set
  - Write JSON Schema to a temp file (same pattern as output file)
  - Pass `--output-schema <path>` in args
  - Clean up temp file after invocation
- [ ] Implement runtime structured output capability detection per provider
  - Add `checkStructuredOutputSupport(): Promise<boolean>` to the `Provider` interface
  - Claude provider: on first call, run `claude --help` and check for `--json-schema` flag presence. Cache result for session lifetime.
  - Codex provider: on first call, run `codex exec --help` and check for `--output-schema` flag presence. Cache result for session lifetime.
  - If the probe fails or times out, default to `false` (use legacy path)
  - Add a `markNonCapable()` method that operations can call to disable structured output for the remainder of the session (used by the invocation state machine on runtime failures)
  - Providers perform a single invocation attempt and return the raw result — they do NOT retry or downgrade internally. All retry/downgrade decisions are owned by the operations-layer state machine (see F7).
  - Log a clear diagnostic when capability probe returns false: `[planpong] Structured output not supported by {provider} — using legacy parsing`
- [ ] Define typed provider error categories for invocation results (F9 mitigation)
  - Provider `invoke()` returns a discriminated result: `{ ok: true, output: string }` or `{ ok: false, error: ProviderError }`
  - `ProviderError` is a tagged union with at least two categories:
    - `capability`: schema rejected, flag unrecognized at runtime, structured output format error — anything indicating the CLI doesn't support the requested structured output mode. These are downgrade-eligible.
    - `fatal`: auth failure, timeout, network/transport error, non-zero exit with no output — problems unrelated to structured output capability. These are terminal.
  - Classification heuristic: if the error message or exit code indicates schema/format rejection (e.g., "unknown flag", "invalid schema"), classify as `capability`. All other failures default to `fatal`.
  - This keeps providers single-shot — they classify the error but do not act on it. The state machine decides.
- [ ] Implement invocation state machine in `operations.ts` (F3, F7, F9 mitigation)
  - The operations layer is the single owner of all retry and downgrade logic. Providers are single-shot: they attempt one invocation and return the result or a typed error. This prevents conflicting retry behavior across layers and ensures prompt regeneration always occurs on downgrade.
  - Each review/revision operation follows a strict attempt sequence with at most 2 invocations:
    1. **Structured attempt**: invoke with `jsonSchema` set, structured prompt (no wrapping instructions)
    1b. **If provider returns a `capability` error** (F9): auto-downgrade — call `provider.markNonCapable()`, regenerate prompt in legacy mode (with wrapping instructions — see F4), re-invoke without `jsonSchema`. This is the single allowed retry. If provider returns a `fatal` error: terminal error — do NOT downgrade (the failure is unrelated to structured output).
    2. **If JSON.parse fails**: auto-downgrade — call `provider.markNonCapable()`, regenerate prompt in legacy mode (with wrapping instructions — see F4), re-invoke without `jsonSchema`. This is the single allowed retry.
    3. **If Zod validation fails**: terminal error for this round — do NOT retry (JSON was structurally valid, semantic constraint violated). Return a typed `ZodValidationError` to the caller.
    4. **If legacy attempt also fails**: terminal error — throw with full diagnostic context
  - Steps 1b and 2 are mutually exclusive within a single structured attempt — a provider error (1b) means no output was produced, so JSON.parse (2) is never reached, and vice versa. Both lead to the same downgrade path but are triggered by distinct failure signals.
  - Track attempt state explicitly: `{ mode: 'structured' | 'legacy', attempt: number }` — no implicit retries
  - Log each state transition: `[planpong] Round {n}: structured → legacy (reason: {reason})`
- [ ] Update `operations.ts` to pass the appropriate schema per invocation
  - `runReviewRound`: check `provider.checkStructuredOutputSupport()` (cached after first call), select schema based on phase (direction/risk/detail)
  - `runRevisionRound`: always pass PlannerRevision schema when structured output is supported
  - Thread `jsonSchema` through the `invoke()` call in `InvokeOptions`
- [ ] Simplify `convergence.ts` parsing pipeline
  - When structured output is used, the provider output is already valid JSON — skip tag/fence extraction
  - Keep the legacy extraction pipeline (`extractJSON` + fallback logic) as the degradation path — this is fallback mode, not an equal peer (see Key Decisions)
  - Add a `structuredOutput: boolean` flag to `parseFeedbackForPhase` and `parseRevision`
  - When `structuredOutput` is true: `JSON.parse()` → Zod validate → done. If `JSON.parse` fails (provider-level failure), throw a `StructuredOutputParseError` (distinct from `ZodValidationError`) — caller handles auto-downgrade. If Zod validation fails, throw `ZodValidationError` with the specific validation errors — caller treats this as terminal for the round (F2 mitigation).
  - When false: existing tag/fence/fallback pipeline (legacy/degradation mode)
- [ ] Update prompts to remove JSON wrapping instructions when structured output is active
  - The "Wrap your JSON response in `<planpong-feedback>` tags" instruction is unnecessary (and potentially confusing) when the model is already constrained to JSON output
  - Add a `structuredOutput` parameter to `buildReviewPrompt` and `buildRevisionPrompt`
  - When true: omit the tag wrapping instructions and the `<planpong-feedback>YOUR_JSON_HERE</planpong-feedback>` template
  - When false: keep existing prompt format
- [ ] Ensure auto-downgrade regenerates prompts in legacy mode (F4 mitigation)
  - When auto-downgrade triggers in the invocation state machine, the legacy re-invocation MUST call `buildReviewPrompt` / `buildRevisionPrompt` again with `structuredOutput: false` to include wrapping instructions
  - Do NOT reuse the structured-mode prompt for legacy invocation — this is an explicit invariant
  - Add end-to-end test: structured prompt (no wrapping instructions) → JSON.parse failure → prompt regenerated with `structuredOutput: false` (wrapping instructions present) → legacy parse succeeds
- [ ] Update retry logic in `operations.ts`
  - Superseded by the invocation state machine (F3). The state machine defines all retry/downgrade behavior:
    - `JSON.parse` failure on structured output → single auto-downgrade to legacy (prompt regenerated per F4)
    - Provider `capability` error on structured output → single auto-downgrade to legacy (prompt regenerated per F4) (F9)
    - Provider `fatal` error → terminal, no downgrade (F9)
    - Zod validation failure on structured output → terminal `ZodValidationError`, no retry. Caller receives a typed error with validation details and can report it to the user.
    - Legacy parse failure → terminal error, no further retries
  - Remove the previous "pass Zod-invalid data through" behavior — invalid data must not propagate past the parsing boundary (F2)
- [ ] Wire up end-to-end: `operations.ts` checks `provider.checkStructuredOutputSupport()`, passes schema when supported, sets `structuredOutput` flag on parsing calls, handles auto-downgrade via the invocation state machine
- [ ] Add/update tests
  - Unit: JSON Schema generation matches expected output for each Zod schema
  - Unit: Contract tests — validate sample payloads against both JSON Schema and Zod, assert agreement on the structural subset (document expected divergences for refinements)
  - Unit: `parseFeedbackForPhase` with `structuredOutput: true` — direct JSON parse, no tag extraction
  - Unit: `parseRevision` with `structuredOutput: true`
  - Unit: `parseFeedbackForPhase` with `structuredOutput: true` and Zod-invalid data — throws `ZodValidationError`, does NOT pass data through (F2)
  - Unit: `buildReviewPrompt` omits wrapping instructions when `structuredOutput: true` (`src/prompts/reviewer.test.ts`)
  - Unit: `buildRevisionPrompt` omits wrapping instructions when `structuredOutput: true` (`src/prompts/planner.test.ts`)
  - Unit: capability probe caching — second call returns cached result without re-probing
  - Unit: invocation state machine — structured failure triggers exactly one legacy retry with regenerated prompt (F3, F4)
  - Unit: invocation state machine — Zod failure is terminal, no retry (F2, F3)
  - Unit: invocation state machine — maximum 2 invocations per operation enforced (F3)
  - Unit: provider `invoke()` is called at most once per state machine attempt — no provider-internal retries (F7)
  - Unit: invocation state machine — provider `capability` error triggers downgrade with `markNonCapable()` and prompt regeneration (F9)
  - Unit: invocation state machine — provider `fatal` error is terminal, no downgrade attempted (F9)
  - Integration: provider args include `--json-schema` / `--output-schema` when schema is provided
  - Integration: provider with missing structured output support gracefully degrades to legacy path
  - Integration: auto-downgrade regenerates prompt with wrapping instructions and parses successfully (F4)

## Pre-Release Provider Smoke Test Checklist (F6 mitigation)

Before merging, manually execute the following and record results:

- [ ] Claude provider: `DirectionFeedbackSchema` → structured output → valid JSON → Zod passes
- [ ] Claude provider: `RiskFeedbackSchema` → structured output → valid JSON → Zod passes
- [ ] Claude provider: `ReviewFeedbackSchema` → structured output → valid JSON → Zod passes
- [ ] Claude provider: `PlannerRevisionSchema` → structured output → valid JSON → Zod passes
- [ ] Codex provider: `DirectionFeedbackSchema` → structured output → valid JSON → Zod passes
- [ ] Codex provider: `RiskFeedbackSchema` → structured output → valid JSON → Zod passes
- [ ] Codex provider: `ReviewFeedbackSchema` → structured output → valid JSON → Zod passes
- [ ] Codex provider: `PlannerRevisionSchema` → structured output → valid JSON → Zod passes
- [ ] Document any schema adjustments needed (unsupported JSON Schema features, etc.)
- [ ] Verify `updated_plan` field roundtrips correctly with realistic plan content (code fences, special chars)

## File References

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `zod-to-json-schema` dependency |
| `src/schemas/json-schema.ts` | Create | JSON Schema generation from Zod schemas |
| `src/providers/types.ts` | Modify | Add `jsonSchema` to `InvokeOptions`, `checkStructuredOutputSupport` and `markNonCapable` to `Provider`, define `ProviderError` tagged union (`capability` \| `fatal`) and discriminated invoke result type |
| `src/providers/claude.ts` | Modify | Use `--output-format json --json-schema` when schema provided; implement capability probe with caching; single-shot invocation (no internal retry); classify invocation errors as `capability` or `fatal` |
| `src/providers/codex.ts` | Modify | Use `--output-schema <file>` when schema provided; implement capability probe with caching; single-shot invocation (no internal retry); classify invocation errors as `capability` or `fatal` |
| `src/core/operations.ts` | Modify | Invocation state machine (single owner of all retry/downgrade logic), pass schemas to providers, thread structured output flag, handle auto-downgrade with prompt regeneration, handle provider error classification (capability → downgrade, fatal → terminal) |
| `src/core/convergence.ts` | Modify | Add structured output parsing path with typed errors (`StructuredOutputParseError`, `ZodValidationError`), keep legacy path as degradation fallback |
| `src/prompts/reviewer.ts` | Modify | Conditionally omit tag wrapping instructions |
| `src/prompts/planner.ts` | Modify | Conditionally omit tag wrapping instructions |
| `src/schemas/json-schema.test.ts` | Create | Tests for Zod→JSON Schema conversion + contract tests |
| `src/core/convergence.test.ts` | Modify | Add structured output parsing tests including Zod failure behavior |
| `src/core/operations.test.ts` | Create/Modify | Invocation state machine tests: attempt caps, downgrade transitions, prompt regeneration, single-layer retry ownership, provider error classification (F9) |
| `src/prompts/reviewer.test.ts` | Modify | Add structured output prompt tests for `buildReviewPrompt` |
| `src/prompts/planner.test.ts` | Create/Modify | Add structured output prompt tests for `buildRevisionPrompt` |

## Verification Criteria

- `npm run typecheck` passes with no errors
- All existing tests pass (no regressions)
- New tests cover: schema generation, contract equivalence, structured parsing path, prompt adaptation, provider arg construction, capability probing, invocation state machine, auto-downgrade with prompt regeneration, provider error classification (capability vs fatal)
- When a provider supports structured output, no `<planpong-feedback>` tags appear in the prompt
- When a provider does not support structured output (or is downgraded), behavior is identical to current (legacy/degradation mode)
- The `updated_plan` field in PlannerRevision (full markdown serialized as JSON string) roundtrips correctly through structured output — special characters, code blocks, and nested markdown are preserved
- Auto-downgrade from structured output to legacy mode works transparently when a provider's CLI doesn't support the required flags
- Auto-downgrade regenerates the prompt with wrapping instructions (not reusing the structured prompt)
- Capability probe is called at most once per provider per session
- Zod validation failures on structured output are terminal — invalid data never propagates past the parsing boundary
- Maximum 2 invocations per review/revision operation (1 structured + 1 legacy fallback)
- Provider `invoke()` is never called more than once per state machine attempt — providers do not retry internally (F7)
- Provider `capability` errors trigger downgrade; provider `fatal` errors are terminal — no conflation (F9)
- Pre-release provider smoke test checklist completed for all 4 schemas × 2 providers

## Key Decisions

### Use `zod-to-json-schema` over manual conversion

Manual JSON Schema construction would duplicate the Zod schemas and drift over time. `zod-to-json-schema` is well-maintained, handles Zod's type system correctly (enums, optional fields), and keeps a single source of truth. The tradeoff is a new dependency (~15KB), but schema correctness is more important than bundle size for a CLI tool.

**Known limitation:** Zod refinements (e.g., the `approved_with_notes` severity constraint on `ReviewFeedbackSchema`) and transforms are not representable in JSON Schema. The generated JSON Schema enforces structural validity; Zod validates semantic rules post-parse. Contract tests verify this boundary explicitly.

### Keep the legacy parsing path as a degradation fallback

The legacy extraction pipeline (`extractJSON`, sentinel tags, code fences) is retained as a **fallback/degradation mode**, not an equal peer to structured output. It activates when: (1) a provider's CLI doesn't support structured output flags (detected via runtime probe), (2) a structured output invocation fails at the CLI level and triggers auto-downgrade, or (3) a future provider doesn't support constrained output.

This is intentionally asymmetric — structured output is the primary path, legacy is insurance. The legacy path already exists and is tested; keeping it costs near zero. Mark with `// TODO: deprecate when structured output is stable across all providers` for future cleanup.

### Runtime capability detection over static boolean

CLI tools evolve independently of planpong. A user might have an older `claude` binary that doesn't understand `--json-schema`, or a CI environment with a pinned version. Rather than a hardcoded `supportsStructuredOutput(): boolean`, each provider probes its CLI on first invocation (checking `--help` output for the relevant flag), caches the result for the session, and falls back to legacy mode if the flag isn't present.

### Pass schema via `InvokeOptions` rather than provider constructor

Schemas are per-invocation (different phases use different feedback schemas, reviewer vs planner use different schemas). Putting the schema in `InvokeOptions` keeps the provider stateless and lets `operations.ts` select the right schema per call. The alternative — configuring schema at provider construction — would require the provider to know about planpong's phase system, which breaks the abstraction.

### Don't use JSON Schema conditional validation for blocked-verdict rationale

JSON Schema supports `if/then/else` for conditional constraints (e.g., "if verdict is blocked, then approach_assessment must be non-empty"). However, LLM structured output implementations may not fully support these conditional constructs. Keep the blocked-verdict rationale validation in `convergence.ts` as post-parse Zod validation — it's explicit, testable, and doesn't depend on CLI-level schema support.

### `updated_plan` as a JSON string field is acceptable

The PlannerRevision schema contains `updated_plan` — the full revised markdown plan serialized as a JSON string. This means the model must produce a JSON object where one field is an escaped markdown document. This works because: (1) both Claude and Codex handle long string fields in structured output, (2) the plan content is authored by the same model producing the JSON, so encoding is natural, and (3) the alternative (splitting plan content from metadata) would require a fundamentally different response format. Risk: plans with complex code blocks or deeply nested markdown might cause JSON escaping issues. Mitigation: test with realistic plan content containing code fences, quotes, and special characters. **Future consideration:** if plan sizes grow significantly, explore separating structured metadata from plan-body transport (e.g., artifact/file channel) — but current plan sizes (1-5KB) are well within structured output limits.

### Zod validation failures are terminal, not pass-through

When structured output produces valid JSON that fails Zod validation (e.g., a refinement like `approved_with_notes` with P1 issues), this is treated as a terminal error for the round — NOT retried and NOT passed through. Rationale: (1) the structured output mechanism worked correctly, so retrying won't help; (2) passing invalid data through violates the type contract that downstream code depends on and risks incorrect convergence decisions or crashes. The caller receives a typed `ZodValidationError` and can report the specific validation issue to the user.

### Invocation state machine with strict attempt caps and single-layer retry ownership

Each review/revision operation follows a deterministic two-attempt maximum: structured attempt → optional legacy retry → terminal error. This prevents duplicate invocations, bounds latency, and makes debugging straightforward. The state machine is explicit (`{ mode, attempt }`) rather than implicit retry loops, ensuring every transition is logged and testable.

**Retry ownership is single-layer (F7):** The operations-layer state machine is the exclusive owner of all retry and downgrade decisions. Providers are single-shot — they perform one invocation and return either the result or a typed failure reason (e.g., `StructuredOutputFailure`). Providers never retry internally. This ensures: (1) prompt regeneration always occurs on downgrade (F4 invariant), (2) total invocations never exceed the 2-attempt cap, (3) all state transitions are observable from one place. Providers expose `markNonCapable()` so the state machine can disable structured output for the session on runtime failure.

**Provider error classification (F9):** Provider invocation failures are classified into two categories: `capability` errors (schema rejected, flag unrecognized, structured output format errors) and `fatal` errors (auth failure, timeout, network/transport errors). Only `capability` errors trigger the downgrade path — these indicate the structured output mode isn't working and legacy mode should be tried. `fatal` errors are terminal because they reflect problems unrelated to structured output; downgrading would not help and would mask the real issue. Providers classify errors via heuristics on exit codes and error messages (e.g., "unknown flag" or "invalid schema" → `capability`; all others → `fatal`). The state machine acts on the classification without second-guessing it.

## Reviewer Feedback

**Summary:** The direction is solid, but the plan still has unmitigated integration and operational risks at the schema/CLI boundary and in retry-downgrade control flow. Without tightening those, rollout is likely to be flaky and cause significant rework.

### F1 (P2): No provider-schema compatibility gate before enabling structured mode — ACCEPTED
Mitigation: Dev-time schema acceptance smoke tests added. Run each generated schema through real provider invocations during development. Document and adjust for any unsupported JSON Schema features.

### F2 (P2): Zod validation failure path violates downstream invariants — ACCEPTED
Mitigation: Zod failures on structured output are now terminal errors (`ZodValidationError`). Invalid data never propagates past the parsing boundary. Added to Key Decisions.

### F3 (P2): Retry and downgrade transitions are underspecified — ACCEPTED
Mitigation: Explicit invocation state machine with strict 2-attempt cap: structured → legacy → fail. Deterministic logging at each transition. Added to Key Decisions.

### F4 (P2): Legacy reinvocation may use the wrong prompt shape — ACCEPTED
Mitigation: Auto-downgrade path MUST regenerate prompts with `structuredOutput: false`. Explicit invariant documented. End-to-end test added.

### F5 (P2): Capability caching conflates transient failures with true lack of support — REJECTED
Rationale: The probe runs local `--help` commands where transient failures are practically non-existent. Conservative caching (default to `false` on failure) is the correct trade — re-probing adds complexity for a near-zero probability failure mode.

### F6 (P2): Test strategy misses real provider enforcement behavior — ACCEPTED
Mitigation: Pre-release manual smoke test checklist added (4 schemas × 2 providers). Results must be documented before merge.

### F7 (P2): Retry/downgrade logic is duplicated between provider and operations — ACCEPTED
Mitigation: Providers are now single-shot — they invoke once and return the result or a typed failure reason. All retry/downgrade logic lives exclusively in the operations-layer state machine. Providers expose `markNonCapable()` for the state machine to call on runtime failures. The "re-invoke via legacy path" language removed from the provider capability detection step. Key Decision updated to document single-layer ownership. Test added asserting provider `invoke()` is called at most once per state machine attempt.

### F8 (P3): Revision prompt changes are not explicitly mapped to a planner prompt test file — ACCEPTED
Mitigation: Added `src/prompts/planner.test.ts` to File References table. Split the generic prompt test bullet into explicit per-file entries for both `buildReviewPrompt` and `buildRevisionPrompt`.

### F9 (P2): Structured CLI invocation failures are not explicitly handled by downgrade transitions — ACCEPTED
Mitigation: Provider `invoke()` now returns a discriminated result with typed errors classified as `capability` (downgrade-eligible) or `fatal` (terminal). State machine step 1b added: capability errors trigger downgrade with `markNonCapable()` and prompt regeneration; fatal errors are terminal. Error classification is heuristic-based in providers, acted on by the state machine. Two new test cases added (capability → downgrade, fatal → terminal). Key Decision updated to document provider error classification. `ProviderError` tagged union and discriminated result type added to `src/providers/types.ts`.