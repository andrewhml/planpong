import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop, runReviewLoop, type LoopCallbacks } from "./loop.js";
import { buildStatusLine } from "./operations.js";
import { readSessionState } from "./session.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { PlanpongConfig } from "../schemas/config.js";
import type { Provider, ProviderResponse } from "../providers/types.js";

// Both CLI paths run the planner provider themselves. With DEFAULT_CONFIG
// (planner_mode: inline) they must still record and label the session as
// external. Each test stops the loop at onPlanGenerated, right after the
// session and initial status line are written.
class StopAfterInit extends Error {}

function stubProvider(name: string, output = ""): Provider {
  return {
    name,
    invoke: async (): Promise<ProviderResponse> => ({ ok: true, output, duration: 1 }),
    isAvailable: async () => true,
    getModels: () => [],
    getEffortLevels: () => [],
    getModelCatalog: async () => ({ source: "static", models: [], efforts: [], allEfforts: [], advisories: {} }),
    checkStructuredOutputSupport: async () => false,
    markNonCapable: () => {},
  };
}

function callbacks(capture: (planPath: string) => void): LoopCallbacks {
  const noop = async () => {};
  return {
    onPlanGenerated: async (planPath) => {
      capture(planPath);
      throw new StopAfterInit();
    },
    onReviewStarting: () => {},
    onReviewComplete: noop,
    onRevisionStarting: () => {},
    onRevisionComplete: noop,
    onConverged: () => {},
    onMaxRoundsReached: () => {},
    onHashMismatch: async () => "abort",
    confirmContinue: async () => false,
  };
}

function sessionIdFromPlan(tmpDir: string): string {
  return readdirSync(join(tmpDir, ".planpong", "sessions"))[0];
}

describe("CLI loops record external planner mode", () => {
  let tmpDir: string;
  const config: PlanpongConfig = {
    ...DEFAULT_CONFIG,
    planner: { provider: "claude", model: "opus" },
    reviewer: { provider: "codex" },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-loop-test-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("planpong review: DEFAULT_CONFIG still persists external and labels the planner", async () => {
    expect(DEFAULT_CONFIG.planner_mode).toBe("inline");
    const planPath = join(tmpDir, "docs", "plans", "p.md");
    writeFileSync(planPath, "# P\n\n**Status:** Draft\n");
    let captured = "";
    await expect(
      runReviewLoop({
        planPath,
        cwd: tmpDir,
        config,
        plannerProvider: stubProvider("claude"),
        reviewerProvider: stubProvider("codex"),
        callbacks: callbacks((p) => (captured = p)),
      }),
    ).rejects.toBeInstanceOf(StopAfterInit);

    expect(readFileSync(captured, "utf-8")).toContain("claude(opus) → codex | Awaiting review");
    const session = readSessionState(tmpDir, sessionIdFromPlan(tmpDir))!;
    expect(session.plannerMode).toBe("external");
    session.currentRound = 1;
    expect(buildStatusLine(session, config, [], 0, 0, 0, 0, 0, 0)).toContain("claude(opus) → codex");
  });

  it("planpong plan: DEFAULT_CONFIG still persists external and labels the planner", async () => {
    let captured = "";
    await expect(
      runLoop({
        requirements: "do a thing",
        cwd: tmpDir,
        config,
        plannerProvider: stubProvider("claude", "# Generated\n\n**Status:** Draft\n"),
        reviewerProvider: stubProvider("codex"),
        planName: "gen",
        callbacks: callbacks((p) => (captured = p)),
      }),
    ).rejects.toBeInstanceOf(StopAfterInit);

    expect(readFileSync(captured, "utf-8")).toContain("claude(opus) → codex | Awaiting review");
    const session = readSessionState(tmpDir, sessionIdFromPlan(tmpDir))!;
    expect(session.plannerMode).toBe("external");
    session.currentRound = 1;
    expect(buildStatusLine(session, config, [], 0, 0, 0, 0, 0, 0)).toContain("claude(opus) → codex");
  });
});
