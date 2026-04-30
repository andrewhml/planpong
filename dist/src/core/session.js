import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RoundMetricsSchema, } from "../schemas/metrics.js";
const SESSIONS_DIR = ".planpong/sessions";
function getSessionDir(repoRoot, sessionId) {
    return join(repoRoot, SESSIONS_DIR, sessionId);
}
export function createSession(repoRoot, planPath, planner, reviewer, planHash) {
    const id = randomBytes(6).toString("hex");
    // Pre-generate a UUID for reviewer-session continuity. Used directly by
    // claude (which accepts external UUIDs); for codex this is a placeholder
    // that gets overwritten after the first invocation with the captured
    // thread_id from codex's --json event stream.
    const reviewerSessionId = randomUUID();
    const session = {
        id,
        repoRoot: resolve(repoRoot),
        planPath,
        planPathAbsolute: resolve(repoRoot, planPath),
        planner,
        reviewer,
        status: "planning",
        currentRound: 0,
        startedAt: new Date().toISOString(),
        planHash,
        reviewerSessionId,
    };
    const dir = getSessionDir(repoRoot, id);
    mkdirSync(dir, { recursive: true });
    writeSessionState(repoRoot, session);
    return session;
}
export function writeSessionState(repoRoot, session) {
    const dir = getSessionDir(repoRoot, session.id);
    writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
}
export function readSessionState(repoRoot, sessionId) {
    const path = join(getSessionDir(repoRoot, sessionId), "session.json");
    if (!existsSync(path))
        return null;
    return JSON.parse(readFileSync(path, "utf-8"));
}
export function writeRoundFeedback(repoRoot, sessionId, round, feedback) {
    const dir = getSessionDir(repoRoot, sessionId);
    writeFileSync(join(dir, `round-${round}-feedback.json`), JSON.stringify(feedback, null, 2));
}
export function writeRoundResponse(repoRoot, sessionId, round, response) {
    const dir = getSessionDir(repoRoot, sessionId);
    writeFileSync(join(dir, `round-${round}-response.json`), JSON.stringify(response, null, 2));
}
export function readRoundFeedback(repoRoot, sessionId, round) {
    const path = join(getSessionDir(repoRoot, sessionId), `round-${round}-feedback.json`);
    if (!existsSync(path))
        return null;
    return JSON.parse(readFileSync(path, "utf-8"));
}
export function readRoundResponse(repoRoot, sessionId, round) {
    const path = join(getSessionDir(repoRoot, sessionId), `round-${round}-response.json`);
    if (!existsSync(path))
        return null;
    return JSON.parse(readFileSync(path, "utf-8"));
}
/**
 * Persist a snapshot of the plan content as it was at the start of a given
 * round. Used to compute "what changed since the model last saw it" diffs
 * for resumed-session prompts so the reviewer doesn't have to re-load the
 * full plan on round 2+.
 */
export function writeRoundPlanSnapshot(repoRoot, sessionId, round, planContent) {
    const dir = getSessionDir(repoRoot, sessionId);
    writeFileSync(join(dir, `round-${round}-plan.md`), planContent);
}
export function readRoundPlanSnapshot(repoRoot, sessionId, round) {
    const path = join(getSessionDir(repoRoot, sessionId), `round-${round}-plan.md`);
    if (!existsSync(path))
        return null;
    return readFileSync(path, "utf-8");
}
export function writeInitialPlan(repoRoot, sessionId, content) {
    const dir = getSessionDir(repoRoot, sessionId);
    writeFileSync(join(dir, "initial-plan.md"), content);
}
export function readInitialPlan(repoRoot, sessionId) {
    const path = join(getSessionDir(repoRoot, sessionId), "initial-plan.md");
    if (!existsSync(path))
        return null;
    return readFileSync(path, "utf-8");
}
export function writeRoundMetrics(repoRoot, sessionId, round, role, metrics) {
    try {
        const dir = getSessionDir(repoRoot, sessionId);
        writeFileSync(join(dir, `round-${round}-${role}-metrics.json`), JSON.stringify(metrics, null, 2));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
            process.stderr.write(`[planpong] warn: failed to write metrics: ${message}\n`);
        }
        catch {
            // even stderr failed — there's nothing else we can do
        }
    }
}
export function readRoundMetrics(repoRoot, sessionId, round, role) {
    try {
        const path = join(getSessionDir(repoRoot, sessionId), `round-${round}-${role}-metrics.json`);
        if (!existsSync(path))
            return null;
        const parsed = JSON.parse(readFileSync(path, "utf-8"));
        return RoundMetricsSchema.parse(parsed);
    }
    catch {
        return null;
    }
}
export function resolvePlanPath(session) {
    // Try repoRoot + relative path first
    const fromRepo = join(session.repoRoot, session.planPath);
    if (existsSync(dirname(fromRepo)))
        return fromRepo;
    // Fallback to absolute path
    if (existsSync(dirname(session.planPathAbsolute)))
        return session.planPathAbsolute;
    throw new Error(`Cannot resolve plan path. Tried:\n  ${fromRepo}\n  ${session.planPathAbsolute}`);
}
//# sourceMappingURL=session.js.map