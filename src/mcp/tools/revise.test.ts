import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviseHandler } from "./revise.js";
import * as operations from "../../core/operations.js";
import type { RevisionRoundResult } from "../../core/operations.js";
import { createSession, writeSessionState } from "../../core/session.js";

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
    );
    session.status = "in_review";
    session.currentRound = 1;
    session.initialLineCount = 7;
    writeSessionState(tmpDir, session);
    return session.id;
  }

  it("includes timing in response when present in revision result", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(
      makeRevisionResult({ timing: { duration_ms: 67890, attempts: 1 } }),
    );

    const result = await reviseHandler({ session_id: sessionId, cwd: tmpDir });
    const payload = parseResponseJson(result);

    expect(payload.timing).toEqual({ duration_ms: 67890, attempts: 1 });
  });

  it("omits timing from response when absent in revision result", async () => {
    const sessionId = seedSession();
    vi.spyOn(operations, "runRevisionRound").mockResolvedValue(
      makeRevisionResult({ timing: undefined }),
    );

    const result = await reviseHandler({ session_id: sessionId, cwd: tmpDir });
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

    const result = await reviseHandler({ session_id: sessionId, cwd: tmpDir });
    const payload = parseResponseJson(result);

    expect(payload.unverified_rejected).toBe(0);
  });
});
