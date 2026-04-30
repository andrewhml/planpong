# Optional Multi-Reviewer Quorum

**Status:** Draft
**planpong:** R1/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | direction | 1P1 3P2 | +0/-0 lines | 1m 17s | Reviewed — 4 issues

## Context

Today planpong has a single planner and a single reviewer (`PlanpongConfigSchema` in `src/schemas/config.ts:9-15`). The reviewer can produce findings the planner accepts and revises around — but if the reviewer has a blind spot, that blind spot is the system's blind spot. Same-family models (codex critiquing claude, both trained on similar pretraining mixes) are strong on each other's structural mistakes but tend to agree on aesthetic choices, prompt phrasing, and assumed defaults. The default config (`claude` planner + `codex` reviewer) is already two families, but it's still N=1 reviewer per round.

GodModeSkill's lineage-weighted quorum is the proven reference: ≥1 codex + ≥1 gemini + ≥1 opencode reviewer must agree before proceeding. That's a meaningfully different shape — it converts "reviewer might be wrong" from a silent failure into an explicit disagreement signal. The cost is real (3× provider invocations per review round) but the value is also real (issues caught by a model the planner doesn't know it should be checking).

This plan adds an **optional** multi-reviewer mode to planpong. Default behavior is unchanged: one reviewer, one round. When `reviewers: [...]` is configured (a list of `ProviderConfig`), each reviewer runs in parallel during the review phase and produces independent feedback. The orchestrator then computes a quorum decision from the per-reviewer results. The planner sees a single merged feedback object — quorum-passing issues are forwarded as-is; non-quorum issues are flagged so the planner can weight them appropriately.

The current `reviewer: ProviderConfig` field stays as the single-reviewer default. The new optional `reviewers: ProviderConfig[]` field, when present, takes precedence — `reviewer` becomes the first entry in the list and the rest are added. This avoids breaking any existing config or downstream consumer (CLI, MCP, planpong.yaml).

**Limitation:** Multi-reviewer mode triples (or more) the per-round provider cost. For users on metered pricing (e.g., direct OpenAI API keys) this is a real expense. For users on subscription pricing (ChatGPT Plus, Anthropic Pro) it's a rate-limit concern but not a $$ concern. The default stays single-reviewer; multi-reviewer is opt-in. The plan does not attempt to optimize for cost — that's a separate optimization layer (e.g., "cheap reviewer first, expensive reviewer only on disagreement") that builds on this primitive.

## Steps

- [ ] Extend `PlanpongConfigSchema` in `src/schemas/config.ts`
  - Add `reviewers: z.array(ProviderConfigSchema).optional()`. When present, this is the canonical list of reviewers and `reviewer` (the singular field) is ignored — fail closed: if both fields are present and disagree, the config loader emits a stderr warning and uses `reviewers`.
  - Add `quorum: z.object({ rule: z.enum(["all", "majority", "any"]).default("all"), min_agree: z.number().int().min(1).optional() }).optional()`. Default rule when `reviewers` is set: `all` (every reviewer must agree). `min_agree: 2` overrides the rule and requires exactly N agreeing reviewers regardless of count. Direction phase always uses the configured rule; risk + detail phases also use it.
  - Backward compatibility: when `reviewers` is absent, the existing single-`reviewer` path runs unchanged. No behavior change for default configs.
  - Validation refinement: if `reviewers` is set, the array must have ≥2 entries (otherwise it's just a verbose single-reviewer config). Zod refinement with a clear error message.

- [ ] Add a fan-out review function in `src/core/operations.ts`
  - Extract the existing `runReviewRound` provider invocation into `runSingleReview(config, planText, priorDecisions, phase, structuredOutput): Promise<{ feedback: PhaseFeedback; metrics: RoundMetrics }>`. This is the per-reviewer work today, just packaged.
  - Add `runMultiReview(reviewerConfigs, planText, priorDecisions, phase, structuredOutput, metricsContext): Promise<MultiReviewResult>` where `MultiReviewResult = { perReviewer: Array<{ config, feedback, metrics }>; mergedFeedback: PhaseFeedback; quorum: QuorumResult }`.
  - Reviewers run in parallel via `Promise.allSettled`. Reviewer failures (provider errors, parse errors, Zod errors) do not abort the round — they're recorded in the per-reviewer result with `feedback: null` and contribute to quorum as "missing" (treated like a non-agree vote). This matches GodMode's "lineage missing" handling.
  - The state-machine downgrade logic in the existing `invokeWithStateMachine` runs per-reviewer (each reviewer has its own structured→legacy fallback path). Failures there are captured in that reviewer's metrics and do not affect siblings.

- [ ] Define quorum logic in `src/core/quorum.ts` (new file)
  - `computeQuorum(perReviewer: Array<{ config: ProviderConfig; feedback: PhaseFeedback | null }>, rule: QuorumRule): QuorumResult` where `QuorumResult = { decision: "agree" | "disagree" | "incomplete"; verdict: PhaseVerdict; reviewerVerdicts: Array<{ reviewer: string; verdict: PhaseVerdict | null; agreed: boolean }>; reasoning: string }`.
  - **Verdict mapping per phase:** Direction + risk phases never produce `approved`, only `needs_revision` or `blocked`. Detail phase can produce `approved | approved_with_notes | needs_revision | blocked`. A reviewer "agrees to proceed" when:
    - Direction/risk phase: `verdict === "needs_revision"` with severity_counts P1=0 (i.e., no fundamental blockers raised). `blocked` is treated as agree-to-block, not agree-to-proceed.
    - Detail phase: `verdict === "approved" || verdict === "approved_with_notes"`. `needs_revision` = disagree-with-revision-needed. `blocked` = disagree-with-block.
  - **Quorum rule semantics:**
    - `all`: every reviewer must agree-to-proceed. One disagreement → `decision: "disagree"`. One missing reviewer → `decision: "incomplete"`.
    - `majority`: more than half of reviewers must agree-to-proceed. Ties → `disagree`.
    - `any`: at least one reviewer must agree-to-proceed.
    - `min_agree: N`: at least N reviewers must agree-to-proceed (overrides `rule`). Useful for explicit policies like "need 2 of 3."
  - Pure function. No side effects. No filesystem reads. Returns the decision; the caller decides what to do with it.

- [ ] Define a feedback merge strategy in `src/core/merge-feedback.ts` (new file)
  - `mergeFeedback(perReviewer: Array<{ config; feedback }>, quorum: QuorumResult, phase: ReviewPhase): PhaseFeedback`
  - **Issues:** union with deduplication. Two issues from different reviewers are considered duplicates iff they share the same `section` + a similarity threshold on `title` (Levenshtein distance ≤ 5 or a Jaccard token overlap ≥ 0.8 — pick one and stick with it; recommend Jaccard for simplicity). Duplicates are merged into a single `MergedIssue` with `reviewer_agreement: number` (count of reviewers raising the issue) and the highest severity wins.
  - **Quorum tagging on issues:** each merged issue carries `quorum_status: "shared" | "unique"`. `shared` if raised by ≥2 reviewers; `unique` if raised by exactly 1. The planner sees this in the rendered prompt and can weight accordingly (a unique issue from one reviewer is weaker signal than a shared issue across all reviewers).
  - **Verdict:** the merged verdict is the worst (most-revision-required) of the constituent verdicts. If any reviewer says `blocked`, merged verdict is `blocked`. Otherwise if any says `needs_revision`, merged verdict is `needs_revision`. Detail phase only: `approved_with_notes` requires all reviewers to agree (else downgrade to `needs_revision`). `approved` requires all reviewers to fully agree.
  - **Phase-specific fields:** for direction phase, merge `confidence` as the lowest of any reviewer's value, `approach_assessment` as a concatenation prefixed by reviewer name, `alternatives` and `assumptions` as deduplicated unions. For risk phase, `risk_level` is the highest of any reviewer's, `risks` are deduplicated by `(category, title)` similarity.

- [ ] Wire fan-out into `runReviewRound` in `src/core/operations.ts`
  - When `config.reviewers` is set: call `runMultiReview(...)`. Collect `perReviewer` metrics into a new `MultiReviewMetrics` envelope; persist as `round-N-multi-review-metrics.json` alongside the existing `round-N-review-metrics.json` (which now records aggregate timing only — start of fan-out to end of merge).
  - Persist `round-N-perreviewer-feedback.json` containing the unmerged per-reviewer responses for diagnostics. The merged feedback continues to be written to `round-N-feedback.json` (existing path) so downstream consumers (status, get-feedback) see the same shape they always have, plus new per-reviewer data when present.
  - On `decision: "incomplete"`: log to stderr which reviewers failed, then proceed with whatever reviewers responded — quorum may still pass under `any` or `majority` rules, or fail under `all`. Do not abort the round on a single reviewer failure.
  - On `decision: "disagree"`: the reviewer round produces a non-converged feedback object regardless of any individual reviewer's verdict. The planner is expected to revise.

- [ ] Update the planner prompt in `src/prompts/planner.ts`
  - In the issue rendering template, surface `quorum_status` per issue: append `**Reviewers:** N of M` (where N is `reviewer_agreement` count, M is total reviewers) for each issue. This makes quorum visible to the planner.
  - Add a paragraph to the revision-instructions block: "Some issues are raised by all reviewers (`shared`); others are raised by only one (`unique`). Shared issues have stronger signal — multiple independent reviewers found the same concern. Unique issues are weaker signal but still worth evaluating; reject only if you have specific evidence the issue is incorrect."
  - These additions are no-ops in single-reviewer mode (every issue has `reviewer_agreement: 1` of `1` total reviewers) — they only carry information when fan-out is active.

- [ ] Surface multi-reviewer state in MCP responses
  - `planpong_get_feedback` response: when in multi-reviewer mode, add `reviewers: Array<{ name: string; verdict: PhaseVerdict | null; status: "ok" | "failed"; duration_ms: number; issue_count: number }>` and `quorum: { rule: string; decision: string; agreed: number; total: number }`. Each issue in the response includes `reviewer_agreement` and `quorum_status`. Backwards compatible: single-reviewer mode omits the new fields.
  - `planpong_status` response: per-round, include `reviewers: Array<{name, verdict, status}>` and `quorum_decision: "agree" | "disagree" | "incomplete"` when multi-reviewer mode was used. Existing single-reviewer rounds keep their current shape (no new fields).
  - `planpong_revise` response: unchanged. The planner sees the merged feedback; revision is symmetric across modes.

- [ ] Extend `RoundMetrics` in `src/schemas/metrics.ts`
  - Add `reviewers: Array<{ name: string; provider: string; model: string | null; verdict: string | null; status: "ok" | "failed"; failure_reason: string | null; duration_ms: number; issue_count: number }> | null`. Null in single-reviewer mode (the existing top-level fields capture the single reviewer). Populated only in multi-reviewer mode.
  - Add `quorum: { rule: string; decision: string; agreed: number; total: number; required: number } | null`. Null in single-reviewer mode.
  - The existing `attempts: InvocationAttempt[]` array stays for the merged-round-level perspective. Per-reviewer attempts live inside the per-reviewer metrics file.

- [ ] CLI + planpong.yaml support
  - Update `src/config/load.ts` (or wherever config is loaded) to recognize `reviewers:` as an array key in YAML. Document the schema in `planpong.yaml` example config: a commented block showing `# reviewers: [{provider: claude, ...}, {provider: codex, ...}]`.
  - CLI flags: add `--reviewer <provider:model:effort>` (repeatable) so `npx planpong review --reviewer claude --reviewer codex --reviewer gemini` configures three reviewers from the command line. When repeated, the singular `--reviewer` flag accumulates into the `reviewers` array.
  - When `--reviewer` is given exactly once, behavior is unchanged from today (single-reviewer mode). Two or more invocations switch the run to multi-reviewer mode.

- [ ] Add a Gemini provider stub (or document it as a separate plan)
  - The configurable `provider: string` already accepts arbitrary names; the dispatcher in `src/providers/index.ts` (or wherever providers are looked up) needs an entry for `"gemini"`. Implementation requires shelling out to `gemini` CLI with a prompt and parsing its JSON output — analogous to `src/providers/claude.ts` and `src/providers/codex.ts`.
  - **Scope decision:** the Gemini provider implementation is a non-trivial provider-integration plan in its own right (auth quirks, output format quirks, structured-output capability detection — see GodMode notes about "single-line gemini prompt"). This plan does NOT include the Gemini provider implementation. Multi-reviewer mode is testable today with `claude` + `codex` (two existing providers, two reviewers — sufficient to validate the fan-out and quorum machinery). Gemini becomes the obvious third reviewer once its provider lands; the schemas defined here already accommodate it.

- [ ] Unit tests in `src/core/quorum.test.ts` (new)
  - 2-of-2 reviewers agree under `rule: "all"` → `decision: "agree"`
  - 1-of-2 agrees under `all` → `decision: "disagree"`
  - 1-of-3 missing under `all` → `decision: "incomplete"`
  - 2-of-3 agree under `majority` → `decision: "agree"`
  - 1-of-3 agree under `any` → `decision: "agree"`
  - `min_agree: 2` overrides `rule: "any"` and requires 2 → with 1 agree, `decision: "disagree"`
  - All reviewers fail (all `null` feedback) → `decision: "incomplete"`
  - Detail-phase verdict mapping: reviewer says `approved_with_notes` counts as agree under `all`; `needs_revision` counts as disagree
  - Risk-phase verdict mapping: `needs_revision` with no P1 issues counts as agree-to-proceed; `blocked` counts as disagree

- [ ] Unit tests in `src/core/merge-feedback.test.ts` (new)
  - Two reviewers raise the same issue (same section, similar title) → merged single issue with `reviewer_agreement: 2`, `quorum_status: "shared"`
  - Two reviewers raise different issues → both kept as separate issues, each with `reviewer_agreement: 1`, `quorum_status: "unique"`
  - Three reviewers, two raise issue A, one raises issue B → A is shared (count 2), B is unique (count 1)
  - Severity disagreement: reviewer 1 says P1, reviewer 2 says P2 for the same issue → merged issue takes the higher severity (P1)
  - Verdict merging: one reviewer `approved`, one `needs_revision` → merged is `needs_revision`
  - Verdict merging detail-phase: one `approved`, one `approved_with_notes` → merged is `approved_with_notes`
  - All reviewers `blocked` → merged is `blocked`
  - Direction phase: confidence merging, alternatives dedup, assumptions dedup
  - Risk phase: risk_level takes the highest, risks dedup by (category, title) similarity

- [ ] Integration tests in `src/core/operations.test.ts`
  - Multi-reviewer round: mock two reviewers returning identical feedback → merged feedback has 1 issue with `reviewer_agreement: 2`, quorum decision is `agree`
  - Multi-reviewer round: mock two reviewers, one returns feedback, the other throws → quorum decision is `incomplete` under `all` rule, `agree` under `majority` if the responder agrees
  - Multi-reviewer round: per-reviewer files written correctly; aggregate `round-N-feedback.json` contains the merged form
  - Backwards compat: single-reviewer config (no `reviewers` field) → existing path runs, no new files written, all existing tests pass unchanged

- [ ] MCP boundary tests in `src/mcp/tools/get-feedback.test.ts` and `src/mcp/tools/status.test.ts`
  - Multi-reviewer mode: response includes `reviewers` array with per-reviewer summaries and `quorum` object. Each issue includes `reviewer_agreement` and `quorum_status`.
  - Single-reviewer mode: response shape is unchanged from today (no `reviewers`/`quorum` fields).
  - Status tool: per-round entries in multi-reviewer mode include `quorum_decision`; single-reviewer rounds do not.

- [ ] Manual verification + benchmark
  - Run planpong on `bench/plans/medium.md` with `reviewers: [claude, codex]` and `rule: "all"`. Confirm both reviewers respond, merged feedback shows `quorum_status` per issue, and quorum decision is logged.
  - Compare `total_wall_ms` to `bench/baseline/medium/run-1.json` (single-reviewer baseline). Expectation: wall time approximately matches the slower of the two reviewers per round (since they run in parallel) — not 2× the baseline. If wall time approaches 2× baseline, the parallel execution isn't actually parallel and needs investigation.
  - Compare `total_attempts`. Expectation: 2× baseline (each reviewer counts as one attempt per round).
  - Compare `total_prompt_chars` and `total_output_chars`. Expectation: 2× baseline (linear in reviewer count).
  - Compare `rounds`. Expectation: equal to or fewer than baseline. Multi-reviewer should catch issues earlier in some rounds, leading to faster convergence on plans that triggered late-round detail-phase nits in baseline. If rounds increase, the merge logic is producing more revision work than the additional reviewers eliminate — investigate before merging.

## File References

| File | Change |
|---|---|
| `src/schemas/config.ts` | Add optional `reviewers` array + `quorum` config |
| `src/core/operations.ts` | Extract `runSingleReview`; add `runMultiReview`; wire fan-out into `runReviewRound` |
| `src/core/operations.test.ts` | Multi-reviewer happy path + partial failure + backwards compat |
| `src/core/quorum.ts` | Create — `computeQuorum`, pure |
| `src/core/quorum.test.ts` | Create — quorum truth table |
| `src/core/merge-feedback.ts` | Create — issue merging, verdict merging, phase-specific field merging |
| `src/core/merge-feedback.test.ts` | Create — merge truth table |
| `src/core/session.ts` | Add `writeRoundPerReviewerFeedback` + `writeMultiReviewMetrics` + reads |
| `src/prompts/planner.ts` | Render `reviewer_agreement` per issue; add quorum-awareness paragraph |
| `src/prompts/planner.test.ts` | Assert per-issue reviewer-agreement is rendered |
| `src/schemas/metrics.ts` | Extend `RoundMetrics` with optional `reviewers` array + `quorum` object |
| `src/mcp/tools/get-feedback.ts` | Surface `reviewers` + `quorum` in multi-reviewer mode |
| `src/mcp/tools/get-feedback.test.ts` | Multi-reviewer response shape + single-reviewer backwards-compat |
| `src/mcp/tools/status.ts` | Per-round `quorum_decision` in multi-reviewer rounds |
| `src/mcp/tools/status.test.ts` | Status response shape per mode |
| `src/cli/*.ts` | Repeatable `--reviewer` flag |
| `src/config/load.ts` | Parse `reviewers:` array from YAML |
| `bench/run.ts` | Optionally take a `--reviewers` flag for benchmarking multi-reviewer runs |

## Out of Scope

- **Gemini provider implementation.** Multi-reviewer machinery is testable with claude + codex. A real gemini provider is a separate plan with its own subprocess/auth/output-parsing concerns.
- **Lineage classification (codex/gemini/opencode lineage families).** GodMode classifies reviewers by lineage and requires diversity. Planpong reviewers are configured as ProviderConfig — the operator chooses the lineage. Adding a `lineage` enum field to ProviderConfig would be the natural follow-up; not done here because it adds taxonomy and validation rules without a corresponding consumer in this plan.
- **Reviewer-side cost optimization.** "Run cheap reviewer first, only invoke expensive reviewer on disagreement" is a sensible feature but a separate optimization layer over this primitive.
- **Cross-round reviewer rotation.** GodMode rotates reviewers via LRU per round to spread rate limits. This plan uses a fixed reviewer list per session; rotation is a separate change.
- **Adversarial pre-merge consensus.** The merge logic produces a single feedback object the planner sees. There is no second-round dispute mechanism where reviewers debate each other's findings. Cross-reviewer dispute is interesting but adds an entire orchestration layer.
- **Per-reviewer prompt customization.** All reviewers see the same prompt (per-phase). A future change could specialize prompts per reviewer (e.g., gemini gets a "look for missed assumptions" prompt while codex gets "look for contract gaps"). Not done here.

## Risks & Mitigations

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Adding multi-reviewer mode breaks existing single-reviewer sessions / consumers | P1 | New fields are optional; absence preserves all existing behavior; explicit backwards-compat tests in operations + MCP boundary suites | Mitigated |
| Issue dedup similarity threshold misses real duplicates or merges distinct issues | P2 | Jaccard token overlap is a chosen threshold (0.8) with explicit unit tests; tuning is straightforward if observed false-positive/negative rate is high | Mitigated |
| Parallel reviewer invocation triples provider load and may rate-limit | P2 | Default mode is single-reviewer; multi-reviewer is opt-in via config; failures of any one reviewer are tolerated; quorum rule lets operator decide if `incomplete` is acceptable | Mitigated |
| Quorum disagreement produces feedback the planner can't reconcile (e.g., two reviewers want opposite changes) | P2 | The merged feedback surfaces `quorum_status` per issue so the planner sees the disagreement. The planner's existing reject/dispute mechanism handles contradictory feedback the same way it handles wrong-but-confident single-reviewer feedback. No special quorum-conflict resolution path. | Acknowledged |
| One slow reviewer becomes the round bottleneck (parallel = max-of-N latency) | P2 | This is the explicit tradeoff — multi-reviewer rounds are bounded by the slowest reviewer. Operators choose reviewer set knowing this. Per-reviewer metrics make it visible. | Acknowledged |

## Limitations & Future Work

- **No lineage diversity enforcement.** A user could configure 3 codex reviewers (3 different ChatGPT accounts) and the system would happily run all 3 — but they share blind spots. The `provider` field captures *which* CLI is invoked, not the model family lineage. A `lineage` field on `ProviderConfig` (with values like `codex`, `claude`, `gemini`, `opencode`) would let quorum rules require lineage diversity. Out of scope for round 1; the schema is designed to accommodate it as an additive change.
- **Aggregate timing is max-of-reviewers, not average.** Wall time scales with the slowest reviewer, which is suboptimal in mixed-speed reviewer sets. A "best-N-of-M" pattern (start M reviewers, take the first N to respond, cancel rest) would optimize this but adds cancellation handling and changes the determinism of the run.
- **No per-reviewer prompt customization.** Future work could specialize prompts per reviewer to amplify the diversity benefit. Today every reviewer sees the same prompt, so the diversity comes from the model itself, not the framing.
- **No human-in-the-loop disagreement handling.** When `decision: "incomplete"` or `disagree` and the operator has `interactive: true`, the orchestrator could prompt the user to choose a path (override, rerun, abort). Today the loop just produces a non-converged round and the planner revises. Adding human-routing for ambiguous cases is a UX layer that builds on this primitive.
