import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Session } from "../schemas/session.js";
import type { ReviewFeedback, PhaseFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";
import type { ProviderConfig } from "../schemas/config.js";
import {
  RoundMetricsSchema,
  type RoundMetrics,
} from "../schemas/metrics.js";

const SESSIONS_DIR = ".planpong/sessions";
const SESSION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_LOCK_RETRY_MS = 25;

function getSessionDir(repoRoot: string, sessionId: string): string {
  return join(repoRoot, SESSIONS_DIR, sessionId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSession(
  repoRoot: string,
  planPath: string,
  planner: ProviderConfig,
  reviewer: ProviderConfig,
  planHash: string,
  plannerMode: "inline" | "external" = "inline",
): Session {
  const id = randomBytes(6).toString("hex");
  // Pre-generate a UUID for reviewer-session continuity. Used directly by
  // claude (which accepts external UUIDs); for codex this is a placeholder
  // that gets overwritten after the first invocation with the captured
  // thread_id from codex's --json event stream.
  const reviewerSessionId = randomUUID();
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
    reviewerSessionId,
    plannerMode,
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

export async function withSessionLock<T>(
  repoRoot: string,
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = getSessionDir(repoRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, "lock");
  const started = Date.now();
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          acquired_at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "EEXIST") throw error;

      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > SESSION_LOCK_TIMEOUT_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() - started > SESSION_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for session lock: ${sessionId}`);
      }
      await sleep(SESSION_LOCK_RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      // ignore close failures; unlock still attempted below
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // stale/missing lock cleanup is best-effort
    }
  }
}

export function readSessionState(
  repoRoot: string,
  sessionId: string,
): Session | null {
  const path = join(getSessionDir(repoRoot, sessionId), "session.json");
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Session;
  // Backward-compat normalization for sessions written before plannerMode
  // existed. The Zod schema's .default() only fires under SessionSchema.parse(),
  // which we deliberately skip here for performance. Old sessions that
  // omit this field are treated as external — preserves prior behavior.
  if (parsed.plannerMode === undefined) {
    parsed.plannerMode = "external";
  }
  return parsed;
}

export function writeRoundFeedback(
  repoRoot: string,
  sessionId: string,
  round: number,
  feedback: PhaseFeedback,
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
): PhaseFeedback | null {
  const path = join(
    getSessionDir(repoRoot, sessionId),
    `round-${round}-feedback.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as PhaseFeedback;
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

/**
 * Persist a snapshot of the plan content as it was at the start of a given
 * round. Used to compute "what changed since the model last saw it" diffs
 * for resumed-session prompts so the reviewer doesn't have to re-load the
 * full plan on round 2+.
 */
export function writeRoundPlanSnapshot(
  repoRoot: string,
  sessionId: string,
  round: number,
  planContent: string,
): void {
  const dir = getSessionDir(repoRoot, sessionId);
  writeFileSync(join(dir, `round-${round}-plan.md`), planContent);
}

export function readRoundPlanSnapshot(
  repoRoot: string,
  sessionId: string,
  round: number,
): string | null {
  const path = join(
    getSessionDir(repoRoot, sessionId),
    `round-${round}-plan.md`,
  );
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function writeInitialPlan(
  repoRoot: string,
  sessionId: string,
  content: string,
): void {
  const dir = getSessionDir(repoRoot, sessionId);
  writeFileSync(join(dir, "initial-plan.md"), content);
}

export function readInitialPlan(
  repoRoot: string,
  sessionId: string,
): string | null {
  const path = join(getSessionDir(repoRoot, sessionId), "initial-plan.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function writeRoundMetrics(
  repoRoot: string,
  sessionId: string,
  round: number,
  role: "review" | "revision",
  metrics: RoundMetrics,
): void {
  try {
    const dir = getSessionDir(repoRoot, sessionId);
    writeFileSync(
      join(dir, `round-${round}-${role}-metrics.json`),
      JSON.stringify(metrics, null, 2),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    try {
      process.stderr.write(
        `[planpong] warn: failed to write metrics: ${message}\n`,
      );
    } catch {
      // even stderr failed — there's nothing else we can do
    }
  }
}

export function readRoundMetrics(
  repoRoot: string,
  sessionId: string,
  round: number,
  role: "review" | "revision",
): RoundMetrics | null {
  try {
    const path = join(
      getSessionDir(repoRoot, sessionId),
      `round-${round}-${role}-metrics.json`,
    );
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return RoundMetricsSchema.parse(parsed);
  } catch {
    return null;
  }
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
