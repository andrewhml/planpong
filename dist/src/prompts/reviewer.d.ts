import type { IssueResponse } from "../schemas/revision.js";
export type ReviewPhase = "direction" | "risk" | "detail";
export declare function getReviewPhase(round: number): ReviewPhase;
/**
 * Incremental review prompt for resumed reviewer sessions.
 *
 * The reviewer has already seen the full plan (round 1) and produced its
 * own prior critique. Instead of re-sending the full plan markdown, we
 * send only what's changed since the model last saw it (a markdown diff)
 * plus the new phase instructions.
 *
 * Falls back to full-plan content if `planDiffOrContent` is the entire
 * plan rather than a diff (caller's choice — see operations.ts logic that
 * skips diffing on certain cases).
 */
export declare function buildIncrementalReviewPrompt(planDiffOrContent: string, priorDecisions: string | null, phase?: ReviewPhase, structuredOutput?: boolean): string;
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
