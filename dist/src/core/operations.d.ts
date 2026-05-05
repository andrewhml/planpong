import type { Provider } from "../providers/types.js";
import type { PlanpongConfig, ProviderConfig } from "../schemas/config.js";
import type { PhaseFeedback } from "../schemas/feedback.js";
import { type PlannerRevision } from "../schemas/revision.js";
import { getReviewPhase } from "../prompts/reviewer.js";
import type { Session } from "../schemas/session.js";
import { type TimingSummary } from "../schemas/metrics.js";
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
    timing?: TimingSummary;
}
export interface RevisionEditTelemetry {
    revision_mode: "full" | "edits";
    edits_attempted: number | null;
    edits_applied: number | null;
    edits_failed: number | null;
    edits_retried: number | null;
    edits_recovered: number | null;
    retry_invoked: boolean;
}
export interface RevisionRoundResult {
    round: number;
    revision: PlannerRevision;
    accepted: number;
    rejected: number;
    deferred: number;
    planUpdated: boolean;
    timing?: TimingSummary;
    edits?: RevisionEditTelemetry;
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
export declare function phaseExtrasFromFeedback(phase: ReturnType<typeof getReviewPhase>, feedback: PhaseFeedback): PhaseExtras;
export declare function buildStatusLine(session: Session, config: PlanpongConfig, issueTrajectory: RoundSeverity[], accepted: number, rejected: number, deferred: number, linesAdded: number, linesRemoved: number, elapsed: number, phaseExtras?: PhaseExtras): string;
/**
 * Build and write the status line to the plan file.
 * Used by both CLI and MCP paths after each round.
 */
export declare function writeStatusLineToPlan(session: Session, cwd: string, config: PlanpongConfig, suffix?: string, phaseExtras?: PhaseExtras): string;
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
export interface FinalizeFeedbackInput {
    session: Session;
    cwd: string;
    round: number;
    feedback: PhaseFeedback;
    /** True when the reviewer session was already established before this round. */
    reviewerSessionInited: boolean;
    /** Captured reviewer session/thread ID from this round's invocation. */
    capturedSessionId?: string;
}
export interface FinalizeFeedbackResult {
    feedback: PhaseFeedback;
    /**
     * `true` when this call wrote artifacts; `false` when an existing
     * `round-N-feedback.json` was detected and finalization was a no-op.
     * The first writer wins; subsequent calls return the existing feedback
     * without re-writing.
     */
    fresh: boolean;
}
/**
 * Persist review-round artifacts: feedback file, reviewer session ID
 * promotion, blocked-status update, and session.json commit. Mirrors
 * `finalizeRevision` so review and revision rounds share idempotency
 * semantics.
 *
 * Write ordering:
 *   1. `round-N-feedback.json` — the reviewer payload
 *   2. `session.reviewerSessionId` / `reviewerSessionInitialized` (if first round)
 *   3. `session.status = "blocked"` (when verdict === "blocked")
 *   4. `session.json` — single write covering 2+3 (commit point)
 *
 * Idempotency: if `round-N-feedback.json` already exists, returns the
 * existing feedback with `fresh: false`. Tool-level checks in
 * `planpong_get_feedback` are the primary replay path; this helper is the
 * operation-level safety net.
 *
 * **Round advancement is NOT performed here.** `currentRound` is owned by
 * the callers driving the loop (MCP get-feedback, CLI loop). Moving it
 * here would double-advance in MCP mode.
 */
export declare function finalizeFeedback({ session, cwd, round, feedback, reviewerSessionInited, capturedSessionId, }: FinalizeFeedbackInput): FinalizeFeedbackResult;
/**
 * Run a single revision round: send plan + feedback to the planner for revision.
 */
export declare function runRevisionRound(session: Session, cwd: string, config: PlanpongConfig, plannerProvider: Provider): Promise<RevisionRoundResult>;
export interface FinalizeRevisionInput {
    session: Session;
    cwd: string;
    round: number;
    revision: PlannerRevision;
    /** Absolute path to the plan file. Used for the post-revision hash. */
    planPath: string;
}
export interface FinalizeRevisionResult {
    accepted: number;
    rejected: number;
    deferred: number;
    /**
     * `true` when this call wrote artifacts; `false` when an existing
     * matching response file was detected and finalization was a no-op.
     * Idempotent on retries — the first writer wins, subsequent identical
     * calls return the existing tally without re-writing.
     */
    fresh: boolean;
}
/**
 * Persist the final revision artifacts and return the response tally.
 * Shared by `runRevisionRound` (external mode) and
 * `planpong_record_revision` (inline mode) so both paths produce identical
 * on-disk shape.
 *
 * Write ordering (the contract):
 *   1. `round-N-response.json` — the revision payload
 *   2. plan hash — `session.planHash = hashFile(planPath)`
 *   3. `session.json` — session state (commit point)
 *
 * Step 3 is the commit point. A crash before step 3 leaves a stale
 * `round-N-response.json` and an unchanged `session.planHash`; a retry
 * re-enters with the same round number and overwrites the response file
 * (idempotent at this granularity).
 *
 * **Round advancement is NOT performed here.** `currentRound` is owned by
 * the callers that drive the loop: `get-feedback.ts:63` for the MCP path
 * (`session.currentRound++`) and `loop.ts` for the CLI path. Moving
 * advancement into finalization would double-advance in MCP mode.
 *
 * Idempotency: if `round-N-response.json` already exists and its content
 * matches the proposed revision, returns the existing tally without
 * re-writing. Detects retries from upstream (e.g., a stale tool call
 * after a successful finalization) without relying on round-number
 * comparison — `currentRound` is owned elsewhere.
 */
export declare function finalizeRevision({ session, cwd, round, revision, planPath, }: FinalizeRevisionInput): FinalizeRevisionResult;
/**
 * Mark the session as approved and update the plan's status line.
 */
export declare function finalizeApproved(session: Session, cwd: string, config: PlanpongConfig, issueTrajectory: RoundSeverity[], totalAccepted: number, totalRejected: number, totalDeferred: number, startTime: number, initialLineCount: number): void;
