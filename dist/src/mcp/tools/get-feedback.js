import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { getProvider } from "../../providers/registry.js";
import { readSessionState, writeSessionState, readInitialPlan, } from "../../core/session.js";
import { runReviewRound, writeStatusLineToPlan, } from "../../core/operations.js";
import { getReviewPhase } from "../../prompts/reviewer.js";
const inputSchema = {
    session_id: z.string().describe("Session ID from planpong_start_review"),
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export async function getFeedbackHandler(input) {
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
    // Advance round
    session.currentRound++;
    writeSessionState(cwd, session);
    const config = loadConfig({ cwd });
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
    // Build config with session overrides
    const sessionConfig = {
        ...config,
        reviewer: session.reviewer,
        planner: session.planner,
    };
    const result = await runReviewRound(session, cwd, sessionConfig, reviewerProvider);
    // Update status line with review results
    const suffix = result.converged
        ? result.feedback.verdict === "blocked"
            ? `BLOCKED in ${getReviewPhase(result.round)} phase`
            : `Approved after ${result.round} rounds`
        : `Reviewed — ${result.feedback.issues.length} issues`;
    const statusLine = writeStatusLineToPlan(session, cwd, sessionConfig, suffix);
    const phase = getReviewPhase(result.round);
    const response = {
        round: result.round,
        phase,
        verdict: result.feedback.verdict,
        summary: result.feedback.summary,
        issues: result.feedback.issues,
        severity_counts: result.severity,
        is_converged: result.converged,
        status_line: statusLine,
    };
    if (result.timing) {
        response.timing = result.timing;
    }
    // Phase-specific lean fields for status line consumption
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
        // Include initial plan for change summary
        const initialPlan = readInitialPlan(cwd, session.id);
        if (initialPlan) {
            response.initial_plan = initialPlan;
            const planPath = resolve(cwd, session.planPath);
            response.final_plan = readFileSync(planPath, "utf-8");
        }
    }
    return {
        content: [
            {
                type: "text",
                text: statusLine,
            },
            {
                type: "text",
                text: JSON.stringify(response),
            },
        ],
    };
}
export function registerGetFeedback(server) {
    server.tool("planpong_get_feedback", "Send the current plan to the reviewer model for critique. Returns structured feedback with issues, severity counts, and convergence status.", inputSchema, getFeedbackHandler);
}
//# sourceMappingURL=get-feedback.js.map