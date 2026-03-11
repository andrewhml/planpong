import type { Provider } from "../providers/types.js";
import type { PlanpongConfig } from "../schemas/config.js";
import type { PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import { type RoundSeverity } from "./operations.js";
export type { RoundSeverity } from "./operations.js";
export interface LoopCallbacks {
    onPlanGenerated(planPath: string, content: string): Promise<void>;
    onReviewStarting(round: number): void;
    onReviewComplete(round: number, feedback: PhaseFeedback): Promise<void>;
    onRevisionStarting(round: number): void;
    onRevisionComplete(round: number, revision: PlannerRevision): Promise<void>;
    onConverged(round: number, feedback: PhaseFeedback): void;
    onMaxRoundsReached(round: number): void;
    onHashMismatch(planPath: string, autonomous: boolean): Promise<"overwrite" | "abort">;
    /** Return true to continue, false to abort */
    confirmContinue(message: string): Promise<boolean>;
}
export interface LoopOptions {
    requirements: string;
    cwd: string;
    config: PlanpongConfig;
    plannerProvider: Provider;
    reviewerProvider: Provider;
    planName?: string;
    callbacks: LoopCallbacks;
}
export interface ReviewOptions {
    planPath: string;
    cwd: string;
    config: PlanpongConfig;
    plannerProvider: Provider;
    reviewerProvider: Provider;
    callbacks: LoopCallbacks;
}
export interface ReviewResult {
    status: "approved" | "max_rounds" | "aborted";
    rounds: number;
    issueTrajectory: RoundSeverity[];
    accepted: number;
    rejected: number;
    deferred: number;
    planPath: string;
    sessionId: string;
    elapsed: number;
}
export declare function runLoop(options: LoopOptions): Promise<void>;
/**
 * Review an existing plan file through adversarial refinement.
 * Skips plan generation — starts directly at the review cycle.
 * Returns structured result for programmatic consumption.
 */
export declare function runReviewLoop(options: ReviewOptions): Promise<ReviewResult>;
