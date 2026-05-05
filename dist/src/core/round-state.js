import { readRoundFeedback, readRoundResponse } from "./session.js";
export function getRoundState(cwd, session, maxRounds) {
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
    let nextAction;
    if (inconsistentArtifacts) {
        nextAction = "terminal";
    }
    else if (!hasFeedback) {
        nextAction = "get_feedback";
    }
    else if (!hasResponse) {
        nextAction = "revise";
    }
    else if (maxRounds !== undefined && currentRound >= maxRounds) {
        nextAction = "terminal";
    }
    else {
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
//# sourceMappingURL=round-state.js.map