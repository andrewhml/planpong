import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFeedbackHandler } from "./get-feedback.js";
import * as operations from "../../core/operations.js";
import type { ReviewRoundResult } from "../../core/operations.js";
import type { DirectionFeedback } from "../../schemas/feedback.js";
import { createSession, writeSessionState } from "../../core/session.js";

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
});
