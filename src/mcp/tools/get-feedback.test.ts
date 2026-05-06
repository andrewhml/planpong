import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFeedbackHandler } from "./get-feedback.js";
import * as operations from "../../core/operations.js";
import type { ReviewRoundResult } from "../../core/operations.js";
import type { DirectionFeedback } from "../../schemas/feedback.js";
import {
  createSession,
  readSessionState,
  writeRoundFeedback,
  writeRoundResponse,
  writeSessionState,
} from "../../core/session.js";

function makeFeedback(): DirectionFeedback {
  return {
    verdict: "needs_revision",
    summary: "test",
    issues: [],
    confidence: "high",
    approach_assessment: "ok",
    alternatives: [],
    assumptions: [],
  };
}

function makeFeedbackWithIssues(): DirectionFeedback {
  return {
    ...makeFeedback(),
    issues: [
      {
        id: "F1",
        severity: "P2",
        section: "Steps",
        title: "Missing verification",
        description: "x",
        suggestion: "y",
      },
      {
        id: "F2",
        severity: "P3",
        section: "Risks",
        title: "Clarify rollback",
        description: "x",
        suggestion: "y",
      },
    ],
  };
}

function makeReviewResult(opts: {
  timing?: { duration_ms: number; attempts: number };
}): ReviewRoundResult {
  return {
    round: 1,
    feedback: makeFeedback(),
    severity: { P1: 0, P2: 0, P3: 0 },
    converged: false,
    phaseExtras: { confidence: "high" },
    timing: opts.timing,
  };
}

function parseResponseJson(result: Awaited<ReturnType<typeof getFeedbackHandler>>) {
  const jsonBlock = result.content[1];
  if (jsonBlock.type !== "text") throw new Error("expected text block");
  return JSON.parse(jsonBlock.text);
}

describe("getFeedbackHandler timing response contract", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-getfb-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
    planPath = join(tmpDir, "docs", "plans", "plan.md");
    writeFileSync(
      planPath,
      "# Plan\n\n**Status:** Draft\n\n## Steps\n- [ ] x\n",
    );
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedSession(): string {
    const session = createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      "hash",
    );
    session.status = "in_review";
    session.currentRound = 0;
    session.initialLineCount = 6;
    writeSessionState(tmpDir, session);
    return session.id;
  }

  it("includes timing in response when present in round result", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runReviewRound").mockResolvedValue(
      makeReviewResult({ timing: { duration_ms: 12345, attempts: 2 } }),
    );

    const result = await getFeedbackHandler({ session_id: sessionId, cwd: tmpDir });
    const payload = parseResponseJson(result);

    expect(payload.timing).toEqual({ duration_ms: 12345, attempts: 2 });
  });

  it("omits timing from response when absent in round result", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runReviewRound").mockResolvedValue(
      makeReviewResult({ timing: undefined }),
    );

    const result = await getFeedbackHandler({ session_id: sessionId, cwd: tmpDir });
    const payload = parseResponseJson(result);

    expect("timing" in payload).toBe(false);
  });

  it("surfaces unverified_count when set on feedback", async () => {
    const sessionId = seedSession();
    const fb = makeFeedback();
    fb.unverified_count = 2;
    vi.spyOn(operations, "runReviewRound").mockResolvedValue({
      round: 1,
      feedback: fb,
      severity: { P1: 0, P2: 0, P3: 0 },
      converged: false,
      phaseExtras: { confidence: "high" },
    });

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(payload.unverified_count).toBe(2);
  });

  it("surfaces quote_compliance_warning when true on feedback", async () => {
    const sessionId = seedSession();
    const fb = makeFeedback();
    fb.quote_compliance_warning = true;
    fb.unverified_count = 0;
    vi.spyOn(operations, "runReviewRound").mockResolvedValue({
      round: 1,
      feedback: fb,
      severity: { P1: 0, P2: 0, P3: 0 },
      converged: false,
      phaseExtras: { confidence: "high" },
    });

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(payload.quote_compliance_warning).toBe(true);
  });

  it("omits quote_compliance_warning when feedback flag is unset/false", async () => {
    const sessionId = seedSession();
    const fb = makeFeedback();
    fb.quote_compliance_warning = false;
    vi.spyOn(operations, "runReviewRound").mockResolvedValue({
      round: 1,
      feedback: fb,
      severity: { P1: 0, P2: 0, P3: 0 },
      converged: false,
      phaseExtras: { confidence: "high" },
    });

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect("quote_compliance_warning" in payload).toBe(false);
  });

  it("includes display_markdown and pending issue rows", async () => {
    const sessionId = seedSession();
    const fb = makeFeedbackWithIssues();
    vi.spyOn(operations, "runReviewRound").mockResolvedValue({
      round: 1,
      feedback: fb,
      severity: { P1: 0, P2: 1, P3: 1 },
      converged: false,
      phaseExtras: { confidence: "high" },
    });

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(payload.issue_rows).toHaveLength(2);
    expect(payload.issue_rows[0]).toMatchObject({
      issue_id: "F1",
      severity: "P2",
      section: "Steps",
      title: "Missing verification",
      decision: "pending",
    });
    expect(payload.display_markdown).toContain("Round 1 - Direction - Needs Revision");
    expect(payload.display_markdown).toContain("| F1 | P2 | Steps | Missing verification | Pending |");
    expect(payload.display_markdown).toContain("confidence: high");
  });

  it("replays existing feedback without invoking reviewer", async () => {
    const sessionId = seedSession();
    const session = readSessionState(tmpDir, sessionId);
    if (!session) throw new Error("missing session");
    session.currentRound = 1;
    writeSessionState(tmpDir, session);
    writeRoundFeedback(tmpDir, sessionId, 1, makeFeedbackWithIssues());
    const reviewSpy = vi.spyOn(operations, "runReviewRound");

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(payload.round).toBe(1);
    expect(payload.idempotent_replay).toBe(true);
    expect(payload.issue_rows).toHaveLength(2);
  });

  it("retries same round when current round has no feedback artifact", async () => {
    const sessionId = seedSession();
    const session = readSessionState(tmpDir, sessionId);
    if (!session) throw new Error("missing session");
    session.currentRound = 1;
    writeSessionState(tmpDir, session);
    vi.spyOn(operations, "runReviewRound").mockResolvedValue(
      makeReviewResult({ timing: undefined }),
    );

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);
    const updated = readSessionState(tmpDir, sessionId);

    expect(payload.round).toBe(1);
    expect(payload.resumed_incomplete_round).toBe(true);
    expect(updated?.currentRound).toBe(1);
  });

  it("advances when current round already has feedback and response", async () => {
    const sessionId = seedSession();
    const session = readSessionState(tmpDir, sessionId);
    if (!session) throw new Error("missing session");
    session.currentRound = 1;
    writeSessionState(tmpDir, session);
    writeRoundFeedback(tmpDir, sessionId, 1, makeFeedback());
    writeRoundResponse(tmpDir, sessionId, 1, {
      responses: [],
      updated_plan: "# Plan\n",
    });
    vi.spyOn(operations, "runReviewRound").mockResolvedValue({
      ...makeReviewResult({ timing: undefined }),
      round: 2,
    });

    const result = await getFeedbackHandler({
      session_id: sessionId,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);
    const updated = readSessionState(tmpDir, sessionId);

    expect(payload.round).toBe(2);
    expect(updated?.currentRound).toBe(2);
  });
});
