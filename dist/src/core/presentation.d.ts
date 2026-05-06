import type { PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import type { RoundSeverity } from "./operations.js";
export type PlannerDecision = "pending" | "accepted" | "rejected" | "deferred" | "missing";
export interface IssueDecisionRow {
    issue_id: string;
    severity: "P1" | "P2" | "P3";
    section: string;
    title: string;
    decision: PlannerDecision;
    rationale?: string;
    verified?: boolean;
}
export interface DecisionRowsResult {
    rows: IssueDecisionRow[];
    warnings: string[];
}
export declare function buildDecisionRows(feedback: PhaseFeedback, revision: PlannerRevision): DecisionRowsResult;
export declare function formatFeedbackDisplay(args: {
    round: number;
    phase: string;
    verdict: string;
    severity: RoundSeverity;
    feedback: PhaseFeedback;
    phaseSignal?: string;
}): {
    markdown: string;
    rows: IssueDecisionRow[];
};
export declare function formatDecisionDisplay(args: {
    round: number;
    feedback: PhaseFeedback;
    revision: PlannerRevision;
    warning?: string;
}): {
    markdown: string;
    rows: IssueDecisionRow[];
    warnings: string[];
};
