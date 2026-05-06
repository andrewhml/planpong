import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { getProvider } from "../../providers/registry.js";
import { readSessionState, writeSessionState, readInitialPlan, withSessionLock, } from "../../core/session.js";
import { runReviewRound, severityFromFeedback, writeStatusLineToPlan, formatPhaseExtras, phaseExtrasFromFeedback, } from "../../core/operations.js";
import { getReviewPhase } from "../../prompts/reviewer.js";
import { formatFeedbackDisplay } from "../../core/presentation.js";
import { getRoundState } from "../../core/round-state.js";
const inputSchema = {
    session_id: z.string().describe("Session ID from planpong_start_review"),
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export async function getFeedbackHandler(input) {
    const cwd = input.cwd ?? process.cwd();
    const existing = readSessionState(cwd, input.session_id);
    if (!existing) {
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
    return withSessionLock(cwd, input.session_id, async () => {
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
        const config = loadConfig({ cwd });
        const sessionConfig = {
            ...config,
            reviewer: session.reviewer,
            planner: session.planner,
        };
        const roundState = getRoundState(cwd, session, sessionConfig.max_rounds);
        if (session.status !== "in_review") {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: `Session status is '${session.status}', expected 'in_review'`,
                        }),
                    },
                ],
                isError: true,
            };
        }
        if (roundState.inconsistentArtifacts) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: `Session ${session.id} has round ${session.currentRound} response without feedback`,
                            current_round: session.currentRound,
                        }),
                    },
                ],
                isError: true,
            };
        }
        if (roundState.currentRound > 0 &&
            roundState.latestFeedback &&
            !roundState.latestResponse) {
            return buildFeedbackResponse({
                session,
                cwd,
                config: sessionConfig,
                result: reviewResultFromFeedback(roundState.currentRound, roundState.latestFeedback),
                idempotentReplay: true,
            });
        }
        if (roundState.currentRound > 0 &&
            roundState.latestFeedback &&
            roundState.latestResponse) {
            if (roundState.currentRound >= sessionConfig.max_rounds) {
                const statusLine = writeStatusLineToPlan(session, cwd, sessionConfig, "Max rounds reached");
                return {
                    content: [
                        { type: "text", text: statusLine },
                        {
                            type: "text",
                            text: JSON.stringify({
                                status: "max_rounds",
                                round: roundState.currentRound,
                                is_converged: false,
                                status_line: statusLine,
                                idempotent_replay: false,
                            }),
                        },
                    ],
                };
            }
            session.currentRound++;
            writeSessionState(cwd, session);
        }
        else if (roundState.currentRound === 0) {
            session.currentRound = 1;
            writeSessionState(cwd, session);
        }
        // If currentRound > 0 and feedback is missing, this is an incomplete
        // transition from a prior attempt. Retry the same round without
        // incrementing.
        // Use session-stored provider config
        const reviewerProvider = getProvider(session.reviewer.provider);
        if (!reviewerProvider) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: `Reviewer provider not found: ${session.reviewer.provider}`,
                        }),
                    },
                ],
                isError: true,
            };
        }
        const result = await runReviewRound(session, cwd, sessionConfig, reviewerProvider);
        return buildFeedbackResponse({
            session,
            cwd,
            config: sessionConfig,
            result,
            idempotentReplay: false,
            resumedIncompleteRound: roundState.incompleteTransition,
        });
    });
}
function reviewResultFromFeedback(round, feedback) {
    const phase = getReviewPhase(round);
    const severity = severityFromFeedback(feedback);
    const phaseExtras = phaseExtrasFromFeedback(phase, feedback);
    return {
        round,
        feedback,
        severity,
        converged: feedback.verdict !== "needs_revision",
        phaseExtras,
    };
}
function buildFeedbackResponse(args) {
    const { session, cwd, config, result } = args;
    const suffix = result.converged
        ? result.feedback.verdict === "blocked"
            ? `BLOCKED in ${getReviewPhase(result.round)} phase`
            : `Approved after ${result.round} rounds`
        : `Reviewed — ${result.feedback.issues.length} issues`;
    const statusLine = writeStatusLineToPlan(session, cwd, config, suffix, result.phaseExtras);
    const phase = getReviewPhase(result.round);
    const phaseSignal = formatPhaseExtras(phase, result.phaseExtras);
    const display = formatFeedbackDisplay({
        round: result.round,
        phase,
        verdict: result.feedback.verdict,
        severity: result.severity,
        feedback: result.feedback,
        phaseSignal,
    });
    const response = {
        round: result.round,
        phase,
        phase_label: phase,
        verdict: result.feedback.verdict,
        summary: result.feedback.summary,
        issues: result.feedback.issues,
        issue_rows: display.rows,
        severity_counts: result.severity,
        is_converged: result.converged,
        status_line: statusLine,
        display_markdown: display.markdown,
        idempotent_replay: args.idempotentReplay,
    };
    if (args.resumedIncompleteRound) {
        response.resumed_incomplete_round = true;
    }
    if (result.timing) {
        response.timing = result.timing;
    }
    if (result.feedback.unverified_count !== undefined) {
        response.unverified_count = result.feedback.unverified_count;
    }
    if (result.feedback.quote_compliance_warning) {
        response.quote_compliance_warning = true;
    }
    if (result.phaseExtras.is_blocked) {
        response.is_blocked = true;
    }
    if (phase === "direction" && result.phaseExtras.confidence) {
        response.confidence = result.phaseExtras.confidence;
    }
    if (phase === "risk") {
        if (result.phaseExtras.risk_level) {
            response.risk_level = result.phaseExtras.risk_level;
        }
        if (result.phaseExtras.risk_count !== undefined) {
            response.risk_count = result.phaseExtras.risk_count;
        }
        if (result.phaseExtras.risks_promoted !== undefined) {
            response.risks_promoted = result.phaseExtras.risks_promoted;
        }
    }
    if (result.converged) {
        if (result.feedback.verdict === "blocked") {
            session.status = "blocked";
        }
        else {
            session.status = "approved";
            const planPath = resolve(cwd, session.planPath);
            let planContent = readFileSync(planPath, "utf-8");
            planContent = planContent.replace(/\*\*Status:\*\* .*/, "**Status:** Approved");
            writeFileSync(planPath, planContent);
        }
        writeSessionState(cwd, session);
        const initialPlan = readInitialPlan(cwd, session.id);
        if (initialPlan) {
            response.initial_plan = initialPlan;
            const planPath = resolve(cwd, session.planPath);
            response.final_plan = readFileSync(planPath, "utf-8");
        }
    }
    return {
        content: [
            { type: "text", text: statusLine },
            { type: "text", text: JSON.stringify(response) },
        ],
    };
}
export function registerGetFeedback(server) {
    server.tool("planpong_get_feedback", "Send the current plan to the reviewer model for critique. Returns structured feedback with issues, severity counts, and convergence status.", inputSchema, getFeedbackHandler);
}
//# sourceMappingURL=get-feedback.js.map