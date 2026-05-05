import { z } from "zod";
import { loadConfig } from "../../config/loader.js";
import { getProvider } from "../../providers/registry.js";
import { readRoundFeedback, readRoundResponse, readSessionState, withSessionLock, } from "../../core/session.js";
import { runRevisionRound, writeStatusLineToPlan, } from "../../core/operations.js";
import { formatDecisionDisplay } from "../../core/presentation.js";
const inputSchema = {
    session_id: z.string().describe("Session ID from planpong_start_review"),
    expected_round: z
        .number()
        .int()
        .positive()
        .describe("The feedback round this revision responds to. Must equal session.currentRound."),
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export async function reviseHandler(input) {
    const cwd = input.cwd ?? process.cwd();
    const existing = readSessionState(cwd, input.session_id);
    if (!existing) {
        return errorResponse(`Session not found: ${input.session_id}`);
    }
    return withSessionLock(cwd, input.session_id, async () => {
        const session = readSessionState(cwd, input.session_id);
        if (!session) {
            return errorResponse(`Session not found: ${input.session_id}`);
        }
        if (input.expected_round < session.currentRound) {
            return errorResponse(`stale revision call for round ${input.expected_round}; current round is ${session.currentRound}`, {
                expected_round: input.expected_round,
                current_round: session.currentRound,
            });
        }
        if (input.expected_round > session.currentRound) {
            return errorResponse(`out-of-order revision call for round ${input.expected_round}; call planpong_get_feedback first`, {
                expected_round: input.expected_round,
                current_round: session.currentRound,
            });
        }
        if (session.status !== "in_review") {
            return errorResponse(`Session status is '${session.status}', expected 'in_review'`);
        }
        if (session.plannerMode === "inline") {
            return errorResponse("session is in inline planner mode — use planpong_record_revision instead", { planner_mode: "inline" });
        }
        const config = loadConfig({ cwd });
        const sessionConfig = {
            ...config,
            planner: session.planner,
            reviewer: session.reviewer,
        };
        const feedback = readRoundFeedback(cwd, session.id, input.expected_round);
        if (!feedback) {
            return errorResponse(`No feedback found for session ${session.id} round ${input.expected_round}. Call planpong_get_feedback first.`);
        }
        const existingResponse = readRoundResponse(cwd, session.id, input.expected_round);
        if (existingResponse) {
            const tally = tallyResponses(existingResponse.responses);
            const statusLine = writeStatusLineToPlan(session, cwd, sessionConfig, "Revision submitted");
            return buildRevisionResponse({
                round: input.expected_round,
                revision: existingResponse,
                accepted: tally.accepted,
                rejected: tally.rejected,
                deferred: tally.deferred,
                planUpdated: false,
                statusLine,
                feedback,
                idempotentReplay: true,
            });
        }
        const plannerProvider = getProvider(session.planner.provider);
        if (!plannerProvider) {
            return errorResponse(`Planner provider not found: ${session.planner.provider}`);
        }
        const result = await runRevisionRound(session, cwd, sessionConfig, plannerProvider);
        // Update status line in plan file (planner may have mangled it)
        const statusLine = writeStatusLineToPlan(session, cwd, sessionConfig, "Revision submitted");
        return buildRevisionResponse({
            ...result,
            statusLine,
            feedback,
            idempotentReplay: false,
        });
    });
}
function tallyResponses(responses) {
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    for (const response of responses) {
        if (response.action === "accepted")
            accepted++;
        else if (response.action === "rejected")
            rejected++;
        else if (response.action === "deferred")
            deferred++;
    }
    return { accepted, rejected, deferred };
}
function buildRevisionResponse(args) {
    const unverifiedRejected = args.revision.responses.filter((r) => r.action === "rejected" &&
        /unverified\s+evidence/i.test(r.rationale ?? "")).length;
    const display = formatDecisionDisplay({
        round: args.round,
        feedback: args.feedback,
        revision: args.revision,
    });
    const payload = {
        round: args.round,
        responses: args.revision.responses,
        accepted: args.accepted,
        rejected: args.rejected,
        deferred: args.deferred,
        unverified_rejected: unverifiedRejected,
        plan_updated: args.planUpdated,
        status_line: args.statusLine,
        idempotent_replay: args.idempotentReplay,
        decision_rows: display.rows,
        display_markdown: display.markdown,
    };
    if (display.warnings.length > 0) {
        payload.display_warnings = display.warnings;
    }
    if (args.timing) {
        payload.timing = args.timing;
    }
    if (args.edits) {
        payload.revision_mode = args.edits.revision_mode;
        if (args.edits.revision_mode === "edits") {
            payload.edits_attempted = args.edits.edits_attempted;
            payload.edits_applied = args.edits.edits_applied;
            payload.edits_failed = args.edits.edits_failed;
            payload.edits_recovered = args.edits.edits_recovered;
            payload.retry_invoked = args.edits.retry_invoked;
        }
    }
    return {
        content: [
            { type: "text", text: args.statusLine },
            { type: "text", text: JSON.stringify(payload) },
        ],
    };
}
function errorResponse(error, extra = {}) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ error, ...extra }),
            },
        ],
        isError: true,
    };
}
export function registerRevise(server) {
    server.tool("planpong_revise", "Send plan + latest feedback to the planner model for revision. Writes the updated plan to disk. Call after planpong_get_feedback returns is_converged: false.", inputSchema, reviseHandler);
}
//# sourceMappingURL=revise.js.map