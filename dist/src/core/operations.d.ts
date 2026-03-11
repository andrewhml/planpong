import type { Provider } from "../providers/types.js";
import type { PlanpongConfig, ProviderConfig } from "../schemas/config.js";
import type { PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import { getReviewPhase } from "../prompts/reviewer.js";
import type { Session } from "../schemas/session.js";
export interface RoundSeverity {
    P1: number;
    P2: number;
    P3: number;
}
export interface PhaseExtras {
    confidence?: "high" | "medium" | "low";
    risk_level?: "high" | "medium" | "low";
    risk_count?: number;
    risks_promoted?: number;
    is_blocked?: boolean;
}
export interface ReviewRoundResult {
    round: number;
    feedback: PhaseFeedback;
    severity: RoundSeverity;
    converged: boolean;
    phaseExtras: PhaseExtras;
}
export interface RevisionRoundResult {
    round: number;
    revision: PlannerRevision;
    accepted: number;
    rejected: number;
    deferred: number;
    planUpdated: boolean;
}
export interface SessionInit {
    session: Session;
    planContent: string;
    config: PlanpongConfig;
}
export declare function hashFile(path: string): string;
export declare function formatRoundSeverity(round: RoundSeverity): string;
export declare function formatTrajectory(trajectory: RoundSeverity[]): string;
export declare function severityFromFeedback(feedback: PhaseFeedback): RoundSeverity;
export declare function formatTallies(accepted: number, rejected: number, deferred: number): string;
export declare function formatDuration(ms: number): string;
export declare function formatProviderLabel(provider: ProviderConfig): string;
export interface SessionStats {
    issueTrajectory: RoundSeverity[];
    totalAccepted: number;
    totalRejected: number;
    totalDeferred: number;
}
export declare function computeSessionStats(cwd: string, sessionId: string, currentRound: number): SessionStats;
export declare function formatPhaseExtras(phase: ReturnType<typeof getReviewPhase>, extras: PhaseExtras): string;
export declare function buildStatusLine(session: Session, config: PlanpongConfig, issueTrajectory: RoundSeverity[], accepted: number, rejected: number, deferred: number, linesAdded: number, linesRemoved: number, elapsed: number, phaseExtras?: PhaseExtras): string;
/**
 * Build and write the status line to the plan file.
 * Used by both CLI and MCP paths after each round.
 */
export declare function writeStatusLineToPlan(session: Session, cwd: string, config: PlanpongConfig, suffix?: string): string;
export declare function updatePlanStatusLine(planContent: string, statusLine: string): string;
/**
 * Initialize a review session for an existing plan file.
 * Validates the file exists, creates a session directory, and writes
 * an initial status line to the plan.
 */
export declare function initReviewSession(planPath: string, cwd: string, config: PlanpongConfig): SessionInit;
/**
 * Run a single review round: send current plan to the reviewer for critique.
 */
export declare function runReviewRound(session: Session, cwd: string, config: PlanpongConfig, reviewerProvider: Provider): Promise<ReviewRoundResult>;
/**
 * Run a single revision round: send plan + feedback to the planner for revision.
 */
export declare function runRevisionRound(session: Session, cwd: string, config: PlanpongConfig, plannerProvider: Provider): Promise<RevisionRoundResult>;
/**
 * Mark the session as approved and update the plan's status line.
 */
export declare function finalizeApproved(session: Session, cwd: string, config: PlanpongConfig, issueTrajectory: RoundSeverity[], totalAccepted: number, totalRejected: number, totalDeferred: number, startTime: number, initialLineCount: number): void;
