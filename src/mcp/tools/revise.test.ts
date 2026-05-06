import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviseHandler } from "./revise.js";
import * as operations from "../../core/operations.js";
import type { RevisionRoundResult } from "../../core/operations.js";
import {
  createSession,
  readSessionState,
  writeRoundFeedback,
  writeRoundResponse,
  writeSessionState,
} from "../../core/session.js";
import type { ReviewFeedback } from "../../schemas/feedback.js";

function makeRevisionResult(opts: {
  timing?: { duration_ms: number; attempts: number };
}): RevisionRoundResult {
  return {
    round: 1,
    revision: {
      responses: [],
      updated_plan:
        "# Plan\n\n**Status:** Draft\n**planpong:** R1/10 | claude → codex | x\n\n## Steps\n- [ ] x\n",
    },
    accepted: 0,
    rejected: 0,
    deferred: 0,
    planUpdated: true,
    timing: opts.timing,
  };
}

function makeFeedback(): ReviewFeedback {
  return {
    verdict: "needs_revision",
    summary: "needs work",
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

function parseResponseJson(result: Awaited<ReturnType<typeof reviseHandler>>) {
  const jsonBlock = result.content[1];
  if (jsonBlock.type !== "text") throw new Error("expected text block");
  return JSON.parse(jsonBlock.text);
}

describe("reviseHandler timing response contract", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-revise-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
    planPath = join(tmpDir, "docs", "plans", "plan.md");
    writeFileSync(
      planPath,
      "# Plan\n\n**Status:** Draft\n**planpong:** R1/10 | claude → codex | x\n\n## Steps\n- [ ] x\n",
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
      "external",
    );
    session.status = "in_review";
    session.currentRound = 1;
    session.initialLineCount = 7;
    writeSessionState(tmpDir, session);
    writeRoundFeedback(tmpDir, session.id, 1, makeFeedback());
    return session.id;
  }

  it("includes timing in response when present in revision result", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(
      makeRevisionResult({ timing: { duration_ms: 67890, attempts: 1 } }),
    );

    const result = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(payload.timing).toEqual({ duration_ms: 67890, attempts: 1 });
  });

  it("omits timing from response when absent in revision result", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(
      makeRevisionResult({ timing: undefined }),
    );

    const result = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect("timing" in payload).toBe(false);
  });

  it("counts rejections with rationale matching 'unverified evidence' into unverified_rejected", async () => {
    const sessionId = seedSession();
    const result: RevisionRoundResult = {
      round: 1,
      revision: {
        responses: [
          {
            issue_id: "F1",
            action: "rejected",
            rationale: "unverified evidence — quote not in plan",
          },
          {
            issue_id: "F2",
            action: "rejected",
            rationale: "Unverified Evidence (case-insensitive)",
          },
          {
            issue_id: "F3",
            action: "rejected",
            rationale: "actual disagreement with the suggestion",
          },
          { issue_id: "F4", action: "accepted", rationale: "good catch" },
        ],
        updated_plan:
          "# Plan\n\n**Status:** Draft\n**planpong:** R1/10 | claude → codex | x\n\n## Steps\n- [ ] x\n",
      },
      accepted: 1,
      rejected: 3,
      deferred: 0,
      planUpdated: true,
    };
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(result);

    const handlerResult = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(handlerResult);

    expect(payload.unverified_rejected).toBe(2);
  });

  it("reports unverified_rejected=0 when no rationale matches", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(
      makeRevisionResult({ timing: undefined }),
    );

    const result = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(payload.unverified_rejected).toBe(0);
  });

  it("includes decision display rows from current feedback", async () => {
    const sessionId = seedSession();
    const result: RevisionRoundResult = {
      round: 1,
      revision: {
        responses: [
          { issue_id: "F1", action: "accepted", rationale: "added tests" },
          { issue_id: "F2", action: "deferred", rationale: "needs input" },
        ],
        updated_plan:
          "# Plan\n\n**Status:** Draft\n**planpong:** R1/10 | claude → codex | x\n\n## Steps\n- [ ] x\n",
      },
      accepted: 1,
      rejected: 0,
      deferred: 1,
      planUpdated: true,
    };
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(result);

    const handlerResult = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(handlerResult);

    expect(payload.decision_rows).toHaveLength(2);
    expect(payload.decision_rows[0]).toMatchObject({
      issue_id: "F1",
      severity: "P2",
      title: "Missing verification",
      decision: "accepted",
      rationale: "added tests",
    });
    expect(payload.display_markdown).toContain("Round 1 - Planner decisions");
    expect(payload.display_markdown).toContain("| F2 | P3 | Clarify rollback | Deferred | needs input |");
  });

  it("returns isError + route hint when session is in inline planner mode", async () => {
    // Don't go through createSession so we can flip plannerMode without
    // touching its default arg. Mirror what the inline-mode flow looks like.
    const session = createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      "hash",
      "inline",
    );
    session.status = "in_review";
    session.currentRound = 1;
    writeSessionState(tmpDir, session);

    const result = await reviseHandler({
      session_id: session.id,
      expected_round: 1,
      cwd: tmpDir,
    });

    expect(result.isError).toBe(true);
    const errorBlock = result.content[0];
    if (errorBlock.type !== "text") throw new Error("expected text block");
    const payload = JSON.parse(errorBlock.text);
    expect(payload.error).toMatch(/inline planner mode/);
    expect(payload.error).toMatch(/planpong_record_revision/);
    expect(payload.planner_mode).toBe("inline");
  });

  it("replays existing response without invoking planner", async () => {
    const sessionId = seedSession();
    writeRoundResponse(tmpDir, sessionId, 1, {
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "fixed" },
        { issue_id: "F2", action: "rejected", rationale: "no" },
      ],
      updated_plan: "# Plan\n",
    });
    const reviseSpy = vi.spyOn(operations, "runRevisionRound");

    const result = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    const payload = parseResponseJson(result);

    expect(reviseSpy).not.toHaveBeenCalled();
    expect(payload.idempotent_replay).toBe(true);
    expect(payload.accepted).toBe(1);
    expect(payload.rejected).toBe(1);
    expect(payload.decision_rows).toHaveLength(2);
  });

  it("rejects stale and out-of-order expected_round values", async () => {
    const sessionId = seedSession();
    const session = readSessionState(tmpDir, sessionId);
    if (!session) throw new Error("missing session");
    session.currentRound = 2;
    writeSessionState(tmpDir, session);

    const stale = await reviseHandler({
      session_id: sessionId,
      expected_round: 1,
      cwd: tmpDir,
    });
    expect(stale.isError).toBe(true);
    expect(JSON.parse(stale.content[0].text).error).toMatch(/stale/);

    const outOfOrder = await reviseHandler({
      session_id: sessionId,
      expected_round: 3,
      cwd: tmpDir,
    });
    expect(outOfOrder.isError).toBe(true);
    expect(JSON.parse(outOfOrder.content[0].text).error).toMatch(
      /out-of-order/,
    );
  });
});
