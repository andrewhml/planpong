import { z } from "zod";
import { readSessionState, readRoundFeedback, readRoundResponse, } from "../../core/session.js";
import { severityFromFeedback, formatTrajectory, } from "../../core/operations.js";
import { getReviewPhase } from "../../prompts/reviewer.js";
const inputSchema = {
    session_id: z.string().describe("Session ID to generate report for"),
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export function registerGetReport(server) {
    server.tool("planpong_get_report", "Get a detailed phase-specific report for a completed or in-progress review session. Shows direction assessment, risk register, and detail round history.", inputSchema, async (input) => {
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
        const isComplete = session.status === "approved" || session.status === "blocked";
        let fallbackCount = 0;
        // Build direction section (round 1)
        let direction = "not_reached";
        const r1Feedback = readRoundFeedback(cwd, session.id, 1);
        const r1Response = readRoundResponse(cwd, session.id, 1);
        if (r1Feedback) {
            const fb = r1Feedback;
            const fallbackUsed = !!fb.fallback_used;
            if (fallbackUsed)
                fallbackCount++;
            const dirReport = {
                issues: fb.issues,
                fallback_used: fallbackUsed,
            };
            // Extract direction-specific fields if present
            if ("confidence" in fb) {
                dirReport.confidence = fb.confidence;
            }
            if ("approach_assessment" in fb) {
                dirReport.approach_assessment = fb.approach_assessment;
            }
            if ("alternatives" in fb) {
                dirReport.alternatives = fb.alternatives;
            }
            if ("assumptions" in fb) {
                dirReport.assumptions = fb.assumptions;
            }
            if (r1Response) {
                dirReport.revision_responses = r1Response.responses;
            }
            direction = dirReport;
        }
        // Build risk section (round 2)
        let risk = "not_reached";
        const r2Feedback = readRoundFeedback(cwd, session.id, 2);
        const r2Response = readRoundResponse(cwd, session.id, 2);
        if (r2Feedback) {
            const fb = r2Feedback;
            const fallbackUsed = !!fb.fallback_used;
            if (fallbackUsed)
                fallbackCount++;
            const riskReport = {
                issues: fb.issues,
                fallback_used: fallbackUsed,
            };
            if ("risk_level" in fb) {
                riskReport.risk_level = fb.risk_level;
            }
            if ("risks" in fb) {
                riskReport.risks = fb.risks;
            }
            if (r2Response) {
                riskReport.revision_responses = r2Response.responses;
            }
            risk = riskReport;
        }
        // Build detail rounds (round 3+)
        const detailRounds = [];
        for (let r = 3; r <= session.currentRound; r++) {
            const fb = readRoundFeedback(cwd, session.id, r);
            if (!fb)
                continue;
            const fallbackUsed = !!fb.fallback_used;
            if (fallbackUsed)
                fallbackCount++;
            const roundReport = {
                round: r,
                verdict: fb.verdict,
                summary: fb.summary,
                issues: fb.issues,
                fallback_used: fallbackUsed,
            };
            const resp = readRoundResponse(cwd, session.id, r);
            if (resp) {
                roundReport.revision_responses = resp.responses;
            }
            detailRounds.push(roundReport);
        }
        // Build trajectory
        const severities = [];
        for (let r = 1; r <= session.currentRound; r++) {
            const fb = readRoundFeedback(cwd, session.id, r);
            if (fb)
                severities.push(severityFromFeedback(fb));
        }
        const trajectory = severities.length > 0 ? formatTrajectory(severities) : "";
        // Determine blocked info
        let blockedInfo;
        if (session.status === "blocked") {
            // Find which round blocked
            for (let r = 1; r <= session.currentRound; r++) {
                const fb = readRoundFeedback(cwd, session.id, r);
                if (fb && fb.verdict === "blocked") {
                    blockedInfo = { phase: getReviewPhase(r), round: r };
                    break;
                }
            }
        }
        const report = {
            session: {
                id: session.id,
                status: session.status,
                rounds_completed: session.currentRound,
                complete: isComplete,
                fallback_count: fallbackCount,
                ...(blockedInfo && { blocked_in: blockedInfo }),
            },
            direction,
            risk,
            detail_rounds: detailRounds,
            trajectory,
        };
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(report),
                },
            ],
        };
    });
}
//# sourceMappingURL=get-report.js.map