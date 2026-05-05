import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, writeRoundFeedback, writeRoundResponse, writeSessionState } from "./session.js";
import { getRoundState } from "./round-state.js";
import type { ReviewFeedback } from "../schemas/feedback.js";

function feedback(): ReviewFeedback {
  return {
    verdict: "needs_revision",
    summary: "needs work",
    issues: [],
  };
}

describe("getRoundState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-round-state-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "plans", "plan.md"), "# Plan\n");
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function seed(round: number) {
    const session = createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      "hash",
    );
    session.status = "in_review";
    session.currentRound = round;
    writeSessionState(tmpDir, session);
    return session;
  }

  it("starts at get_feedback for round zero", () => {
    const session = seed(0);
    const state = getRoundState(tmpDir, session);
    expect(state.nextAction).toBe("get_feedback");
    expect(state.incompleteTransition).toBe(false);
  });

  it("reports incomplete transition when current round has no artifacts", () => {
    const session = seed(2);
    const state = getRoundState(tmpDir, session);
    expect(state.nextAction).toBe("get_feedback");
    expect(state.incompleteTransition).toBe(true);
  });

  it("reports revision as next action when feedback exists without response", () => {
    const session = seed(1);
    writeRoundFeedback(tmpDir, session.id, 1, feedback());
    const state = getRoundState(tmpDir, session);
    expect(state.hasFeedback).toBe(true);
    expect(state.hasResponse).toBe(false);
    expect(state.nextAction).toBe("revise");
  });

  it("reports next round when feedback and response exist", () => {
    const session = seed(1);
    writeRoundFeedback(tmpDir, session.id, 1, feedback());
    writeRoundResponse(tmpDir, session.id, 1, {
      responses: [],
      updated_plan: "# Plan\n",
    });
    const state = getRoundState(tmpDir, session, 10);
    expect(state.nextAction).toBe("next_round");
  });

  it("reports terminal when max rounds reached", () => {
    const session = seed(2);
    writeRoundFeedback(tmpDir, session.id, 2, feedback());
    writeRoundResponse(tmpDir, session.id, 2, {
      responses: [],
      updated_plan: "# Plan\n",
    });
    const state = getRoundState(tmpDir, session, 2);
    expect(state.nextAction).toBe("terminal");
  });

  it("detects response without feedback as inconsistent", () => {
    const session = seed(1);
    writeRoundResponse(tmpDir, session.id, 1, {
      responses: [],
      updated_plan: "# Plan\n",
    });
    const state = getRoundState(tmpDir, session);
    expect(state.inconsistentArtifacts).toBe(true);
    expect(state.nextAction).toBe("terminal");
  });
});
