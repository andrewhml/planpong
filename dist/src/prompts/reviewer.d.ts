import type { IssueResponse } from "../schemas/revision.js";
export type ReviewPhase = "direction" | "risk" | "detail";
export declare function getReviewPhase(round: number): ReviewPhase;
/**
 * Incremental review prompt for resumed reviewer sessions.
 *
 * The reviewer has already seen the full plan (round 1) and produced its
 * own prior critique. Round 2+ prompts include both the diff (for change
 * context) AND the full current plan text (for unambiguous quoting).
 *
 * **Why ship the full plan even when the model has it in session memory:**
 * the cite-evidence block requires verbatim `quoted_text` matching against
 * the *current* plan. Without an authoritative current-plan section, the
 * reviewer must reconstruct from R1's full plan + every subsequent diff in
 * its memory. That's fragile (context loss, truncation, attention to old
 * lines). Sending the full plan eliminates the reconstruction job. Plans
 * are typically < 10KB — the cost is marginal next to a wasted round from
 * bad quotes.
 *
 * `planDiffOrContent` carries the diff (or, when the caller skips diffing,
 * the full plan as a fallback). `currentPlanContent` is always the
 * authoritative current plan.
 */
export declare function buildIncrementalReviewPrompt(planDiffOrContent: string, currentPlanContent: string, priorDecisions: string | null, phase?: ReviewPhase, structuredOutput?: boolean): string;
export declare function buildReviewPrompt(planContent: string, priorDecisions: string | null, phase?: ReviewPhase, structuredOutput?: boolean): string;
export declare function formatPriorDecisions(rounds: Array<{
    round: number;
    responses: IssueResponse[];
    issues: Array<{
        id: string;
        severity: string;
        title: string;
    }>;
}>): string;
