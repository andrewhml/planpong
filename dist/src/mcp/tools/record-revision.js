import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSessionState, readRoundFeedback, readRoundResponse, writeRoundMetrics, withSessionLock, } from "../../core/session.js";
import { finalizeRevision, writeStatusLineToPlan, } from "../../core/operations.js";
import { loadConfig } from "../../config/loader.js";
import { getReviewPhase } from "../../prompts/reviewer.js";
import { IssueResponseSchema, } from "../../schemas/revision.js";
import { formatDecisionDisplay } from "../../core/presentation.js";
/**
 * Inline-mode counterpart to `planpong_revise`. The agent that invoked
 * /pong-review acts as the planner: it edited the plan with its own
 * Edit/Write tools, then calls this tool to log the per-issue responses
 * and advance the session bookkeeping.
 *
 * No planner provider is invoked. The shared `finalizeRevision` helper
 * persists the response file, updates the plan hash, and writes session
 * state — same path the external mode takes after `runRevisionRound`.
 */
const inputSchema = {
    session_id: z.string().describe("Session ID from planpong_start_review"),
    expected_round: z
        .number()
        .int()
        .nonnegative()
        .describe("The round this revision responds to. Must equal session.currentRound. Catches double-submission and stale tool calls."),
    responses: z
        .array(IssueResponseSchema)
        .describe("One response per issue from the round's feedback. Every issue.id MUST appear here."),
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export async function recordRevisionHandler(input) {
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
        if (session.status !== "in_review") {
            return errorResponse(`Session status is '${session.status}', expected 'in_review'`);
        }
        if (session.plannerMode !== "inline") {
            return errorResponse(`session is in ${session.plannerMode} planner mode — use planpong_revise instead`, { planner_mode: session.plannerMode });
        }
        if (input.expected_round !== session.currentRound) {
            const relation = input.expected_round < session.currentRound ? "stale" : "out-of-order";
            const message = relation === "stale"
                ? `stale revision call for round ${input.expected_round}; current round is ${session.currentRound}`
                : `out-of-order revision call for round ${input.expected_round}; call planpong_get_feedback first`;
            return errorResponse(message, {
                expected_round: input.expected_round,
                current_round: session.currentRound,
            });
        }
        const feedback = readRoundFeedback(cwd, session.id, session.currentRound);
        if (!feedback) {
            return errorResponse(`No feedback found for session ${session.id} round ${session.currentRound}. Call planpong_get_feedback first.`);
        }
        const existingResponse = readRoundResponse(cwd, session.id, session.currentRound);
        if (existingResponse &&
            JSON.stringify(existingResponse.responses) ===
                JSON.stringify(input.responses)) {
            const accepted = existingResponse.responses.filter((r) => r.action === "accepted").length;
            const rejected = existingResponse.responses.filter((r) => r.action === "rejected").length;
            const deferred = existingResponse.responses.filter((r) => r.action === "deferred").length;
            const config = loadConfig({ cwd });
            const sessionConfig = {
                ...config,
                planner: session.planner,
                reviewer: session.reviewer,
            };
            const statusLine = writeStatusLineToPlan(session, cwd, sessionConfig, "Revision recorded");
            return buildRecordRevisionResponse({
                round: session.currentRound,
                feedback,
                revision: existingResponse,
                responses: existingResponse.responses,
                accepted,
                rejected,
                deferred,
                unverifiedRejected: countUnverifiedRejected(existingResponse.responses),
                planUpdated: false,
                statusLine,
                idempotentReplay: true,
            });
        }
        if (existingResponse) {
            return errorResponse(`round ${session.currentRound} already finalized with different responses`, {
                current_round: session.currentRound,
                idempotent_replay: false,
            });
        }
        // Validate every issue has a response. Mirrors the planner prompt's
        // "every issue MUST have an entry in responses" constraint so inline
        // mode produces the same shape downstream tools expect.
        const responseIds = new Set(input.responses.map((r) => r.issue_id));
        const missing = feedback.issues
            .map((i) => i.id)
            .filter((id) => !responseIds.has(id));
        if (missing.length > 0) {
            return errorResponse(`responses missing for issue(s): ${missing.join(", ")}. Provide one response per feedback issue.`, { missing_issue_ids: missing });
        }
        const round = session.currentRound;
        const phase = getReviewPhase(round);
        const planPath = resolve(cwd, session.planPath);
        // Hash before finalize so we can detect "agent forgot to edit".
        const planHashBefore = session.planHash;
        // Construct PlannerRevision-shape payload. Direction phase keeps the
        // full-plan shape; risk/detail keep the edits shape (with empty edits[]
        // — the agent applied changes via its own Edit tool rather than
        // declaring them here, so the array is informational-only).
        const planContent = readFileSync(planPath, "utf-8");
        const revision = phase === "direction"
            ? { responses: input.responses, updated_plan: planContent }
            : { responses: input.responses, edits: [] };
        const tally = finalizeRevision({
            session,
            cwd,
            round,
            revision,
            planPath,
        });
        // Plan-hash warn: any accepted issue should correspond to a plan edit.
        // Surface the no-op case but don't gate — sometimes all issues are
        // legitimately rejected and the plan correctly stays unchanged.
        const planUnchanged = session.planHash === planHashBefore;
        const anyAccepted = input.responses.some((r) => r.action === "accepted");
        const planUpdateWarning = planUnchanged && anyAccepted
            ? `Round ${round} has accepted issues but the plan hash is unchanged. Confirm the plan edits were applied.`
            : undefined;
        if (planUnchanged && anyAccepted) {
            process.stderr.write(`[planpong] warn: round ${round} has accepted issues but plan hash is unchanged — did the agent forget to edit?\n`);
        }
        // Write fully valid RoundMetrics so bench/run.ts:226 doesn't drop this
        // round from analysis. Inline revisions have no provider duration —
        // started_at and completed_at are the same instant.
        const ts = new Date().toISOString();
        const metrics = {
            schema_version: 1,
            session_id: session.id,
            round,
            phase,
            role: "revision",
            started_at: ts,
            completed_at: ts,
            total_duration_ms: 0,
            attempts: [],
            planner_mode: "inline",
        };
        writeRoundMetrics(cwd, session.id, round, "revision", metrics);
        // Update plan status line. Use loadConfig for provider labels (the
        // status-line writer needs them). In inline mode the planner provider
        // is informational, not invoked.
        const config = loadConfig({ cwd });
        const sessionConfig = {
            ...config,
            planner: session.planner,
            reviewer: session.reviewer,
        };
        const statusLine = writeStatusLineToPlan(session, cwd, sessionConfig, "Revision recorded");
        // Match planpong_revise's unverified_rejected counter so the slash
        // command can consume either tool's output uniformly.
        return buildRecordRevisionResponse({
            round,
            feedback,
            revision,
            responses: input.responses,
            accepted: tally.accepted,
            rejected: tally.rejected,
            deferred: tally.deferred,
            unverifiedRejected: countUnverifiedRejected(input.responses),
            planUpdated: !planUnchanged,
            statusLine,
            idempotentReplay: !tally.fresh,
            displayWarning: planUpdateWarning,
        });
    });
}
function countUnverifiedRejected(responses) {
    return responses.filter((r) => r.action === "rejected" &&
        /unverified\s+evidence/i.test(r.rationale ?? "")).length;
}
function buildRecordRevisionResponse(args) {
    const display = formatDecisionDisplay({
        round: args.round,
        feedback: args.feedback,
        revision: args.revision,
        warning: args.displayWarning,
    });
    const payload = {
        round: args.round,
        responses: args.responses,
        accepted: args.accepted,
        rejected: args.rejected,
        deferred: args.deferred,
        unverified_rejected: args.unverifiedRejected,
        plan_updated: args.planUpdated,
        status_line: args.statusLine,
        planner_mode: "inline",
        idempotent_replay: args.idempotentReplay,
        decision_rows: display.rows,
        display_markdown: display.markdown,
        ...(display.warnings.length > 0 && { display_warnings: display.warnings }),
    };
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
export function registerRecordRevision(server) {
    server.tool("planpong_record_revision", "Inline-mode revision: log the agent's per-issue responses and advance session bookkeeping. The agent must have already edited the plan with its own Edit/Write tools. Use only when planpong_start_review was called with planner_mode: 'inline'. Otherwise call planpong_revise.", inputSchema, recordRevisionHandler);
}
//# sourceMappingURL=record-revision.js.map