/**
 * Evidence verification: anchor each reviewer issue to a verbatim quote
 * from the plan.
 *
 * The verifier is pure (no I/O), fail-safe (exceptions never propagate),
 * and the sole authority for the `verified` flag — model-supplied values
 * are stripped upstream in `convergence.ts`.
 *
 * Verification rule: collapse runs of whitespace (including newlines) in
 * both the quote and the plan to a single space; case-sensitive; trim
 * leading/trailing whitespace. If the normalized quote appears in the
 * normalized plan, the issue is `verified: true`.
 *
 * Length and distinctiveness enforcement happens here rather than in
 * Zod because `ZodValidationError` is terminal (no retry/downgrade), so
 * a too-long or too-short quote would kill the entire round. Marking
 * such quotes `verified: false` is fail-safe — the issue still surfaces
 * to the planner, just deprioritized.
 */
import type { FeedbackIssue, PhaseFeedback } from "../schemas/feedback.js";
/** Quotes shorter than this are not distinctive enough to anchor on. */
export declare const MIN_QUOTE_LENGTH = 10;
/** Quotes longer than this are quote-stuffing — discourage. */
export declare const MAX_QUOTE_LENGTH = 200;
/** When >50% of issues lack `quoted_text`, flag compliance warning. */
export declare const COMPLIANCE_WARNING_THRESHOLD = 0.5;
export interface VerificationResult {
    feedback: PhaseFeedback;
    /** Number of verifier exceptions caught (issues marked unverified by error). */
    exceptionCount: number;
}
/**
 * Verify a single issue's `quoted_text` against the plan.
 *
 * Returns `{ verified: false }` for any of:
 * - Missing or empty `quoted_text`
 * - Quote shorter than `MIN_QUOTE_LENGTH` chars (after trimming)
 * - Quote longer than `MAX_QUOTE_LENGTH` chars (after trimming)
 * - Quote not found in the plan after whitespace normalization
 * - Any unexpected exception during normalization (caller can detect via
 *   the verifier-level exception counter)
 */
export declare function verifyIssue(issue: FeedbackIssue, planText: string): {
    verified: boolean;
};
/**
 * Verify all issues on a feedback object, populating `verified` per issue
 * and `quote_compliance_warning` + `unverified_count` at the top level.
 *
 * Returns a NEW feedback object — does not mutate the input. The exception
 * count is for telemetry (see Risks & Mitigations R3 in the plan).
 *
 * Note: callers must strip any model-supplied `verified` from issues BEFORE
 * calling this function. This verifier is the sole authority on that field.
 */
export declare function verifyFeedback(feedback: PhaseFeedback, planText: string): VerificationResult;
/**
 * Strip model-supplied `verified` from every issue. Called before
 * `verifyFeedback` so the model cannot self-assert verification status.
 *
 * Mutates and returns the same array element-wise (cheap; the caller has
 * just constructed these objects from a parse step).
 */
export declare function stripModelVerified(issues: FeedbackIssue[]): FeedbackIssue[];
