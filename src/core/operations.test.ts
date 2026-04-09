import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  severityFromFeedback,
  formatRoundSeverity,
  formatTrajectory,
  formatTallies,
  formatDuration,
  formatProviderLabel,
  updatePlanStatusLine,
  initReviewSession,
  runReviewRound,
  type RoundSeverity,
} from "./operations.js";
import type { ReviewFeedback } from "../schemas/feedback.js";
import type {
  Provider,
  InvokeOptions,
  ProviderResponse,
} from "../providers/types.js";
import type { PlanpongConfig } from "../schemas/config.js";

// --- severityFromFeedback ---

describe("severityFromFeedback", () => {
  it("counts severity levels correctly", () => {
    const feedback: ReviewFeedback = {
      verdict: "needs_revision",
      summary: "Issues found",
      issues: [
        { id: "F1", severity: "P1", section: "s", title: "t", description: "d", suggestion: "s" },
        { id: "F2", severity: "P1", section: "s", title: "t", description: "d", suggestion: "s" },
        { id: "F3", severity: "P2", section: "s", title: "t", description: "d", suggestion: "s" },
        { id: "F4", severity: "P3", section: "s", title: "t", description: "d", suggestion: "s" },
      ],
    };
    const result = severityFromFeedback(feedback);
    expect(result).toEqual({ P1: 2, P2: 1, P3: 1 });
  });

  it("returns zeros for empty issues", () => {
    const feedback: ReviewFeedback = {
      verdict: "approved",
      summary: "Good",
      issues: [],
    };
    expect(severityFromFeedback(feedback)).toEqual({ P1: 0, P2: 0, P3: 0 });
  });
});

// --- formatRoundSeverity ---

describe("formatRoundSeverity", () => {
  it("formats all severity levels", () => {
    expect(formatRoundSeverity({ P1: 2, P2: 1, P3: 3 })).toBe("2P1 1P2 3P3");
  });

  it("omits zero counts", () => {
    expect(formatRoundSeverity({ P1: 0, P2: 1, P3: 0 })).toBe("1P2");
  });

  it("returns '0' when all counts are zero", () => {
    expect(formatRoundSeverity({ P1: 0, P2: 0, P3: 0 })).toBe("0");
  });
});

// --- formatTrajectory ---

describe("formatTrajectory", () => {
  it("joins multiple rounds with arrow separator", () => {
    const trajectory: RoundSeverity[] = [
      { P1: 2, P2: 1, P3: 0 },
      { P1: 0, P2: 1, P3: 1 },
      { P1: 0, P2: 0, P3: 0 },
    ];
    expect(formatTrajectory(trajectory)).toBe("2P1 1P2 → 1P2 1P3 → 0");
  });

  it("handles single round", () => {
    expect(formatTrajectory([{ P1: 1, P2: 0, P3: 0 }])).toBe("1P1");
  });

  it("handles empty trajectory", () => {
    expect(formatTrajectory([])).toBe("");
  });
});

// --- formatTallies ---

describe("formatTallies", () => {
  it("formats all tallies", () => {
    expect(formatTallies(3, 1, 2)).toBe("Accepted: 3 | Rejected: 1 | Deferred: 2");
  });

  it("omits zero tallies", () => {
    expect(formatTallies(3, 0, 0)).toBe("Accepted: 3");
  });

  it("returns empty string when all zero", () => {
    expect(formatTallies(0, 0, 0)).toBe("");
  });
});

// --- formatDuration ---

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("handles exact minutes", () => {
    expect(formatDuration(120000)).toBe("2m 0s");
  });
});

// --- formatProviderLabel ---

describe("formatProviderLabel", () => {
  it("returns provider name when no model or effort", () => {
    expect(formatProviderLabel({ provider: "claude" })).toBe("claude");
  });

  it("returns provider name when model and effort are 'default'", () => {
    expect(formatProviderLabel({ provider: "claude", model: "default", effort: "default" })).toBe(
      "claude",
    );
  });

  it("includes model when specified", () => {
    expect(formatProviderLabel({ provider: "claude", model: "opus" })).toBe("claude(opus)");
  });

  it("includes effort when specified", () => {
    expect(formatProviderLabel({ provider: "codex", effort: "high" })).toBe("codex(high)");
  });

  it("includes both model and effort", () => {
    expect(formatProviderLabel({ provider: "claude", model: "sonnet", effort: "high" })).toBe(
      "claude(sonnet/high)",
    );
  });
});

// --- updatePlanStatusLine ---

describe("updatePlanStatusLine", () => {
  it("replaces existing planpong status line", () => {
    const plan = "# Plan\n\n**planpong:** R1/10 | old status\n\n## Steps\n- Step 1";
    const result = updatePlanStatusLine(plan, "**planpong:** R2/10 | new status");
    expect(result).toContain("**planpong:** R2/10 | new status");
    expect(result).not.toContain("old status");
  });

  it("inserts after Status line if no planpong line exists", () => {
    const plan = "# Plan\n\n**Status:** Draft\n\n## Steps";
    const result = updatePlanStatusLine(plan, "**planpong:** R0/10 | init");
    const lines = result.split("\n");
    const statusIdx = lines.findIndex((l) => l.startsWith("**Status:**"));
    expect(lines[statusIdx + 1]).toBe("**planpong:** R0/10 | init");
  });

  it("inserts after title if no Status or planpong line exists", () => {
    const plan = "# My Plan\n\n## Steps\n- Step 1";
    const result = updatePlanStatusLine(plan, "**planpong:** R0/10 | init");
    const lines = result.split("\n");
    expect(lines[0]).toBe("# My Plan");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("**planpong:** R0/10 | init");
  });
});

// --- Invocation state machine tests ---

interface ScriptedResponse {
  response: ProviderResponse;
  expectStructured?: boolean;
}

class MockProvider implements Provider {
  name = "mock";
  invokeCalls: Array<{ prompt: string; options: InvokeOptions }> = [];
  capabilityCache: boolean = true;
  markedNonCapable = false;

  constructor(
    private responses: ScriptedResponse[],
    private supportsStructured: boolean = true,
  ) {}

  async invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse> {
    this.invokeCalls.push({ prompt, options });
    const next = this.responses.shift();
    if (!next) {
      throw new Error(`MockProvider ran out of scripted responses (call #${this.invokeCalls.length})`);
    }
    return next.response;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getModels(): string[] {
    return [];
  }

  getEffortLevels(): string[] {
    return ["default"];
  }

  async checkStructuredOutputSupport(): Promise<boolean> {
    return this.supportsStructured && this.capabilityCache;
  }

  markNonCapable(): void {
    this.markedNonCapable = true;
    this.capabilityCache = false;
  }
}

function makeConfig(): PlanpongConfig {
  return {
    planner: { provider: "mock" },
    reviewer: { provider: "mock" },
    plans_dir: "docs/plans",
    max_rounds: 10,
    human_in_loop: false,
  };
}

function makeFeedbackJson(verdict: string, opts: Partial<{ confidence: string; approach_assessment: string }> = {}) {
  return JSON.stringify({
    verdict,
    summary: "test summary",
    issues: [],
    confidence: opts.confidence ?? "high",
    approach_assessment: opts.approach_assessment ?? "looks reasonable",
    alternatives: [],
    assumptions: [],
  });
}

describe("Invocation state machine via runReviewRound", () => {
  let tmpDir: string;
  let planPath: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-test-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
    planPath = join(tmpDir, "docs", "plans", "test-plan.md");
    writeFileSync(planPath, "# Test Plan\n\n**Status:** Draft\n\n## Steps\n- [ ] Do thing\n");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function startSession(provider: MockProvider) {
    const config = makeConfig();
    const init = initReviewSession(planPath, tmpDir, config);
    init.session.currentRound = 1;
    return { session: init.session, config, provider };
  }

  it("structured success: invokes once, parses without legacy fallback", async () => {
    const provider = new MockProvider([
      {
        response: {
          ok: true,
          output: makeFeedbackJson("needs_revision"),
          duration: 100,
        },
      },
    ]);
    const { session, config } = startSession(provider);
    const result = await runReviewRound(session, tmpDir, config, provider);

    expect(provider.invokeCalls).toHaveLength(1);
    expect(provider.invokeCalls[0].options.jsonSchema).toBeDefined();
    // Structured prompt has no wrapping instructions
    expect(provider.invokeCalls[0].prompt).not.toContain("<planpong-feedback>");
    expect(result.feedback.verdict).toBe("needs_revision");
    expect(provider.markedNonCapable).toBe(false);
  });

  it("provider capability error triggers downgrade with prompt regeneration (F4, F9)", async () => {
    const provider = new MockProvider([
      {
        response: {
          ok: false,
          error: {
            kind: "capability",
            message: "unknown flag --json-schema",
            exitCode: 2,
          },
          duration: 50,
        },
      },
      {
        response: {
          ok: true,
          output: `<planpong-feedback>${makeFeedbackJson("needs_revision")}</planpong-feedback>`,
          duration: 100,
        },
      },
    ]);
    const { session, config } = startSession(provider);
    const result = await runReviewRound(session, tmpDir, config, provider);

    expect(provider.invokeCalls).toHaveLength(2);
    expect(provider.markedNonCapable).toBe(true);
    // First call: structured (with schema, no wrapping)
    expect(provider.invokeCalls[0].options.jsonSchema).toBeDefined();
    expect(provider.invokeCalls[0].prompt).not.toContain("<planpong-feedback>");
    // Second call: legacy (no schema, WITH wrapping) — F4 invariant
    expect(provider.invokeCalls[1].options.jsonSchema).toBeUndefined();
    expect(provider.invokeCalls[1].prompt).toContain("<planpong-feedback>");
    expect(result.feedback.verdict).toBe("needs_revision");
  });

  it("provider fatal error is terminal — no downgrade attempted (F9)", async () => {
    const provider = new MockProvider([
      {
        response: {
          ok: false,
          error: {
            kind: "fatal",
            message: "auth refresh failed",
            exitCode: 1,
          },
          duration: 50,
        },
      },
    ]);
    const { session, config } = startSession(provider);
    await expect(runReviewRound(session, tmpDir, config, provider)).rejects.toThrow(
      /fatal/,
    );
    expect(provider.invokeCalls).toHaveLength(1);
    expect(provider.markedNonCapable).toBe(false);
  });

  it("JSON parse failure on structured output triggers downgrade (F3)", async () => {
    const provider = new MockProvider([
      {
        response: {
          ok: true,
          output: "this is not valid json",
          duration: 100,
        },
      },
      {
        response: {
          ok: true,
          output: `<planpong-feedback>${makeFeedbackJson("needs_revision")}</planpong-feedback>`,
          duration: 100,
        },
      },
    ]);
    const { session, config } = startSession(provider);
    const result = await runReviewRound(session, tmpDir, config, provider);

    expect(provider.invokeCalls).toHaveLength(2);
    expect(provider.markedNonCapable).toBe(true);
    expect(result.feedback.verdict).toBe("needs_revision");
  });

  it("Zod validation failure on structured output is terminal — no retry (F2)", async () => {
    // Direction phase requires confidence/approach_assessment/etc. Send a
    // structurally invalid payload to trigger Zod failure (not JSON.parse).
    const invalidJson = JSON.stringify({
      verdict: "needs_revision",
      summary: "test",
      // missing: issues, confidence, approach_assessment, alternatives, assumptions
    });
    const provider = new MockProvider([
      {
        response: { ok: true, output: invalidJson, duration: 100 },
      },
    ]);
    const { session, config } = startSession(provider);
    await expect(runReviewRound(session, tmpDir, config, provider)).rejects.toThrow(
      /Zod validation/,
    );
    expect(provider.invokeCalls).toHaveLength(1);
  });

  it("max 2 invocations enforced (F3)", async () => {
    // Both attempts fail
    const provider = new MockProvider([
      {
        response: { ok: true, output: "garbage1", duration: 100 },
      },
      {
        response: { ok: true, output: "garbage2", duration: 100 },
      },
    ]);
    const { session, config } = startSession(provider);
    await expect(runReviewRound(session, tmpDir, config, provider)).rejects.toThrow();
    // Exactly 2 invocations: structured + legacy fallback
    expect(provider.invokeCalls).toHaveLength(2);
  });

  it("provider without structured output support starts in legacy mode immediately", async () => {
    const provider = new MockProvider(
      [
        {
          response: {
            ok: true,
            output: `<planpong-feedback>${makeFeedbackJson("needs_revision")}</planpong-feedback>`,
            duration: 100,
          },
        },
      ],
      false, // does not support structured
    );
    const { session, config } = startSession(provider);
    const result = await runReviewRound(session, tmpDir, config, provider);

    expect(provider.invokeCalls).toHaveLength(1);
    // Legacy mode: no schema, wrapping instructions present
    expect(provider.invokeCalls[0].options.jsonSchema).toBeUndefined();
    expect(provider.invokeCalls[0].prompt).toContain("<planpong-feedback>");
    expect(result.feedback.verdict).toBe("needs_revision");
  });

  it("provider invoke is never called more than once per state machine attempt (F7)", async () => {
    // Each scripted response represents exactly one provider invocation.
    // The structured + legacy path uses 2 provider calls, period — no
    // hidden internal retries.
    const provider = new MockProvider([
      {
        response: {
          ok: false,
          error: { kind: "capability", message: "unknown flag", exitCode: 2 },
          duration: 50,
        },
      },
      {
        response: {
          ok: true,
          output: `<planpong-feedback>${makeFeedbackJson("needs_revision")}</planpong-feedback>`,
          duration: 100,
        },
      },
    ]);
    const { session, config } = startSession(provider);
    await runReviewRound(session, tmpDir, config, provider);
    // 2 attempts = 2 invocations, no more
    expect(provider.invokeCalls).toHaveLength(2);
  });
});
