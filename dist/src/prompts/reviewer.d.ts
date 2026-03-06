import type { IssueResponse } from "../schemas/revision.js";
export type ReviewPhase = "direction" | "detail";
export declare function getReviewPhase(round: number): ReviewPhase;
export declare function buildReviewPrompt(planContent: string, priorDecisions: string | null, phase?: ReviewPhase): string;
export declare function formatPriorDecisions(rounds: Array<{
    round: number;
    responses: IssueResponse[];
    issues: Array<{
        id: string;
        severity: string;
        title: string;
    }>;
}>): string;
