# Diff-Only Revisions for Risk + Detail Phases

**Status:** Shipped (PR [#29](https://github.com/andrewhml/planpong/pull/29), commit `4cf34a6`, v0.5.0) — planpong review reached R3/10 before implementation. Edits mode is opt-in via `revision_mode: edits`; default remains `full`.

## Context

The dominant cost in a planpong run is the planner's revision output. Round-3 and round-4 revision response files for `docs/plans/evidence-verification.md` are 21–22 KB each (`.planpong/sessions/d648c2554a4c/round-3-response.json`, `round-4-response.json`) — almost all of which is the full plan markdown re-emitted inside the `updated_plan` JSON field. The planner spent 167s, 223s, and 206s on rounds 2–4 (`round-{2,3,4}-revision-metrics.json`) primarily reproducing content it had just been told not to change.

Round 5 of that same session hit the 300s provider timeout (`src/providers/claude.ts:126`) and killed convergence with two trivial issues outstanding. The proximate cause is output volume, not depth of thinking — the planner has to re-emit ~140 lines of plan markdown verbatim for every accepted change, even when only one paragraph is being touched.

This plan replaces `updated_plan` with a structured edit list (`edits: ReplaceEdit[]`) for the risk + detail phases. Each edit is a `{ section, before, after }` triple — scoped to a heading, then anchored by verbatim text replacement applied server-side. Direction phase (round 1) keeps the full-plan path because that's the round where sweeping rewrites are explicitly allowed (`src/prompts/planner.ts:51-53`).

Concretely, on a typical detail-phase revision that touches one issue:

- **Today:** planner outputs ~6 KB of unchanged plan + ~200 chars of new content. Total ~6.2 KB.
- **After:** planner outputs ~600 chars of edit context + ~200 chars of new content. Total ~800 bytes.

That's the ~10× reduction the round-2+ trimming concept was pointing at.

**Limitation:** Edit anchoring requires verbatim `before` strings scoped to a section. If the planner produces a `before` that doesn't match the current plan exactly (paraphrasing, structural errors), the edit fails at the apply step. Failed edits are retried individually with a targeted prompt before being abandoned — there is no full-plan fallback. The retry path is cheap (one targeted invocation per failed edit) and the worst case is a partially-applied revision, which is strictly better than no revision.

## Steps

- [ ] Define a `ReplaceEdit` schema in `src/schemas/revision.ts`
  - `ReplaceEdit = { section: string, before: string, after: string }`
  - `section` is a heading label (e.g., `"Steps"`, `"Limitations & Future Work"`) that scopes the search. The applier only looks for `before` within the content under this heading (from the heading line to the next heading of equal or higher level). This resolves multi-match ambiguity without injecting markers into the plan.
  - `before` MUST appear exactly once within the scoped section content (verbatim, case-sensitive, trailing-whitespace-normalized). The unique-match-within-section constraint is what guarantees the edit is unambiguous.
  - `after` is the replacement text. May be empty (deletion) or any length (insertion handled by including a small `before` and a larger `after`).
  - Hard caps: `before.length <= 2000`, `after.length <= 5000`. Prevents the planner from "editing" the entire plan in a single edit, which defeats the point.

- [ ] Define phase-specific revision schemas in `src/schemas/revision.ts`
  - **Direction phase** (round 1): schema unchanged — `{ responses: IssueResponse[], updated_plan: string }`. Sweeping rewrites are expected.
  - **Risk + detail phases** (rounds 2+): new schema — `{ responses: IssueResponse[], edits: ReplaceEdit[] }`. No `updated_plan` field. No `mode` discriminator. The planner cannot choose full output; it must express changes as edits.
  - Export both: `DirectionRevisionSchema` and `EditsRevisionSchema`. The consumer selects which schema to use based on the round's phase.
  - Type union: `PlannerRevision = DirectionRevision | EditsRevision`. Discriminated by presence of `updated_plan` vs. `edits`.

- [ ] Add a `revision_mode` config option to `PlanpongConfigSchema` in `src/schemas/config.ts`
  - `revision_mode: z.enum(["edits", "full"]).default("full")`
  - **Default is `"full"` for the initial release.** Edits mode is opt-in until benchmarks confirm the thresholds in the verification step. Flip the default to `"edits"` in a follow-up change after benchmark validation passes.
  - When `"full"`, risk/detail phases use the direction-phase schema (full `updated_plan` output) and skip the edit applier entirely. This is the kill switch — one config line disables the feature with zero new code paths executing.
  - Loadable from `planpong.yaml` and CLI overrides.

- [ ] Add an edit applier at `src/core/apply-edits.ts` (new file)
  - `applyEdits(plan: string, edits: ReplaceEdit[]): { plan: string; applied: EditResult[]; failures: EditFailure[] }`
  - **Section boundary parsing:** Scan the plan for ATX headings (`#`, `##`, `###`, etc.) while tracking fenced code block state (triple-backtick regions). Lines inside fenced code blocks are never treated as headings. Section content spans from the heading line to the next heading of equal or higher level (or EOF).
  - For each edit:
    1. Find the section boundary by locating the heading matching `edit.section`.
    2. If multiple headings share the same label, use the first match and log a warning to stderr.
    3. Normalize trailing whitespace on both `before` and the section content before matching.
    4. If `before` appears exactly once within the section, replace with `after` and record in `applied[]`.
    5. If zero matches or multiple matches within the section, record an `EditFailure { edit, reason: "no-match" | "multi-match", section_searched: string }`. **No plan-wide fallback search** — section-miss failures go to the retry path, which gives the planner the error message and current plan to produce a corrected edit.
  - Log diagnostic note on section-miss: "Edit for section '%s' did not match; a plan-wide search would have matched at [location]" — informational only, not applied. This aids debugging without risking silent mis-application.
  - Sequential application: later edits run against the partially-modified plan.
  - The `**planpong:**` status line is **always** preserved verbatim — applier rejects any edit whose `before` or `after` modifies the line starting with `**planpong:**`. Failure reason: `"status-line"`.
  - Pure function. Returns the new plan string + diagnostics. Does not write to disk.

- [ ] Wire the applier into `runRevisionRound` in `src/core/operations.ts`
  - Check `config.revision_mode`: if `"full"`, use direction-phase schema for all rounds (existing behavior). If `"edits"`, use phase-appropriate schema.
  - For direction-phase revisions (or `revision_mode: "full"`): behave exactly as today — write `revision.updated_plan` directly.
  - For edits-phase revisions: call `applyEdits(currentPlan, edits)`.
    - **All edit application happens in memory** — first-pass edits, then retry, then a single atomic write.
    - If `failures.length === 0` after first pass: persist the fully-edited plan via single `writeFileSync`. Done.
    - If failures exist after first pass: retry only the failed edits with a targeted prompt against the in-memory partially-edited plan. The retry prompt includes the current (partially-edited) plan and only the failed edits, asking the planner to re-express each failed edit with corrected `section` and `before` values. Cap at one retry pass.
    - After retry completes: merge first-pass successes with retry successes, apply retry edits to the in-memory plan, then persist the final result via single `writeFileSync`. If edits still fail after retry, log them to stderr and surface in the MCP response, but keep the partial result.
    - **Response-edit consistency check:** After all edits are finalized (first-pass + retry), cross-check each `accepted` response against the applied edits. If an accepted response has no corresponding successful edit (no edit whose content relates to that issue), downgrade the response action to `deferred` with rationale `"edit_not_applied: corresponding plan edit failed"`. This prevents false convergence where the planner claims to have addressed an issue but the plan text is unchanged.
    - Persist failure metadata (which edits failed, which were retried, which recovered) in the round response JSON alongside the plan write.
  - The retry counts as a separate `InvocationAttempt` in `RoundMetrics` (`src/schemas/metrics.ts:3`) with `error_kind: "edit-retry"`.

- [ ] Update the planner prompt in `src/prompts/planner.ts`
  - For risk + detail phases, replace the `updated_plan` schema field with an `edits` array. Schema block becomes:
    ```
    "edits": [{ "section": "Steps", "before": "exact text to replace", "after": "replacement text" }]
    ```
  - Add explicit instructions: "Output edits, not the full plan. Each edit targets a `section` (the nearest markdown heading) and a `before` string that must appear exactly once within that section — verbatim, including whitespace. If you need to change something that appears in multiple places, include enough surrounding context in `before` to make it unique within the section. Use the shortest `before` that is unambiguous."
  - Direction phase prompt unchanged — keeps `updated_plan: string`.
  - Update the surgical-constraint block to reinforce: "edits should be surgical — change the lines that need changing, not the lines around them."

- [ ] Update JSON schema generation in `src/schemas/json-schema.ts`
  - Change `PlannerRevisionJsonSchema` (constant) to `getRevisionJsonSchema(phase: ReviewPhase, revisionMode: "edits" | "full"): object`.
  - Direction phase (or `revisionMode: "full"`): returns existing schema with `updated_plan: string`.
  - Risk/detail phase with `revisionMode: "edits"`: returns schema with `edits: ReplaceEdit[]` instead of `updated_plan`. No union, no discriminator — each phase gets exactly one schema shape.
  - Update the call site at `src/core/operations.ts` to pass `phase` and `config.revision_mode`.

- [ ] Update `parseStructuredRevision` and `parseRevision` in `src/core/convergence.ts`
  - Both must handle both schema shapes. After Zod validation with the phase-appropriate schema, the consumer (`runRevisionRound`) dispatches on presence of `updated_plan` vs. `edits`.
  - Backward compatibility: if a parsed revision has `updated_plan` but was expected to be edits-mode, treat it as a parse error and surface it (the model violated the schema). If it has `edits` in direction mode, also a parse error. No silent normalization — the schema enforces the contract.

- [ ] Telemetry hooks
  - Per-revision metrics extended in `RoundMetrics`:
    - `revision_mode: "full" | "edits"` — set per round by `runRevisionRound`
    - `edits_attempted: number | null` — count of edits in the planner output (null for full-mode)
    - `edits_applied: number | null` — count successfully applied on first pass
    - `edits_failed: number | null` — count of first-pass failures
    - `edits_retried: number | null` — count of failed edits sent to retry
    - `edits_recovered: number | null` — count of retried edits that succeeded
    - `retry_invoked: boolean` — true iff any edits failed and retry was triggered
  - KPIs: first-pass success rate (`edits_applied / edits_attempted`), retry recovery rate (`edits_recovered / edits_retried`), and overall success rate (`(edits_applied + edits_recovered) / edits_attempted`).

- [ ] Unit tests in `src/core/apply-edits.test.ts` (new)
  - Single-edit successful application within a section
  - Multiple sequential edits applied in order; later edits see the result of earlier ones
  - `before` not found in section → `EditFailure` with `reason: "no-match"`, plan unchanged at that step, applier continues with remaining edits
  - `before` not found anywhere → `EditFailure` with `reason: "no-match"`, diagnostic log shows where plan-wide search would have matched (if anywhere)
  - `before` matches multiple times within section → `EditFailure` with `reason: "multi-match"`
  - Edit attempting to modify the `**planpong:**` line → rejected with `reason: "status-line"`
  - Empty `after` performs deletion correctly
  - Edit list with zero entries returns the plan unchanged with `applied: [], failures: []`
  - Trailing whitespace normalization: `before` with trailing spaces matches plan text without them
  - Section scoping: `before` appears in two sections but `section` field disambiguates correctly
  - Heading inside fenced code block is not treated as a section boundary
  - CRLF in plan content is normalized to LF before matching
  - Duplicate heading labels: first matching heading is used, warning logged

- [ ] Schema tests in `src/schemas/revision.test.ts` (extend if exists, create if not)
  - `DirectionRevisionSchema` with `updated_plan` validates
  - `EditsRevisionSchema` with valid edits validates
  - `EditsRevisionSchema` with `before.length > 2000` or `after.length > 5000` → Zod failure
  - `EditsRevisionSchema` rejects payload containing `updated_plan` (no escape hatch)
  - `DirectionRevisionSchema` rejects payload containing `edits` (schema mismatch)

- [ ] Integration tests in `src/core/operations.test.ts`
  - Mock planner returns edits with two valid edits → assert plan is updated correctly, metrics show `revision_mode: "edits"`, `edits_applied: 2`, `retry_invoked: false`
  - Mock planner returns edits with one working and one failing edit → assert partial plan update applied, retry invoked for failed edit, metrics capture both passes
  - Mock planner returns edits where retry also fails → assert partial plan kept (successful edits preserved), failures surfaced in response, no full-mode fallback
  - Mock planner returns edits with accepted response but corresponding edit failed and retry failed → assert response action downgraded to `deferred`, rationale includes `"edit_not_applied"`
  - Direction-phase round uses `updated_plan` schema regardless of config
  - `revision_mode: "full"` config → all rounds use `updated_plan` schema, no edit applier invoked

- [ ] MCP boundary updates
  - `planpong_revise` response: add `revision_mode`, `edits_applied`, `edits_failed`, `edits_recovered`, `retry_invoked` from the metrics. Does not break existing fields.
  - `planpong_status` round entries: include `revision_mode` so a session reviewer can see which rounds used which mode.

- [ ] Manual verification + benchmark
  - Re-run `bench/run.ts bench/plans/medium.md` 3× and compare to `bench/baseline/medium/run-{1,2,3}.json`. Expectations:
    - `total_output_chars` drops 50%+ on rounds where `revision_mode: "edits"` was used.
    - `total_wall_ms` drops in proportion to output reduction.
    - First-pass edit success rate (`edits_applied / edits_attempted`) exceeds 80%. If below, the prompt needs tightening before merge.
    - Retry rate (`retry_invoked` rounds / total edits-mode rounds) stays below 30%. If above, section scoping or prompt guidance is insufficient.
    - `rounds` does NOT increase. If it does, edit-mode is breaking the plan in ways that produce more reviewer findings — investigate before merge.
  - Re-run `bench/plans/small.md` and compare. Smaller plans benefit less in absolute terms but should still show output reduction on rounds 2-3.
  - Spot-check the diff between baseline and post-change runs by hand: the final plan should be substantively the same (modulo natural model variance).
  - **Rollback criteria:** If any of these thresholds are violated in benchmarks, set `revision_mode: "full"` in config and investigate prompt/applier changes before re-enabling. The config kill switch is the rollback mechanism.

## File References

| File | Change |
|---|---|
| `src/schemas/revision.ts` | Add `ReplaceEdit` schema with `section` field; split into `DirectionRevisionSchema` + `EditsRevisionSchema` |
| `src/schemas/revision.test.ts` | Validate both schemas; verify no cross-contamination (edits schema rejects `updated_plan`, etc.) |
| `src/schemas/config.ts` | Add `revision_mode: "edits" \| "full"` with default `"full"` (initial release) |
| `src/config/loader.ts` | Wire `revision_mode` through config loading + CLI overrides |
| `src/core/apply-edits.ts` | Create — section-scoped edit applier with fenced-code-aware heading parser, no plan-wide fallback (diagnostic log only), trailing-whitespace normalization, status-line protection |
| `src/core/apply-edits.test.ts` | Create — applier truth table including section scoping, whitespace normalization, fenced code blocks, CRLF, duplicate headings |
| `src/core/operations.ts` | Wire applier into `runRevisionRound`; phase-aware schema selection; in-memory partial-apply + targeted retry with single atomic write; response-edit consistency check |
| `src/core/operations.test.ts` | Add edits-mode happy path, partial-failure + retry, retry-also-fails, response-edit consistency downgrade, config kill switch cases |
| `src/core/convergence.ts` | Phase-aware parsing; strict schema enforcement (no silent normalization) |
| `src/core/convergence.test.ts` | Parser cases for both schemas; cross-schema rejection |
| `src/prompts/planner.ts` | Phase-aware schema block + section-scoped edit instructions for risk/detail |
| `src/schemas/json-schema.ts` | `getRevisionJsonSchema(phase, revisionMode)` replacing constant export |
| `src/schemas/metrics.ts` | Extend `RoundMetrics` with revision-mode telemetry including retry metrics |
| `src/mcp/tools/revise.ts` | Surface `revision_mode` + edit telemetry in response |
| `src/mcp/tools/status.ts` | Include `revision_mode` per-round in status response |

## Out of Scope

- **Diff format other than `before`/`after` text replacement** — patch / unified-diff support is more compact but adds parser complexity. Section-scoped text replacement with verbatim anchors is the simplest viable contract.
- **Edit application to the review prompt's plan content.** The reviewer always sees the full current plan; that's what they're reviewing. Trimming the reviewer's view is a separate idea (the original GodMode-style trick) that this plan does not pursue.
- **Diff-mode for the planner's initial proposal.** First-draft planning still emits a full plan — there's nothing to anchor edits against.
- **Cross-round edit memoization** — caching edits to replay if the planner gives up. Not worth the complexity.
- **AST-aware editing for markdown structure.** Treating headings/lists as structured nodes is appealing but adds a markdown parser dependency. Verbatim text edits scoped by heading labels are sufficient given the existing surgical-revision norm.
- **Full-mode fallback on edit failure.** Replaced by partial-apply + targeted retry. A full rewrite after partial success would discard applied edits, and the cost of a second full invocation negates the savings this feature exists to provide.
- **Runtime auto-downgrade.** Session-level heuristics that switch from edits to full mode based on failure rates. Adds adaptive complexity under degraded conditions — the config kill switch and benchmark-gated rollout are sufficient controls.

## Limitations & Future Work

- **Planner anchor drift.** The planner sometimes paraphrases the existing plan when proposing changes. The `before` field exposes this — a paraphrased anchor doesn't match. Mitigated by the retry path (which gives the planner a second chance with an explicit error message). If retry recovery rate is consistently low in practice, consider a quote-extraction prompt sub-step that asks the planner to first quote the exact target text before proposing the edit.
- **Multi-touch edits to the same region.** Two edits whose `before` strings overlap will fail the second (because the first edit has already mutated the matched region). The applier processes edits sequentially, so this is order-dependent. Document this in the planner prompt; reviewer can flag if it becomes a real problem.
- **Direction-phase savings forgone.** Direction-phase revisions are intentionally allowed to be sweeping, so they keep the full-plan output path. Round 1 stays expensive. That's acceptable — round 1 is also the round most likely to converge, so it usually doesn't compound.
- **Partial revisions on unrecoverable failure.** If some edits apply and others fail even after retry, the round produces a partial revision — the plan has some accepted changes but not all. The response-edit consistency check downgrades affected `accepted` responses to `deferred`, so the reviewer will re-raise unresolved issues in the next round. The metrics capture this (`edits_failed - edits_recovered > 0`) so it's detectable.
- **Config kill switch is binary.** `revision_mode: "full"` disables edits globally — there's no per-round or per-phase granularity. If only one phase is problematic, the kill switch is a blunt instrument. Acceptable for now; per-phase config can be added if needed.
- **Initial release defaults to full mode.** The `revision_mode` default is `"full"` until benchmarks confirm edit-mode thresholds. This means the feature ships inert — users must opt in via `planpong.yaml` until the default is flipped in a follow-up change.