# Reviewer Evidence Verification

**Status:** Shipped (PR [#31](https://github.com/andrewhml/planpong/pull/31), commit `f9e714d`, v0.5.3) — planpong review reached R5/10 before implementation.

## Context

The reviewer can produce findings that don't actually correspond to anything in the plan. When this happens, the planner spends a revision round either rebutting a non-existent issue or "fixing" something that wasn't broken. Both waste a full provider invocation (currently the dominant cost in a planpong run — see `bench/baseline/small/run-1.json`: revision rounds are 86s / 167s of the 7m total).

Today every issue already carries a `section: string` field (see `src/schemas/feedback.ts:7`) that's meant to point the planner at the place in the plan to change. It's free-form text — typically a section heading, sometimes a paraphrase, sometimes wrong. Nothing checks that the section actually exists in the plan.

GodModeSkill (the reference system this plan is modeled on) has each finding cite a `<file-path>`, `<line-number>`, and `<quoted-line>`, then runs a whitespace-tolerant grep of the quoted line in the cited file. Findings whose quote can't be located are flagged `verified: false` and the consumer can ignore or deprioritize them. This adds a deterministic anchor to every finding without requiring the model to be smarter.

This plan ports the same idea to planpong, scoped to the plan markdown (the only "file" planpong reviews):

1. The reviewer cites a `quoted_text` snippet (a short, distinctive string) for every issue.
2. After parsing, planpong verifies each `quoted_text` appears in the plan (whitespace-tolerant).
3. Each issue gets a `verified: true | false` flag carried through to the revision prompt and the MCP response.
4. The planner is instructed to deprioritize unverified findings — they are likely hallucinations.

The same idea applies to risk-phase `risks` entries (which already have `description` but no anchor) and direction-phase `assumptions`. Out of scope for round 1 of this work — keep the change to `FeedbackIssueSchema` only. If verification proves valuable we can extend it.

**Limitation:** Whitespace-tolerant matching only catches verbatim quotes. A reviewer that paraphrases ("the plan says X happens before Y" without quoting) will produce `verified: false` even when the finding is correct. The instruction explicitly tells the reviewer to quote, not paraphrase, but model compliance is not guaranteed. The mitigation is a `verified: false` finding remains visible — the planner sees it, just deprioritized — so a real-but-paraphrased finding is not silently dropped.

## Steps

- [ ] Extend `FeedbackIssueSchema` in `src/schemas/feedback.ts`
  - Add `quoted_text: z.string().optional()`. **Initially optional** — models that omit it produce issues tagged `verified: false` rather than failing Zod validation. This is the phased rollout: optional now, required once provider compliance stabilizes. (See Risks & Mitigations, R1.)
  - **No length or min constraints at the Zod level.** `ZodValidationError` is terminal in this system (convergence.ts:28-41, operations.ts:613 — no retry, no downgrade), so a hard `max(200)` or `min(1)` would kill the entire review round if the reviewer produces a too-long or empty quote. Instead, all length/distinctiveness enforcement happens in the verifier (see verify-evidence step below), which marks non-compliant quotes `verified: false` rather than throwing. This keeps the parse path fail-safe. (See Risks & Mitigations, R1.)
  - Add `verified: z.boolean().optional()`. Set by planpong post-parse, never by the model. Optional in the schema so the reviewer's raw output validates before verification runs; populated by the verifier before the issue is forwarded to the planner.

- [ ] Extend top-level feedback schemas in `src/schemas/feedback.ts`
  - Add `quote_compliance_warning: z.boolean().optional()` and `unverified_count: z.number().int().nonneg().optional()` to `ReviewFeedbackSchema`, `DirectionFeedbackSchema`, and `RiskFeedbackSchema`. These are set by planpong post-parse (same as `verified` on issues), never by the model. Optional so raw model output validates before the verifier populates them.
  - This ensures the `quote_compliance_warning` flag and `unverified_count` are part of the formal `PhaseFeedback` type, propagated through the pipeline without ad-hoc casts or `any` escapes.

- [ ] Add a verifier at `src/core/verify-evidence.ts` (new file)
  - Export `verifyIssue(issue, planText): { verified: boolean }` and `verifyFeedback(feedback, planText): VerificationResult`, where `VerificationResult = { feedback: PhaseFeedback; exceptionCount: number }`. The explicit result type ensures callers have deterministic access to both the annotated feedback and the diagnostic counter without relying on side channels.
  - Verification rule: collapse runs of whitespace (including newlines) in both the quote and the plan to a single space; case-sensitive; trim leading/trailing whitespace. If the normalized quote appears in the normalized plan, `verified: true`.
  - **Length and distinctiveness enforcement** (moved from Zod to the verifier for fail-safety): quotes shorter than 10 characters are marked `verified: false` regardless of whether they match (not distinctive enough). Quotes longer than 200 characters are marked `verified: false` regardless of whether they match (discourages quoting entire sections). Both thresholds emit a stderr warning with the issue ID. This replaces the Zod-level `min(1).max(200)` constraint — enforcement happens in the verifier where failure means `verified: false`, not a terminal round error.
  - The verifier is pure — takes strings, returns flags. No filesystem reads, no provider calls, no logging side effects beyond what the caller chooses to do with the result.
  - The verifier is **fail-safe**: an unexpected error during normalization (e.g., catastrophic regex backtracking on adversarial input) is caught and the issue is marked `verified: false` rather than throwing. This preserves the invariant that adding evidence verification can never break a review that would have succeeded before.
  - **Diagnostic counter**: when the verifier catches an exception, it increments a counter and emits `[planpong] warn: verifier exception on issue {id}: {error.message}` to stderr. The total exception count is returned in `VerificationResult.exceptionCount` so callers can surface it. This prevents silent systemic failure if a bug is introduced in the normalizer. (See Risks & Mitigations, R3.)

- [ ] Wire the verifier into the parse path in `src/core/convergence.ts`
  - In `parseStructuredFeedbackForPhase` and `parseFeedbackForPhase` (legacy path), call `verifyFeedback(feedback, planText)` after Zod validation succeeds. Destructure the `VerificationResult` to get the annotated feedback and exception count.
  - **Strip model-supplied `verified` before verification**: after Zod parse and before calling `verifyFeedback`, delete `verified` from every issue in the parsed feedback. This prevents the reviewer model from self-asserting verification status. The verifier is the sole authority. (See Risks & Mitigations, R2.)
  - Both functions need access to the plan text. Add a third arg `planText: string = ''` to both signatures, **defaulting to empty string** for backward compatibility. With an empty plan text, all issues correctly get `verified: false` (no plan content to match against). This preserves compilation of the 21 existing test call sites in `convergence.test.ts` that are unrelated to verification. Tests that specifically exercise verification pass plan text explicitly. (See Risks & Mitigations, R6.)
  - Issues that arrive without `quoted_text` (older sessions, model didn't comply) are tagged `verified: false` rather than rejected. This keeps the parser tolerant during rollout. A counter in stderr (`[planpong] warn: N issues missing quoted_text — marked unverified`) makes the silent-degradation visible.
  - **Noncompliance threshold warning**: if >50% of issues in a single feedback response are missing `quoted_text`, set `quote_compliance_warning: true` on the parsed feedback (using the schema field added to the top-level feedback schemas). This is surfaced in the MCP response so the orchestrator can detect sustained noncompliance rather than silently proceeding with all-unverified feedback. (See Risks & Mitigations, R5.)
  - **Populate `unverified_count`** on the parsed feedback after verification: count issues where `verified === false` and set the top-level `unverified_count` field.

- [ ] Update the reviewer prompt in `src/prompts/reviewer.ts`
  - In each phase's instruction block, add a "Cite evidence" section: every issue MUST include `quoted_text`, a verbatim ≤200-char snippet from the plan that the issue refers to. Quote — do not paraphrase. If you can't find a verbatim quote, the issue is probably a misread of the plan.
  - Update the example feedback shown in each phase's prompt to include `quoted_text` so structured-output models have a concrete pattern.

- [ ] Update the planner prompt in `src/prompts/planner.ts`
  - In the revision-instructions block, add: "Each issue carries a `verified` flag. Issues with `verified: false` could not be located in the plan and may be reviewer hallucinations — address them only if you confirm the underlying concern is real. Mark them `rejected` with rationale `unverified evidence` if not."
  - This pushes the planner to spend revision tokens on real findings, which is the whole point of the change.

- [ ] Surface verification status in MCP responses
  - `planpong_get_feedback` response: each issue already carries `severity/section/title/description/suggestion`; add `verified` and `quoted_text`. Also add a top-level `unverified_count: number` for at-a-glance dashboarding. Add `quote_compliance_warning: boolean` (from the threshold check) when true.
  - `planpong_revise` response: add `unverified_rejected: number` — count of issues the planner rejected with rationale matching `unverified evidence`. Helps measure whether the verification signal is actually being acted on.

- [ ] Update the structured-output JSON Schema generation
  - Wherever the JSON Schema is produced from `FeedbackIssueSchema` (look at `src/schemas/json-schema.ts` for OpenAI strict-mode schema construction), the new `quoted_text` field is optional (nullable in strict mode). `verified` is also optional/nullable — it's set by us, not the model. Both are declared with nullable types via the existing `makeNullable` / `toOpenAIStrict` pipeline, and nulls are stripped via the existing `stripNullProperties` adapter before Zod validation.

- [ ] Unit tests in `src/core/verify-evidence.test.ts` (new)
  - `quoted_text` matches verbatim → `verified: true`
  - `quoted_text` matches with collapsed whitespace (multiple spaces, newlines inside the quote) → `verified: true`
  - `quoted_text` does not appear in plan → `verified: false`
  - `quoted_text` is empty / undefined → `verified: false`
  - `quoted_text` shorter than 10 chars (the distinctiveness threshold) → `verified: false` even if the short string appears in the plan. This tests the distinctiveness floor, not the match rule.
  - `quoted_text` longer than 200 chars → `verified: false` even if the long string appears in the plan. This tests the length cap enforcement in the verifier.
  - Catastrophic input (10K-char quote, regex-special chars) → does not throw, returns `verified: false`
  - Verifier exception counter increments on error and stderr warning fires
  - `verifyFeedback` returns `VerificationResult` with correct `exceptionCount`

- [ ] Integration tests in `src/core/operations.test.ts`
  - Mock reviewer returns a feedback payload with two issues: one quoted-text matches the plan, one doesn't. Assert post-parse the first has `verified: true` and the second `verified: false`.
  - Legacy-path issue without `quoted_text` → marked `verified: false`, stderr warn fires.
  - Verifier throws on a malformed issue → invocation result unchanged, single issue tagged `verified: false`, no exception propagates (mirrors the metrics fail-open behavior in `operations.test.ts`).
  - Model-supplied `verified: true` is stripped and recomputed by the verifier.
  - Feedback with >50% missing `quoted_text` → `quote_compliance_warning` is set on the top-level feedback object.

- [ ] MCP boundary tests in `src/mcp/tools/get-feedback.test.ts` and `src/mcp/tools/revise.test.ts`
  - Mock `runReviewRound` to return feedback with mixed verified/unverified issues. Assert response includes `verified` per issue and `unverified_count` at the top level.
  - Mock `runRevisionRound` to return a revision where one issue was rejected with rationale "unverified evidence". Assert `unverified_rejected: 1` in the response.
  - Assert `quote_compliance_warning` is surfaced when present in feedback.

- [ ] Manual validation (observational — not merge-blocking)
  - Run planpong on `bench/plans/medium.md`. Observe whether any round produces a finding with `verified: false` (the medium plan is intentionally underspecified and reviewers paraphrase). Observe whether the planner's revision response shows unverified findings being deprioritized. Log results for tuning but do not gate the merge on specific outcomes — live model behavior is non-deterministic.
  - Run the full bench (`npx tsx bench/run.ts bench/plans/small.md`) three times and compare to `bench/baseline/small/`. Observations to record (not pass/fail criteria):
    - `total_attempts` should not increase (verification is post-parse — no extra round-trips).
    - `total_prompt_chars` increases ≤5% (added `quoted_text` instruction in reviewer prompt + verified flag in planner prompt).
    - `total_output_chars` may decrease in the long run (planner stops fixing hallucinated issues), but variance is wide — don't expect a clean signal from 3 runs.
    - `rounds` should not increase. If it does, investigate whether the verification gate is producing more revisions than it eliminates.

## File References

| File | Change |
|---|---|
| `src/schemas/feedback.ts` | Extend `FeedbackIssueSchema` with optional `quoted_text` (no length constraints) and optional `verified`; extend `ReviewFeedbackSchema`, `DirectionFeedbackSchema`, `RiskFeedbackSchema` with optional `quote_compliance_warning` and optional `unverified_count` |
| `src/core/verify-evidence.ts` | Create — `verifyIssue` + `verifyFeedback` returning `VerificationResult = { feedback, exceptionCount }`, pure, fail-safe, with distinctiveness threshold (10 chars) and length cap (200 chars) enforced as `verified: false` rather than errors |
| `src/core/verify-evidence.test.ts` | Create — verification truth table + distinctiveness threshold tests + length cap tests + exception counter tests + `VerificationResult` shape tests |
| `src/core/convergence.ts` | Add `planText` arg (default `''`) to both phase parsers; strip model-supplied `verified`; call `verifyFeedback` post-Zod; destructure `VerificationResult`; populate `quote_compliance_warning` and `unverified_count` on feedback; add noncompliance threshold check |
| `src/core/convergence.test.ts` | Existing call sites compile unchanged (default `planText = ''`); no updates needed for existing tests. New verification-specific tests pass plan text explicitly. |
| `src/core/operations.ts` | Pass `planText` to parser callsites in `runReviewRound` / `runRevisionRound` |
| `src/core/operations.test.ts` | Add verified-flag propagation cases, `verified` stripping case, compliance warning case |
| `src/prompts/reviewer.ts` | Add "cite evidence" instruction + updated example to each phase block |
| `src/prompts/planner.ts` | Add "deprioritize unverified" instruction to revision block |
| `src/schemas/json-schema.ts` | Declare `quoted_text` nullable (optional), `verified` nullable — both handled by existing `toOpenAIStrict` pipeline |
| `src/mcp/tools/get-feedback.ts` | Add `verified` per issue + top-level `unverified_count` + `quote_compliance_warning` |
| `src/mcp/tools/revise.ts` | Add `unverified_rejected` count |
| `src/mcp/tools/get-feedback.test.ts` | New cases including compliance warning |
| `src/mcp/tools/revise.test.ts` | New cases |

## Risks & Mitigations

| ID | Risk | Mitigation | Source |
|---|---|---|---|
| R1 | Provider noncompliance with `quoted_text` causes hard parse failures if field is required, or length constraints cause terminal Zod errors | Phased rollout: `quoted_text` is optional with no Zod-level length constraints. Length (>200 chars) and distinctiveness (<10 chars) are enforced in the verifier by marking `verified: false`, not by throwing. `ZodValidationError` is terminal in this system (convergence.ts:28-41, operations.ts:613), so all enforcement that should be fail-safe must happen post-parse. Compliance rate is observable via `unverified_count` and the stderr counter. Tighten to required once compliance is stable. | F1, F15 |
| R2 | Model self-asserts `verified: true` in structured output, bypassing server-side verification | Strip `verified` from all parsed issues unconditionally before running the verifier. The verifier is the sole authority for this field. | F2 |
| R3 | Systemic verifier bug silently marks all issues `verified: false` | Verifier emits per-exception stderr warnings with issue ID. Exception count is returned in `VerificationResult.exceptionCount`. `unverified_count` in MCP response makes batch-level degradation visible to the orchestrator. | F3 |
| R5 | Sustained `quoted_text` noncompliance degrades all feedback to unverified | Threshold check: if >50% of issues in a response lack `quoted_text`, set `quote_compliance_warning` flag on the feedback (via the formal schema field on top-level feedback types), surfaced in MCP response. | F5 |
| R6 | Adding `planText` parameter to parser functions breaks 21 existing test call sites in `convergence.test.ts` | Default value `planText: string = ''` makes the parameter backward-compatible. With empty plan text, all issues correctly get `verified: false` (no plan to match against). Existing tests compile without changes; verification-specific tests pass plan text explicitly. | F16 |

## Out of Scope

- Verifying `risks[].description` and `assumptions[]` — only `issues[].quoted_text` lands in this change. Extension is straightforward once the verifier is proven on issues.
- Fuzzy / paraphrase verification (embedding similarity, LLM judge). Whitespace-tolerant verbatim is intentionally cheap and deterministic.
- Auto-rejecting unverified issues. The planner sees them and decides; we do not silently drop reviewer output.
- Citing line numbers. Plans are markdown that gets rewritten between rounds — line numbers would invalidate every round. The `quoted_text` itself is the anchor.
- Structured rejection reason enum in `IssueResponseSchema`. The current free-text `rationale` field is sufficient for round 1; a structured enum is a follow-up that touches the revision pipeline holistically. (Deferred from F8.)

## Limitations & Future Work

- **Paraphrased findings produce false negatives.** Mitigated by surfacing `verified: false` to the planner rather than dropping. If false-negative rate is high in practice, consider a 2nd-pass quote-recovery step where planpong asks the reviewer "you cited X which doesn't appear — please re-quote" before forwarding to the planner.
- **No verification on the revision side.** The planner's `IssueResponse` (per `src/schemas/revision.ts`) doesn't carry evidence today. A symmetric verification — "you said you addressed issue X by changing section Y, does Y exist in the new plan?" — is a natural follow-up but requires a separate diff-aware verifier.
- **Quote-stuffing.** A reviewer that pads `quoted_text` with low-value boilerplate ("the plan describes a step") will pass verification trivially. The 200-char cap discourages but doesn't prevent this. If this becomes a problem, score quotes by IDF against the plan text and warn on low-distinctiveness quotes.
- **`unverified_rejected` counter is keyed to free-text rationale.** Matching on the string "unverified evidence" may undercount when the planner varies its wording. A structured rejection reason enum would fix this but requires revision-schema changes deferred to a follow-up.