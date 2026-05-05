import type { Session } from "../schemas/session.js";
import type { PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
export type RoundNextAction = "get_feedback" | "revise" | "next_round" | "terminal";
export interface RoundState {
    currentRound: number;
    hasFeedback: boolean;
    hasResponse: boolean;
    latestFeedback: PhaseFeedback | null;
    latestResponse: PlannerRevision | null;
    nextAction: RoundNextAction;
    incompleteTransition: boolean;
    inconsistentArtifacts: boolean;
}
export declare function getRoundState(cwd: string, session: Session, maxRounds?: number): RoundState;
