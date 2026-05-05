import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
import * as sessionModule from "./session.js";
import { RoundMetricsSchema } from "../schemas/metrics.js";
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

  it("structured success: invokes once, parses without prompted fallback", async () => {
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
    // Second call: prompted (no schema, WITH wrapping) — F4 invariant
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
    // Exactly 2 invocations: structured + prompted fallback
    expect(provider.invokeCalls).toHaveLength(2);
  });

  it("provider without structured output support starts in prompted mode immediately", async () => {
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
    // Prompted mode: no schema, wrapping instructions present
    expect(provider.invokeCalls[0].options.jsonSchema).toBeUndefined();
    expect(provider.invokeCalls[0].prompt).toContain("<planpong-feedback>");
    expect(result.feedback.verdict).toBe("needs_revision");
  });

  it("provider invoke is never called more than once per state machine attempt (F7)", async () => {
    // Each scripted response represents exactly one provider invocation.
    // The structured + prompted path uses 2 provider calls, period — no
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

// --- Metrics emission tests ---

describe("Metrics emission via runReviewRound", () => {
  let tmpDir: string;
  let planPath: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-metrics-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
    planPath = join(tmpDir, "docs", "plans", "test-plan.md");
    writeFileSync(planPath, "# Test Plan\n\n**Status:** Draft\n\n## Steps\n- [ ] Do thing\n");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
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

  function readMetricsFile(sessionId: string, round: number, role: "review" | "revision") {
    const path = join(
      tmpDir,
      ".planpong",
      "sessions",
      sessionId,
      `round-${round}-${role}-metrics.json`,
    );
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return RoundMetricsSchema.parse(parsed);
  }

  it("structured success: writes metrics file with one ok attempt and schema_version 1", async () => {
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

    const metrics = readMetricsFile(session.id, 1, "review");
    expect(metrics).not.toBeNull();
    expect(metrics!.schema_version).toBe(1);
    expect(metrics!.session_id).toBe(session.id);
    expect(metrics!.round).toBe(1);
    expect(metrics!.phase).toBe("direction");
    expect(metrics!.role).toBe("review");
    expect(metrics!.attempts).toHaveLength(1);
    expect(metrics!.attempts[0].mode).toBe("structured");
    expect(metrics!.attempts[0].ok).toBe(true);
    expect(metrics!.attempts[0].error_kind).toBeNull();

    // timing propagated in round result
    expect(result.timing).toBeDefined();
    expect(result.timing!.attempts).toBe(1);
    expect(result.timing!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("capability downgrade: writes two attempts, structured fail then prompted ok", async () => {
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

    const metrics = readMetricsFile(session.id, 1, "review");
    expect(metrics!.attempts).toHaveLength(2);
    expect(metrics!.attempts[0].mode).toBe("structured");
    expect(metrics!.attempts[0].ok).toBe(false);
    expect(metrics!.attempts[0].error_kind).toBe("capability");
    expect(metrics!.attempts[0].error_exit_code).toBe(2);
    expect(metrics!.attempts[1].mode).toBe("prompted");
    expect(metrics!.attempts[1].ok).toBe(true);
  });

  it("parse downgrade: first attempt error_kind is 'parse'", async () => {
    const provider = new MockProvider([
      {
        response: { ok: true, output: "not json", duration: 100 },
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

    const metrics = readMetricsFile(session.id, 1, "review");
    expect(metrics!.attempts).toHaveLength(2);
    expect(metrics!.attempts[0].error_kind).toBe("parse");
    expect(metrics!.attempts[1].ok).toBe(true);
  });

  it("zod failure: one attempt with error_kind 'zod', throws without second attempt", async () => {
    const invalidJson = JSON.stringify({
      verdict: "needs_revision",
      summary: "test",
      // missing required direction-phase fields
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

    const metrics = readMetricsFile(session.id, 1, "review");
    expect(metrics!.attempts).toHaveLength(1);
    expect(metrics!.attempts[0].error_kind).toBe("zod");
    expect(provider.invokeCalls).toHaveLength(1);
  });

  it("metrics file is written even when round throws (fatal error)", async () => {
    const provider = new MockProvider([
      {
        response: {
          ok: false,
          error: { kind: "fatal", message: "auth failed", exitCode: 1 },
          duration: 50,
        },
      },
    ]);
    const { session, config } = startSession(provider);
    await expect(runReviewRound(session, tmpDir, config, provider)).rejects.toThrow();

    const metrics = readMetricsFile(session.id, 1, "review");
    expect(metrics).not.toBeNull();
    expect(metrics!.attempts).toHaveLength(1);
    expect(metrics!.attempts[0].error_kind).toBe("fatal");
  });

  it("stderr emits one start line and one end line per attempt", async () => {
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
    await runReviewRound(session, tmpDir, config, provider);

    const lines = stderrSpy.mock.calls.map((c) => String(c[0]));
    const startLines = lines.filter((l) =>
      /^\[planpong\] R1 review .*prompt=\d+c\s*$/m.test(l),
    );
    const endLines = lines.filter((l) =>
      /^\[planpong\] R1 review .*\| ok\s*$/m.test(l),
    );
    expect(startLines).toHaveLength(1);
    expect(endLines).toHaveLength(1);
  });
});

// --- Fail-open metrics I/O ---

describe("writeRoundMetrics / readRoundMetrics fail-open behavior", () => {
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-metrics-io-"));
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writeRoundMetrics does not throw when target directory is missing", () => {
    const metrics = {
      schema_version: 1 as const,
      session_id: "does-not-exist",
      round: 1,
      phase: "direction" as const,
      role: "review" as const,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      total_duration_ms: 100,
      attempts: [],
    };
    expect(() =>
      sessionModule.writeRoundMetrics(tmpDir, "does-not-exist", 1, "review", metrics),
    ).not.toThrow();
    const warn = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .some((s) => s.includes("[planpong] warn: failed to write metrics"));
    expect(warn).toBe(true);
  });

  it("readRoundMetrics returns null for missing files", () => {
    expect(
      sessionModule.readRoundMetrics(tmpDir, "nope", 1, "review"),
    ).toBeNull();
  });

  it("readRoundMetrics returns null for corrupt JSON", () => {
    const sessionId = "corrupt-session";
    const dir = join(tmpDir, ".planpong", "sessions", sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "round-1-review-metrics.json"), "{ not valid json");
    expect(
      sessionModule.readRoundMetrics(tmpDir, sessionId, 1, "review"),
    ).toBeNull();
  });

  it("readRoundMetrics returns null for schema-mismatched content", () => {
    const sessionId = "mismatch-session";
    const dir = join(tmpDir, ".planpong", "sessions", sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "round-1-review-metrics.json"),
      JSON.stringify({ unexpected: "shape" }),
    );
    expect(
      sessionModule.readRoundMetrics(tmpDir, sessionId, 1, "review"),
    ).toBeNull();
  });
});

// --- finalizeRevision shared helper ---

describe("finalizeRevision", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-finalize-"));
    mkdirSync(join(tmpDir, "docs", "plans"), { recursive: true });
    planPath = join(tmpDir, "docs", "plans", "plan.md");
    writeFileSync(planPath, "# Plan\n\nbody\n");
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists response, updates plan hash, writes session state", async () => {
    const ops = await import("./operations.js");
    const session = sessionModule.createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      "stale-hash",
    );
    session.status = "in_review";
    session.currentRound = 1;
    sessionModule.writeSessionState(tmpDir, session);

    const revision = {
      responses: [
        { issue_id: "F1", action: "accepted" as const, rationale: "ok" },
        { issue_id: "F2", action: "rejected" as const, rationale: "no" },
        { issue_id: "F3", action: "deferred" as const, rationale: "later" },
      ],
      updated_plan: "# Plan\n\nbody\n",
    };

    const result = ops.finalizeRevision({
      session,
      cwd: tmpDir,
      round: 1,
      revision,
      planPath,
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.deferred).toBe(1);
    expect(result.fresh).toBe(true);

    // Response file persisted.
    const responsePath = join(
      tmpDir,
      ".planpong/sessions",
      session.id,
      "round-1-response.json",
    );
    expect(existsSync(responsePath)).toBe(true);

    // Plan hash updated from the stale seed.
    const reread = sessionModule.readSessionState(tmpDir, session.id);
    expect(reread?.planHash).not.toBe("stale-hash");
    expect(reread?.planHash).toBe(ops.hashFile(planPath));
  });

  it("does NOT advance currentRound", async () => {
    const ops = await import("./operations.js");
    const session = sessionModule.createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      ops.hashFile(planPath),
    );
    session.status = "in_review";
    session.currentRound = 3;
    sessionModule.writeSessionState(tmpDir, session);

    ops.finalizeRevision({
      session,
      cwd: tmpDir,
      round: 3,
      revision: {
        responses: [
          { issue_id: "F1", action: "accepted" as const, rationale: "ok" },
        ],
        updated_plan: "# Plan\n\nbody\n",
      },
      planPath,
    });

    // Still 3. Advancement is the caller's responsibility (get-feedback.ts
    // for MCP, loop.ts for CLI). Moving advancement here would
    // double-advance in the MCP path.
    expect(session.currentRound).toBe(3);
    const reread = sessionModule.readSessionState(tmpDir, session.id);
    expect(reread?.currentRound).toBe(3);
  });

  it("is idempotent on duplicate calls (matching responses)", async () => {
    const ops = await import("./operations.js");
    const session = sessionModule.createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      ops.hashFile(planPath),
    );
    session.status = "in_review";
    session.currentRound = 1;
    sessionModule.writeSessionState(tmpDir, session);

    const revision = {
      responses: [
        { issue_id: "F1", action: "accepted" as const, rationale: "ok" },
      ],
      updated_plan: "# Plan\n\nbody\n",
    };

    const first = ops.finalizeRevision({
      session,
      cwd: tmpDir,
      round: 1,
      revision,
      planPath,
    });
    expect(first.fresh).toBe(true);

    const second = ops.finalizeRevision({
      session,
      cwd: tmpDir,
      round: 1,
      revision,
      planPath,
    });
    // Detected the existing response file; returned the existing tally
    // without re-writing artifacts. Tallies still consistent.
    expect(second.fresh).toBe(false);
    expect(second.accepted).toBe(1);
  });
});
