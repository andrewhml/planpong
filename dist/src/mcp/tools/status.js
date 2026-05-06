import { z } from "zod";
import { readSessionState, readRoundFeedback, readRoundResponse, readRoundMetrics, } from "../../core/session.js";
import { formatTrajectory, severityFromFeedback, } from "../../core/operations.js";
import { getRoundState } from "../../core/round-state.js";
const inputSchema = {
    session_id: z.string().describe("Session ID to check"),
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export function registerStatus(server) {
    server.tool("planpong_status", "Check session state and round history for a planpong review session.", inputSchema, async (input) => {
        const cwd = input.cwd ?? process.cwd();
        const session = readSessionState(cwd, input.session_id);
        if (!session) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: `Session not found: ${input.session_id}`,
                        }),
                    },
                ],
                isError: true,
            };
        }
        const rounds = [];
        const severities = [];
        for (let r = 1; r <= session.currentRound; r++) {
            const fb = readRoundFeedback(cwd, session.id, r);
            const resp = readRoundResponse(cwd, session.id, r);
            const roundInfo = {
                round: r,
                feedback_written: fb !== null,
                response_written: resp !== null,
            };
            if (fb) {
                roundInfo.feedback_summary = fb.summary;
                roundInfo.verdict = fb.verdict;
                const severity = severityFromFeedback(fb);
                roundInfo.severity_counts = severity;
                severities.push(severity);
            }
            if (resp) {
                let accepted = 0, rejected = 0, deferred = 0;
                for (const response of resp.responses) {
                    if (response.action === "accepted")
                        accepted++;
                    else if (response.action === "rejected")
                        rejected++;
                    else if (response.action === "deferred")
                        deferred++;
                }
                roundInfo.response_summary = `${accepted} accepted, ${rejected} rejected, ${deferred} deferred`;
                roundInfo.accepted = accepted;
                roundInfo.rejected = rejected;
                roundInfo.deferred = deferred;
            }
            const revMetrics = readRoundMetrics(cwd, session.id, r, "revision");
            if (revMetrics?.revision_mode) {
                roundInfo.revision_mode = revMetrics.revision_mode;
                if (revMetrics.revision_mode === "edits") {
                    if (revMetrics.edits_applied != null)
                        roundInfo.edits_applied = revMetrics.edits_applied;
                    if (revMetrics.edits_failed != null)
                        roundInfo.edits_failed = revMetrics.edits_failed;
                    if (revMetrics.edits_recovered != null)
                        roundInfo.edits_recovered = revMetrics.edits_recovered;
                    if (revMetrics.retry_invoked != null)
                        roundInfo.retry_invoked = revMetrics.retry_invoked;
                }
            }
            rounds.push(roundInfo);
        }
        const roundState = getRoundState(cwd, session);
        if (session.currentRound > 0 && rounds.length > 0) {
            const current = rounds.find((r) => r.round === session.currentRound);
            if (current) {
                current.next_action = roundState.nextAction;
                current.incomplete_transition = roundState.incompleteTransition;
                current.inconsistent_artifacts = roundState.inconsistentArtifacts;
            }
        }
        const trajectory = severities.length > 0
            ? formatTrajectory(severities)
            : "No rounds completed";
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        session: {
                            id: session.id,
                            plan_path: session.planPath,
                            status: session.status,
                            current_round: session.currentRound,
                            started_at: session.startedAt,
                            planner: session.planner,
                            reviewer: session.reviewer,
                            next_action: roundState.nextAction,
                            incomplete_transition: roundState.incompleteTransition,
                            inconsistent_artifacts: roundState.inconsistentArtifacts,
                        },
                        rounds,
                        trajectory,
                    }),
                },
            ],
        };
    });
}
//# sourceMappingURL=status.js.map