import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const SESSIONS_DIR = ".planpong/sessions";
function getSessionDir(repoRoot, sessionId) {
    return join(repoRoot, SESSIONS_DIR, sessionId);
}
export function createSession(repoRoot, planPath, planner, reviewer, planHash) {
    const id = randomBytes(6).toString("hex");
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