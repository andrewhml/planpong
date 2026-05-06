import type { Session } from "../schemas/session.js";
import type { PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import { readRoundFeedback, readRoundResponse } from "./session.js";

export type RoundNextAction =
  | "get_feedback"
  | "revise"
  | "next_round"
  | "terminal";

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

export function getRoundState(
  cwd: string,
  session: Session,
  maxRounds?: number,
): RoundState {
  const currentRound = session.currentRound;
  if (currentRound <= 0) {
    return {
      currentRound,
      hasFeedback: false,
      hasResponse: false,
      latestFeedback: null,
      latestResponse: null,
      nextAction: "get_feedback",
      incompleteTransition: false,
      inconsistentArtifacts: false,
    };
  }

  const latestFeedback = readRoundFeedback(cwd, session.id, currentRound);
  const latestResponse = readRoundResponse(cwd, session.id, currentRound);
  const hasFeedback = latestFeedback !== null;
  const hasResponse = latestResponse !== null;
  const inconsistentArtifacts = hasResponse && !hasFeedback;
  const incompleteTransition = !hasFeedback && !hasResponse;

  let nextAction: RoundNextAction;
  if (inconsistentArtifacts) {
    nextAction = "terminal";
  } else if (!hasFeedback) {
    nextAction = "get_feedback";
  } else if (!hasResponse) {
    nextAction = "revise";
  } else if (maxRounds !== undefined && currentRound >= maxRounds) {
    nextAction = "terminal";
  } else {
    nextAction = "next_round";
  }

  return {
    currentRound,
    hasFeedback,
    hasResponse,
    latestFeedback,
    latestResponse,
    nextAction,
    incompleteTransition,
    inconsistentArtifacts,
  };
}
