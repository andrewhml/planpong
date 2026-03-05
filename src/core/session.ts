import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Session } from "../schemas/session.js";
import type { ReviewFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import type { ProviderConfig } from "../schemas/config.js";

const SESSIONS_DIR = ".planpong/sessions";

function getSessionDir(repoRoot: string, sessionId: string): string {
  return join(repoRoot, SESSIONS_DIR, sessionId);
}

export function createSession(
  repoRoot: string,
  planPath: string,
  planner: ProviderConfig,
  reviewer: ProviderConfig,
  planHash: string,
): Session {
  const id = randomBytes(6).toString("hex");
  const session: Session = {
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

export function writeSessionState(repoRoot: string, session: Session): void {
  const dir = getSessionDir(repoRoot, session.id);
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
}

export function readSessionState(
  repoRoot: string,
  sessionId: string,
): Session | null {
  const path = join(getSessionDir(repoRoot, sessionId), "session.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as Session;
}

export function writeRoundFeedback(
  repoRoot: string,
  sessionId: string,
  round: number,
  feedback: ReviewFeedback,
): void {
  const dir = getSessionDir(repoRoot, sessionId);
  writeFileSync(
    join(dir, `round-${round}-feedback.json`),
    JSON.stringify(feedback, null, 2),
  );
}

export function writeRoundResponse(
  repoRoot: string,
  sessionId: string,
  round: number,
  response: PlannerRevision,
): void {
  const dir = getSessionDir(repoRoot, sessionId);
  writeFileSync(
    join(dir, `round-${round}-response.json`),
    JSON.stringify(response, null, 2),
  );
}

export function readRoundFeedback(
  repoRoot: string,
  sessionId: string,
  round: number,
): ReviewFeedback | null {
  const path = join(
    getSessionDir(repoRoot, sessionId),
    `round-${round}-feedback.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as ReviewFeedback;
}

export function readRoundResponse(
  repoRoot: string,
  sessionId: string,
  round: number,
): PlannerRevision | null {
  const path = join(
    getSessionDir(repoRoot, sessionId),
    `round-${round}-response.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as PlannerRevision;
}

export function resolvePlanPath(session: Session): string {
  // Try repoRoot + relative path first
  const fromRepo = join(session.repoRoot, session.planPath);
  if (existsSync(dirname(fromRepo))) return fromRepo;

  // Fallback to absolute path
  if (existsSync(dirname(session.planPathAbsolute)))
    return session.planPathAbsolute;

  throw new Error(
    `Cannot resolve plan path. Tried:\n  ${fromRepo}\n  ${session.planPathAbsolute}`,
  );
}
