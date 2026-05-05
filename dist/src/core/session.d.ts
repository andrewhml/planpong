import type { Session } from "../schemas/session.js";
import type { PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import type { ProviderConfig } from "../schemas/config.js";
import { type RoundMetrics } from "../schemas/metrics.js";
export declare function createSession(repoRoot: string, planPath: string, planner: ProviderConfig, reviewer: ProviderConfig, planHash: string, plannerMode?: "inline" | "external"): Session;
export declare function writeSessionState(repoRoot: string, session: Session): void;
export declare function withSessionLock<T>(repoRoot: string, sessionId: string, fn: () => Promise<T>): Promise<T>;
export declare function readSessionState(repoRoot: string, sessionId: string): Session | null;
export declare function writeRoundFeedback(repoRoot: string, sessionId: string, round: number, feedback: PhaseFeedback): void;
export declare function writeRoundResponse(repoRoot: string, sessionId: string, round: number, response: PlannerRevision): void;
export declare function readRoundFeedback(repoRoot: string, sessionId: string, round: number): PhaseFeedback | null;
export declare function readRoundResponse(repoRoot: string, sessionId: string, round: number): PlannerRevision | null;
/**
 * Persist a snapshot of the plan content as it was at the start of a given
 * round. Used to compute "what changed since the model last saw it" diffs
 * for resumed-session prompts so the reviewer doesn't have to re-load the
 * full plan on round 2+.
 */
export declare function writeRoundPlanSnapshot(repoRoot: string, sessionId: string, round: number, planContent: string): void;
export declare function readRoundPlanSnapshot(repoRoot: string, sessionId: string, round: number): string | null;
export declare function writeInitialPlan(repoRoot: string, sessionId: string, content: string): void;
export declare function readInitialPlan(repoRoot: string, sessionId: string): string | null;
export declare function writeRoundMetrics(repoRoot: string, sessionId: string, round: number, role: "review" | "revision", metrics: RoundMetrics): void;
export declare function readRoundMetrics(repoRoot: string, sessionId: string, round: number, role: "review" | "revision"): RoundMetrics | null;
export declare function resolvePlanPath(session: Session): string;
