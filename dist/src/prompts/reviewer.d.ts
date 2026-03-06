import type { IssueResponse } from "../schemas/revision.js";
export declare function buildReviewPrompt(planContent: string, priorDecisions: string | null): string;
export declare function formatPriorDecisions(rounds: Array<{
    round: number;
    responses: IssueResponse[];
    issues: Array<{
        id: string;
        severity: string;
        title: string;
    }>;
}>): string;
