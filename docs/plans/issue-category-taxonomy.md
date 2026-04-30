# Per-Issue Category Taxonomy

**Status:** Approved
**planpong:** R6/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | detail | 3P2 → 1P1 5P2 → 2P2 → 1P2 → 1P2 → 1P3 | Accepted: 10 | Rejected: 3 | +84/-0 lines | 37m 52s | Approved after 6 rounds

## Context

Today the only structured dimension on a `FeedbackIssue` (other than severity P1/P2/P3) is `section: string` — a free-form pointer at where the issue applies in the plan. There's no way to ask "are the round-3 detail-phase issues mostly about test coverage, or about API contract gaps?" without reading every issue's title.

The risk-phase schema already proves the pattern works: `RiskEntrySchema` carries a `category: "dependency" | "integration" | "operational" | "assumption" | "external"` (`src/schemas/feedback.ts:64-70`). That category drives nothing today but it's there in the response, easy to count, and easy to filter. Extending the same idea to general-issue feedback gives the orchestrator (Claude Code consuming the MCP response) a structured handle on what kinds of problems each round is surfacing.

Categories also have a second-order benefit: they let the planner dispute or defer issues by *kind* rather than by individual ID. "I'm deferring all `test_coverage` issues to a v2" is a coherent revision strategy that's clumsy to express today. Surfacing aggregate counts per category in the MCP response makes that pattern legible.

This plan adds an `IssueCategory` enum, attaches a required `category` field to `FeedbackIssueSchema`, surfaces per-category counts in MCP responses, and adjusts the reviewer prompt so the model populates the field accurately. Because the existing risk-phase categories are domain-specific to risks (`dependency`, `external`, etc.) and don't apply to general issues, the new enum is separate and lives alongside the risk one.

Because category boundaries are inherently fuzzy (e.g., "is this a `correctness` or `contract` issue?"), the reviewer prompts include a disambiguation rubric — explicit decision rules for choosing between overlapping categories. This keeps the taxonomy single (one enum across all phases, enabling cross-phase aggregation) while reducing inconsistent labeling.

**Limitation:** A required category forces the reviewer to classify every issue into the predefined enum. Issues that don't cleanly fit will get crammed into the closest fit (`other`). Aggregate counts are only as useful as the taxonomy is well-chosen; bad categorization produces noisy aggregates. Mitigation: the enum is small (≤8 values), includes `other` as the explicit catch-all, and the disambiguation rubric reduces misclassification at the fuzzy boundaries. Unit tests assert that the reviewer prompt's example uses categories that round-trip through Zod.

## Steps

- [ ] Define the `IssueCategory` enum in `src/schemas/feedback.ts`
  - `IssueCategorySchema = z.enum([...])` with values: `correctness`, `contract`, `test_coverage`, `observability`, `documentation`, `scope`, `style`, `other`.
  - **Why these values:** `correctness` (logic bugs, race conditions, wrong default values — errors in behavior *within* a single component), `contract` (schema mismatches, missing/incompatible fields, breaking changes — errors in the interface *between* components), `test_coverage` (missing test cases, uncovered branches, inadequate assertions), `observability` (missing logs, metrics, error reporting, alerting gaps), `documentation` (missing rationale, unclear instructions, stale references — problems with what the plan *says*, not what it *does*), `scope` (out-of-scope work, missing prerequisites, scope expansion — problems with what the plan *includes or excludes*), `style` (naming, formatting, organization, convention violations). `other` is the explicit catch-all so reviewers don't force-fit.
  - **Disambiguation boundaries:**
    - `correctness` vs `contract`: If the issue is about wrong behavior *within* a component, use `correctness`. If it's about a mismatch *between* components or systems, use `contract`.
    - `scope` vs `documentation`: If the plan includes or excludes the wrong work, use `scope`. If the plan's text is unclear, missing, or stale, use `documentation`.
    - `correctness` vs `test_coverage`: If the plan's logic is wrong, use `correctness`. If the logic is right but untested, use `test_coverage`.
  - The enum is exported as `IssueCategory` type for use in MCP response types.
  - Define `CATEGORY_TAXONOMY_VERSION = 1` as a constant alongside the enum. This version is bumped whenever the enum values change.

- [ ] Add `category: IssueCategorySchema` to `FeedbackIssueSchema` in `src/schemas/feedback.ts`
  - Required, no default. Same rollout strategy as severity (P1/P2/P3): hard requirement via JSON schema strict mode. The CLI-enforced structured output (`--json-schema` / `--output-schema`) means the model cannot omit required fields — the CLI rejects malformed output before it reaches Zod parsing.
  - Place it next to `severity` in the schema so the structural ordering signals "primary classification dimensions."
  - Update the existing `FeedbackIssue` type export (it's `z.infer<typeof FeedbackIssueSchema>` so it picks up the new field automatically).

- [ ] Update the JSON Schema generator in `src/schemas/json-schema.ts` (or wherever `getFeedbackJsonSchemaForPhase` is defined per `src/core/operations.ts:29`)
  - Add `category` to the issue object's `required` array for all three phases.
  - Add the enum values to the schema property — under OpenAI strict mode, the generator already handles `z.enum` correctly, so this should pick up automatically. Verify by inspecting the generated schema for one phase before committing.

- [ ] Add schema round-trip tests for category field in `src/schemas/json-schema.test.ts`
  - For each phase (direction, risk, detail): generate the JSON schema via `getFeedbackJsonSchemaForPhase`, construct a minimal conforming payload with a `category` value from `IssueCategorySchema`, parse with the corresponding Zod schema, and assert the `category` field round-trips correctly.
  - For risk phase specifically: construct a payload containing both `issue.category` (from `IssueCategorySchema`) and `risk.category` (from `RiskEntrySchema`), and assert both parse independently without cross-contamination.
  - This validates the assumption that the JSON schema generator correctly maps `z.enum` for the new field across all phase code paths.

- [ ] Update reviewer prompts in `src/prompts/reviewer.ts`
  - Update each phase's example JSON (the `buildDirectionJsonSchema`, `buildRiskJsonSchema`, `buildDetailJsonSchema` blocks) to include `"category": "..."` with a realistic value per phase. The example serves both as documentation and as in-prompt guidance for the model.
  - In each phase's instruction block (`buildDirectionReviewInstructions`, `buildRiskReviewInstructions`, `buildDetailReviewInstructions`), add a **disambiguation rubric** — not just definitions, but explicit decision rules for the fuzzy boundaries:
    - **Decision tree** (applies to all phases): "Choose the category that describes *what is wrong*, not *where* the issue is. If two categories seem to fit, apply: (1) `correctness` vs `contract` — is the error within one component or between two? (2) `scope` vs `documentation` — is the plan doing the wrong work, or describing the right work poorly? (3) `correctness` vs `test_coverage` — is the behavior wrong, or just unverified? When still ambiguous, prefer the category that would change the implementation, not the one that would change the documentation."
    - Keep the rubric under 15 lines. The model already gets the enum values from the JSON schema; the rubric resolves tie-breaks.
  - Direction phase: note that `scope` and `contract` are the most common categories at this phase. Risk phase: note that `correctness` and `observability` dominate. Detail phase: all categories are valid.
  - **Risk-phase dual-category disambiguation (F2 mitigation):** In the risk-phase instructions, add an explicit note: "This phase has two distinct category fields: each *issue* carries `category` (one of: correctness, contract, test_coverage, observability, documentation, scope, style, other) classifying the type of problem; each *risk entry* carries `category` (one of: dependency, integration, operational, assumption, external) classifying the type of risk. These are independent classifications — do not confuse them." In the risk-phase example JSON, show both fields with realistic values and annotate the distinction.

- [ ] Update the planner prompt in `src/prompts/planner.ts`
  - In the issue rendering template (the `.map()` block at ~line 43-48 that formats each issue), add the `category` field to the rendered output. Update the template from:
    ```
    `### ${issue.id} (${issue.severity}): ${issue.title}\n**Section:** ${issue.section}\n**Description:** ${issue.description}\n**Suggestion:** ${issue.suggestion}`
    ```
    to:
    ```
    `### ${issue.id} (${issue.severity}): ${issue.title}\n**Category:** ${issue.category}\n**Section:** ${issue.section}\n**Description:** ${issue.description}\n**Suggestion:** ${issue.suggestion}`
    ```
    Place `Category` immediately after the heading line (alongside severity) since both are primary classification dimensions.
  - In the revision-instructions block, add: "Each issue carries a `category`. You may invoke category in your rationale (e.g., 'rejected — this is a `style` concern out of scope for this PR'). Categories are reviewer-assigned hints, not strict gates — your judgment on each issue still applies individually."
  - Add a planner prompt test in `src/prompts/planner.test.ts` (extend if exists, create if not): construct a feedback payload with issues that have `category` values, call `buildRevisionPrompt`, and assert the rendered prompt contains `**Category:** <value>` for each issue. This validates that category is wired through to the planner's visible context.

- [ ] Surface per-category counts and taxonomy version in MCP responses
  - `planpong_get_feedback` response: add `category_counts: Partial<Record<IssueCategory, number>>` and `category_taxonomy_version: number`, **emitted only when `has_native_categories === true`**. When `has_native_categories` is `false` (legacy backfill), omit both fields to avoid surfacing synthetic aggregates as real categorization data. Computed by iterating `feedback.issues` and tallying. Zero counts are omitted (sparse map semantics — absent keys mean zero, not missing data).
  - `planpong_status` response: include `category_counts` and `category_taxonomy_version` per round, **but only for rounds where `has_native_categories` is `true`**. Legacy rounds that were backfilled with `category: "other"` have `has_native_categories: false` and omit these fields to avoid surfacing synthetic aggregates as real data (see backwards compatibility step).
  - `planpong_revise` response: optional. The revision response is per-issue today and the existing `accepted/rejected/deferred` counts already carry that signal — adding category_counts here is duplicative. Skip unless a concrete consumer needs it.
  - Provide a `normalizeCategoryCounts(sparse: Partial<Record<IssueCategory, number>>): Record<IssueCategory, number>` helper that fills absent categories with zero, for consumers that need dense vectors.

- [ ] Add `category_counts` and `category_taxonomy_version` to `RoundMetrics` in `src/schemas/metrics.ts`
  - Schema field: `category_counts: z.record(IssueCategorySchema, z.number().int().nonnegative()).optional()`. This schema is sparse-correct at runtime: Zod's `z.record()` validates present keys against the enum but does not require all enum keys, so `{ correctness: 3 }` passes validation with absent categories implicitly zero.
  - **Type annotation (F2 fix):** The `z.infer` of `z.record(IssueCategorySchema, z.number())` produces `Record<IssueCategory, number>` (dense), which misrepresents the sparse contract at the TypeScript level. Override this by explicitly typing the field as `Partial<Record<IssueCategory, number>> | undefined` in the `RoundMetrics` type (either via a manual type definition that extends `z.infer` with the override, or by casting at usage sites). The runtime validation is already correct — this fix aligns the static types with the runtime behavior.
  - Schema field: `category_taxonomy_version: z.number().int().positive().optional()`. Optional because pre-this-change rounds don't have it, and legacy-backfilled rounds intentionally omit it.
  - `summarizeTiming` is unrelated and unchanged. Add a separate `summarizeCategories(metrics: RoundMetrics): Partial<Record<IssueCategory, number>>` helper for the MCP response builders to consume. Returns sparse map (omits zero counts).
  - **Sparse validation test (F2 fix):** Add a test in `src/schemas/metrics.test.ts` confirming that `RoundMetricsSchema` accepts a `category_counts` payload with a subset of category keys (e.g., `{ correctness: 3 }`) and that `normalizeCategoryCounts` fills absent categories with zero, producing a dense record with all 8 categories.

- [ ] Backwards compatibility
  - Sessions started before this change have feedback files without `category`. The session.ts read path (`readRoundFeedback`) currently does a raw `JSON.parse` with type cast and no Zod validation, so adding the field to the schema won't break reads — but downstream code accessing `.category` on legacy issues will get `undefined`.
  - Mitigation: in `readRoundFeedback`, after parsing, check if any issue lacks a `category` field. If so, patch each missing `category` with `"other"` and set `has_native_categories: false` on the returned feedback object. If all issues already have a valid `category`, set `has_native_categories: true`. Log a one-line warning to stderr for the legacy case (`[planpong] warn: round N feedback missing categories — defaulted to "other"`).
  - **Total provenance (F1 fix):** `has_native_categories` is a required boolean on the internal feedback object returned by `readRoundFeedback`, set in every code path — `true` when no backfill was needed, `false` when any issue was patched. This ensures MCP response builders can gate on `has_native_categories === true` without risk of `undefined` suppressing native aggregates. The flag is set at the read boundary (inside `readRoundFeedback`), not left to callers.
  - For new feedback produced by `runReviewRound`: the result already passes through Zod validation which enforces the required `category` field, so all issues will have valid categories. Set `has_native_categories: true` on the feedback object returned from the review round, at the same boundary where the flag is set for reads.
  - For `category_taxonomy_version`: old sessions won't have this field; the optional schema handles it. No patching needed.
  - Document this in the schema comment block so future maintainers know why the read path is more lenient than the write path. The fallback is bounded (only the `category` field, only `"other"` as default) — not a generic best-effort parser.

- [ ] Unit tests
  - In `src/schemas/feedback.test.ts` (extend if exists, create if not):
    - Valid issue with each category value validates.
    - Issue missing `category` fails Zod with a specific error.
    - Issue with an unknown category string fails Zod.
    - Disambiguation rubric examples from the reviewer prompt all use valid category values (import the rubric examples and validate each against `IssueCategorySchema`).
  - In `src/core/convergence.test.ts`:
    - Parse a structured feedback payload with categories → all issues round-trip with the correct category.
    - Parse a legacy payload (no category) → backwards-compat patch fires, all issues become `category: "other"`, stderr warn appears.

- [ ] Risk-phase regression test (F2 mitigation)
  - In `src/mcp/tools/get-feedback.test.ts` or `src/core/operations.test.ts`: add a test case for risk-phase feedback that includes both `issue.category` (from `IssueCategorySchema`) and `risk.category` (from `RiskEntrySchema`). Assert that both parse correctly and independently. Mock the provider to return a risk-phase response with mixed issue categories and risk categories; verify no cross-contamination in the parsed result.
  - In the benchmark step: compare risk-phase `total_attempts` against baseline. If attempt count increases (indicating more retries due to schema confusion), investigate the prompt disambiguation before shipping.

- [ ] MCP boundary tests in `src/mcp/tools/get-feedback.test.ts` and `src/mcp/tools/status.test.ts`
  - Mock `runReviewRound` to return feedback with mixed categories (e.g., 3 `correctness`, 1 `test_coverage`, 1 `other`) and `has_native_categories: true`. Assert the response's `category_counts` is `{ correctness: 3, test_coverage: 1, other: 1 }` (sparse — no zero-count keys).
  - Assert `category_taxonomy_version` is present and equals `1`.
  - Mock to return feedback with all issues in one category. Assert other categories are absent (zero-count omission).
  - Test `normalizeCategoryCounts` helper: given sparse `{ correctness: 3 }`, returns dense record with all 8 categories, 7 of them zero.
  - For `planpong_get_feedback` with legacy round: mock `readRoundFeedback` to return feedback with `has_native_categories: false`. Assert `category_counts` and `category_taxonomy_version` are absent from the response.
  - For `planpong_status`: mock multiple rounds with different category distributions; assert each round's `category_counts` is correct independently and `category_taxonomy_version` is present.
  - For `planpong_status` with legacy rounds: mock a round with `has_native_categories: false`; assert `category_counts` and `category_taxonomy_version` are absent from that round's response.
  - **Native-round test (F1 fix):** Mock a round with `has_native_categories: true`; assert `category_counts` and `category_taxonomy_version` are present in that round's response. This is the complement of the legacy-round omission test and validates that the `true` path emits aggregates correctly.

- [ ] Manual verification + benchmark
  - Run planpong on `bench/plans/medium.md`. Confirm at least three categories show up across rounds (the medium plan is varied enough to produce mixed feedback).
  - Run the small-plan benchmark 3× and compare to `bench/baseline/small/`. Expectations:
    - `total_prompt_chars` increases 2–5% (added category instructions + disambiguation rubric in reviewer prompts, ~400 chars per phase).
    - `total_output_chars` increases 0–2% (one extra field per issue, ~30 chars).
    - `total_attempts` and `rounds` should not change. If they do, the category instruction or rubric is destabilizing the reviewer prompt.
  - **Risk-phase specific:** Compare risk-phase `total_attempts` to baseline. If retries increase, the dual-category prompt disambiguation needs revision before shipping.

## File References

| File | Change |
|---|---|
| `src/schemas/feedback.ts` | Add `IssueCategorySchema` enum, `CATEGORY_TAXONOMY_VERSION` constant, `category` required field on `FeedbackIssueSchema` |
| `src/schemas/feedback.test.ts` | Cover new enum, required-field validation, disambiguation rubric examples |
| `src/schemas/json-schema.ts` | Include `category` in required array for all phases |
| `src/schemas/json-schema.test.ts` | Schema round-trip tests per phase: generate JSON schema → construct payload → Zod parse → assert category field; risk phase dual-category test |
| `src/prompts/reviewer.ts` | Update example JSON + add disambiguation rubric with decision tree to each phase's instruction block; risk-phase dual-category disambiguation note |
| `src/prompts/planner.ts` | Add `category` to issue rendering template; add brief note that planners may invoke category in rationale; planner prompt test asserting category presence |
| `src/prompts/planner.test.ts` | Assert rendered revision prompt contains `**Category:** <value>` for each issue |
| `src/core/session.ts` | `readRoundFeedback` patches missing categories on legacy data with stderr warn; sets `has_native_categories` flag as required boolean in both paths (true for native, false for backfilled) |
| `src/core/convergence.test.ts` | Parse round-trip + legacy fallback cases |
| `src/schemas/metrics.ts` | Add optional `category_counts` (with explicit `Partial<Record<...>>` type override) and `category_taxonomy_version` to `RoundMetrics` + `summarizeCategories` helper + `normalizeCategoryCounts` helper |
| `src/schemas/metrics.test.ts` | Sparse payload validation: `{ correctness: 3 }` passes `RoundMetricsSchema`; `normalizeCategoryCounts` fills to dense 8-key record |
| `src/mcp/tools/get-feedback.ts` | Compute and include `category_counts` + `category_taxonomy_version` in response, gated on `has_native_categories === true`; omit both when `has_native_categories` is `false`; set `has_native_categories: true` on fresh review results |
| `src/mcp/tools/get-feedback.test.ts` | Boundary tests for `category_counts` shape, version field, sparse map semantics, risk-phase dual-category regression, native-round emission test, legacy-round omission test |
| `src/mcp/tools/status.ts` | Include per-round `category_counts` + `category_taxonomy_version` (gated on `has_native_categories`) |
| `src/mcp/tools/status.test.ts` | Per-round category-counts and version cases, legacy round omission test, native-round emission test |

## Out of Scope

- **Auto-routing issues by category.** The reviewer's category is informational; the planner doesn't gate on it. Adding policy ("auto-defer all `style` issues") would be a separate change with its own review.
- **Extending categories to `RiskEntry`** — risks already have their own `category` enum (`dependency`/`integration`/etc.) tuned to risk-specific reasoning. Mixing the two enums adds complexity for no clear payoff.
- **Multi-category issues.** The schema is single-valued. An issue that's both a `correctness` and `test_coverage` concern picks the more salient one per the disambiguation rubric. Multi-label classification is over-engineered for the current taxonomy size.
- **Confidence on category assignment.** Reviewer-assigned categories are noisy by nature; a confidence score would be noisier still. Aggregate counts are robust to occasional miscategorization.
- **Phase-specific category enums.** The architecture supports per-phase schemas, but the primary value of categories is cross-phase aggregate analysis. Separate enums per phase would require a mapping layer for cross-phase comparison, adding complexity without proportional signal improvement. The disambiguation rubric addresses the underlying concern (inconsistent labeling at fuzzy boundaries) more directly.
- **Response versioning / capability flags for MCP responses.** MCP tool responses are untyped JSON in text content blocks — the consumer (Claude) reads them as text with no schema validation. Additive fields are inherently backwards-compatible. Formal response versioning adds complexity for a non-existent consumer constraint.
- **Automated benchmark matrix across models/plans.** The existing benchmark step (1 medium + 3 small against baseline) is proportionate to the risk of an additive schema change. A full CI benchmark matrix belongs in a dedicated CI hardening initiative.

## Risks & Mitigations

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Risk-phase dual `category` fields (issue vs risk) cause model confusion and increased retries | P2 | Explicit disambiguation in risk-phase prompt; dual-category example JSON; regression test on attempt count | Mitigated (F2) |
| Legacy backfilled categories (`"other"`) pollute cross-round aggregates | P2 | `has_native_categories` flag (required boolean, set in both paths); legacy rounds omit `category_counts` and `category_taxonomy_version` from MCP responses; gating applied consistently to both `planpong_get_feedback` and `planpong_status` | Mitigated (F3, F1) |
| `category_counts` sparse map semantics misinterpreted as missing data by consumers | P2 | Type is `Partial<Record<...>>`; `normalizeCategoryCounts` helper provided for dense-vector consumers; documented as sparse; `z.infer` type overridden to match sparse contract | Mitigated (F4, F2) |
| JSON schema generator doesn't correctly map `IssueCategorySchema` enum across all phase paths | P2 | Schema round-trip tests per phase in `json-schema.test.ts` | Mitigated (F6) |

## Limitations & Future Work

- **Category drift across reviewer models.** Different models will categorize the same issue differently — `correctness` vs. `contract` is a judgment call even with the disambiguation rubric. Cross-session aggregates therefore mix categorization styles. The rubric reduces but does not eliminate this. If drift becomes a real problem (e.g., two operators see different category-count distributions), a calibration pass — feeding the same issue to multiple reviewers and comparing — would surface the drift. Out of scope for round 1.
- **Taxonomy evolution.** The `CATEGORY_TAXONOMY_VERSION` constant and response field enable clean migration when the enum changes. When adding or removing categories: bump the version, document the diff in a changelog constant alongside the schema, and update the backwards-compat patch in `readRoundFeedback` to handle the new version. Sessions created under older versions will continue to parse cleanly via the existing legacy fallback (patch missing `category` with `"other"`). Cross-version aggregate comparisons should filter by `category_taxonomy_version` to avoid mixing taxonomies.
- **No correlation with severity.** The plan tracks categories independently of severity. A future analysis could show "P1 issues are disproportionately `correctness`, P3 issues are mostly `style`" — useful for tuning the reviewer prompts. Not in scope for this change.

## Reviewer Feedback

**Summary:** The plan is close and addresses most prior findings, but two implementation-contract gaps remain that can cause incorrect or missing category aggregates.

### F1 (P2): `has_native_categories` true-path is not defined, so gating can suppress native aggregates — ACCEPTED
**Section:** Backwards compatibility; Surface per-category counts and taxonomy version in MCP responses
**Description:** The plan explicitly sets `has_native_categories: false` only when legacy issues are patched, then says MCP fields are emitted only when `has_native_categories` is true. It does not explicitly define how native rounds get `has_native_categories: true`. If implementers gate with a strict boolean check, native rounds can accidentally omit `category_counts` and `category_taxonomy_version` entirely.
**Suggestion:** Make provenance explicit and total: set `has_native_categories` on every read (`true` when no backfill happened, `false` otherwise), type it as required on the internal feedback object, and add tests that native rounds include category aggregates while legacy rounds omit them.
**Resolution:** Accepted. Updated the backwards compatibility step to explicitly set `has_native_categories: true` when no backfill is needed, and `has_native_categories: true` on fresh review results from `runReviewRound`. Added native-round emission test to MCP boundary tests. The flag is now a required boolean set at every boundary.

### F2 (P2): `RoundMetrics.category_counts` schema conflicts with declared sparse-map semantics — ACCEPTED
**Section:** Add `category_counts` and `category_taxonomy_version` to `RoundMetrics` in `src/schemas/metrics.ts`
**Description:** The plan defines sparse semantics (`Partial<Record<...>>`, absent keys mean zero, helper omits zeroes) but proposes `category_counts: z.record(IssueCategorySchema, z.number().int().nonnegative()).optional()`. This leaves the contract inconsistent at the schema layer and can force/validate a different shape than the intended sparse payload.
**Suggestion:** Align schema and contract by using an explicitly sparse schema (e.g., `z.partialRecord(IssueCategorySchema, z.number().int().nonnegative())` or equivalent), and add a test that `{ correctness: 3 }` is valid while omitted categories are treated as zero by `normalizeCategoryCounts`.
**Resolution:** Accepted with correction. Zod's `z.record()` is already sparse-correct at runtime — it validates present keys but does not require all enum keys. The real issue is the TypeScript type inference: `z.infer` produces `Record<IssueCategory, number>` (dense) rather than `Partial<Record<...>>` (sparse). Fix: keep `z.record()` for validation (correct), explicitly override the inferred type to `Partial<Record<IssueCategory, number>>`, and add a sparse payload validation test in `metrics.test.ts`.

### F1 (P2): `planpong_get_feedback` category field emission is internally inconsistent — ACCEPTED
**Section:** Surface per-category counts and taxonomy version in MCP responses; Backwards compatibility; src/mcp/tools/get-feedback.test.ts
**Description:** The plan states `planpong_get_feedback` should add `category_counts` and always include `category_taxonomy_version`, but elsewhere it treats legacy backfilled rounds (`has_native_categories: false`) as requiring omission of synthetic aggregates, and the file-reference section says `get-feedback.ts` is gated on `has_native_categories`. This leaves two conflicting implementation interpretations for the same endpoint. The test matrix includes legacy omission checks for `planpong_status`, but not an equivalent legacy-path assertion for `planpong_get_feedback`, so this inconsistency can ship undetected.
**Suggestion:** Make the `planpong_get_feedback` contract explicit and single-source: emit `category_counts` and `category_taxonomy_version` only when `has_native_categories === true`; omit both when false. Add a legacy-round test in `src/mcp/tools/get-feedback.test.ts` asserting omission on `has_native_categories: false`.
**Resolution:** Accepted. Updated the MCP response step to explicitly gate `planpong_get_feedback` emission on `has_native_categories === true`, matching `planpong_status` behavior. Added legacy-round omission test to the `get-feedback.test.ts` test matrix. Updated the file-reference table and risks table to reflect consistent gating across both endpoints.

### F1 (P2): Category-aware revision guidance is not wired into planner-visible issue context — ACCEPTED
**Section:** Update the planner prompt in `src/prompts/planner.ts`
**Description:** This step adds instruction text saying each issue carries a `category` and that planners may reference it in rationale, but it does not require updating the issue rendering block passed to the planner. In the current prompt construction, issues are rendered with id/severity/title/section/description/suggestion only, so category-based reasoning is not actually available to the planner unless the issue list format is extended.
**Suggestion:** Explicitly update the planner issue list template to include category for every issue (for example in the issue heading or a dedicated `Category:` line), and add/adjust planner prompt tests to assert category text is present in generated revision prompts.
**Resolution:** Accepted. The issue rendering template at `src/prompts/planner.ts:43-48` formats issues with id, severity, title, section, description, and suggestion — but not category. Telling the planner it can reference categories while not showing them is a dead letter. Updated the step to modify the `.map()` template to include a `**Category:** ${issue.category}` line immediately after the heading (alongside severity, since both are primary classification dimensions). Added a planner prompt test in `src/prompts/planner.test.ts` asserting that `**Category:** <value>` appears in the rendered prompt for each issue. Updated the file-reference table to include `src/prompts/planner.test.ts`.