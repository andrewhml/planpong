/**
 * Behavior goldens for the zod 3 to zod 4 migration
 * (docs/plans/node-22-and-dependency-majors.md, Step 5).
 *
 * The fixture files under __golden__/ were generated on zod 3, in the
 * commit before the upgrade. After the upgrade these tests must pass
 * unchanged. Never regenerate them (`vitest -u`) to make a zod change
 * pass: a diff here is a behavior change to investigate.
 *
 * Failures record the error class and zod issue paths, not messages:
 * zod 4 rewrites default messages and issue codes on purpose, and what
 * must stay stable is which inputs are rejected and where.
 *
 * Not covered here on purpose: session.json. readSessionState
 * (src/core/session.ts) reads it with a raw cast and no zod parse, so the
 * zod version cannot change how it loads.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";
import {
  DirectionFeedbackJsonSchema,
  RiskFeedbackJsonSchema,
  ReviewFeedbackJsonSchema,
  PlannerRevisionJsonSchema,
  getRevisionJsonSchema,
} from "./json-schema.js";
import { RoundMetricsSchema } from "./metrics.js";
import {
  parseFeedbackForPhase,
  parseRevision,
  parseStructuredFeedbackForPhase,
  parseStructuredRevision,
} from "../core/convergence.js";
import { loadConfig } from "../config/loader.js";

type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string; issuePaths?: string[] };

function issuePathsOf(err: unknown): string[] | undefined {
  const zod =
    err instanceof ZodError
      ? err
      : (err as { zodError?: unknown; cause?: unknown })?.zodError instanceof ZodError
        ? ((err as { zodError: ZodError }).zodError)
        : (err as { cause?: unknown })?.cause instanceof ZodError
          ? ((err as { cause: ZodError }).cause)
          : undefined;
  return zod?.issues.map((i) => i.path.join(".") || "(root)").sort();
}

function outcome(fn: () => unknown): Outcome {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    const paths = issuePathsOf(err);
    return {
      ok: false,
      error: (err as Error)?.constructor?.name ?? "Error",
      ...(paths ? { issuePaths: paths } : {}),
    };
  }
}

const snapshot = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

// ---------------------------------------------------------------------------
// JSON Schemas sent to claude --json-schema and codex --output-schema
// ---------------------------------------------------------------------------

describe("JSON Schema golden", () => {
  it("every generated schema is unchanged", async () => {
    const schemas = {
      direction_feedback: DirectionFeedbackJsonSchema,
      risk_feedback: RiskFeedbackJsonSchema,
      detail_feedback: ReviewFeedbackJsonSchema,
      planner_revision: PlannerRevisionJsonSchema,
      revision_direction_full: getRevisionJsonSchema("direction", "full"),
      revision_direction_edits: getRevisionJsonSchema("direction", "edits"),
      revision_risk_full: getRevisionJsonSchema("risk", "full"),
      revision_risk_edits: getRevisionJsonSchema("risk", "edits"),
      revision_detail_full: getRevisionJsonSchema("detail", "full"),
      revision_detail_edits: getRevisionJsonSchema("detail", "edits"),
    };
    await expect(snapshot(schemas)).toMatchFileSnapshot("./__golden__/json-schemas.json");
  });
});

// ---------------------------------------------------------------------------
// Model output through the real parse entry points
// ---------------------------------------------------------------------------

const PLAN = "# Plan\n\n## Steps\n- [ ] Read the version from package.json\n";

const issue = (over: Record<string, unknown> = {}) => ({
  id: "F1",
  severity: "P2",
  section: "Steps",
  title: "t",
  description: "d",
  suggestion: "s",
  quoted_text: "Read the version from package.json",
  ...over,
});

const direction = (over: Record<string, unknown> = {}) => ({
  verdict: "needs_revision",
  summary: "s",
  issues: [issue()],
  confidence: "high",
  approach_assessment: "ok",
  alternatives: [{ approach: "a", tradeoff: "b" }],
  assumptions: ["x"],
  ...over,
});

const risk = (over: Record<string, unknown> = {}) => ({
  verdict: "needs_revision",
  summary: "s",
  issues: [issue()],
  risk_level: "medium",
  risks: [
    {
      id: "R1",
      category: "dependency",
      likelihood: "low",
      impact: "high",
      title: "t",
      description: "d",
      mitigation: "m",
    },
  ],
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  verdict: "needs_revision",
  summary: "s",
  issues: [issue()],
  ...over,
});

const feedbackCases: Array<[string, "direction" | "risk" | "detail", unknown]> = [
  ["direction valid", "direction", direction()],
  ["risk valid", "risk", risk()],
  ["detail valid", "detail", detail()],
  ["detail approved, no issues", "detail", detail({ verdict: "approved", issues: [] })],
  ["detail approved_with_notes + P3 kept", "detail", detail({ verdict: "approved_with_notes", issues: [issue({ severity: "P3" })] })],
  ["detail approved_with_notes + P1 coerced", "detail", detail({ verdict: "approved_with_notes", issues: [issue({ severity: "P1" })] })],
  ["quoted_text null (strict-mode optional)", "detail", detail({ issues: [issue({ quoted_text: null })] })],
  ["quoted_text missing", "detail", detail({ issues: [issue({ quoted_text: undefined })] })],
  ["quoted_text not in plan", "detail", detail({ issues: [issue({ quoted_text: "nowhere in the plan" })] })],
  ["model-supplied verified is stripped", "detail", detail({ issues: [issue({ verified: true, quoted_text: "nowhere" })] })],
  ["unknown top-level key", "detail", { ...detail(), extra: 1 }],
  ["unknown issue key", "detail", detail({ issues: [{ ...issue(), extra: 1 }] })],
  ["bad severity enum", "detail", detail({ issues: [issue({ severity: "P0" })] })],
  ["bad verdict enum", "detail", detail({ verdict: "maybe" })],
  ["missing summary", "detail", { verdict: "needs_revision", issues: [] }],
  ["summary wrong type", "detail", detail({ summary: 5 })],
  ["direction blocked without rationale coerced", "direction", direction({ verdict: "blocked", approach_assessment: "" })],
  ["direction blocked with rationale kept", "direction", direction({ verdict: "blocked" })],
  ["direction missing confidence", "direction", { ...direction(), confidence: undefined }],
  ["direction bad confidence", "direction", direction({ confidence: "certain" })],
  ["risk blocked without risks coerced", "risk", risk({ verdict: "blocked", risks: [] })],
  ["risk bad category", "risk", risk({ risks: [{ ...risk().risks[0], category: "weather" }] })],
  ["observability field unverified_count negative", "detail", detail({ unverified_count: -1 })],
];

describe("feedback parse golden", () => {
  beforeAll(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("structured and prompted outcomes are unchanged", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, phase, payload] of feedbackCases) {
      const json = JSON.stringify(payload);
      results[name] = {
        structured: outcome(() => parseStructuredFeedbackForPhase(json, phase, PLAN)),
        prompted_tagged: outcome(() =>
          parseFeedbackForPhase(`Here is my review.\n<planpong-feedback>${json}</planpong-feedback>`, phase, PLAN),
        ),
        prompted_fenced: outcome(() => parseFeedbackForPhase("```json\n" + json + "\n```", phase, PLAN)),
      };
    }
    results["prompted: no JSON at all"] = {
      detail: outcome(() => parseFeedbackForPhase("I have no structured output", "detail", PLAN)),
    };
    results["structured: invalid JSON"] = {
      detail: outcome(() => parseStructuredFeedbackForPhase("{not json", "detail", PLAN)),
    };
    await expect(snapshot(results)).toMatchFileSnapshot("./__golden__/feedback-parse.json");
  });
});

const response = (over: Record<string, unknown> = {}) => ({
  issue_id: "F1",
  action: "accepted",
  rationale: "r",
  ...over,
});

const revisionCases: Array<[string, "full" | "edits", unknown]> = [
  ["full valid", "full", { responses: [response()], updated_plan: "# Plan\n" }],
  ["full with severity dispute", "full", { responses: [response({ severity_dispute: { original: "P1", revised: "P3", justification: "j" } })], updated_plan: "# P\n" }],
  ["full severity_dispute null (strict-mode optional)", "full", { responses: [response({ severity_dispute: null })], updated_plan: "# P\n" }],
  ["full unknown top-level key (strict object)", "full", { responses: [], updated_plan: "# P\n", extra: 1 }],
  ["full unknown response key", "full", { responses: [{ ...response(), extra: 1 }], updated_plan: "# P\n" }],
  ["full bad action", "full", { responses: [response({ action: "ignored" })], updated_plan: "# P\n" }],
  ["full missing updated_plan", "full", { responses: [] }],
  ["edits valid", "edits", { responses: [response()], edits: [{ section: "Steps", before: "old", after: "new" }] }],
  ["edits empty section", "edits", { responses: [], edits: [{ section: "", before: "old", after: "new" }] }],
  ["edits before too long", "edits", { responses: [], edits: [{ section: "S", before: "x".repeat(2001), after: "y" }] }],
  ["edits with updated_plan too (strict object)", "edits", { responses: [], edits: [], updated_plan: "# P\n" }],
];

describe("revision parse golden", () => {
  it("structured and prompted outcomes are unchanged", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, shape, payload] of revisionCases) {
      const json = JSON.stringify(payload);
      results[name] = {
        structured: outcome(() => parseStructuredRevision(json, shape)),
        prompted: outcome(() => parseRevision(`<planpong-revision>${json}</planpong-revision>`, shape)),
      };
    }
    await expect(snapshot(results)).toMatchFileSnapshot("./__golden__/revision-parse.json");
  });
});

// ---------------------------------------------------------------------------
// Files read from disk through zod: planpong.yaml and round metrics
// ---------------------------------------------------------------------------

const configCases: Array<[string, string]> = [
  ["empty file", ""],
  ["minimal", "planner:\n  provider: claude\n"],
  [
    "every key",
    [
      "planner:",
      "  provider: claude",
      "  model: opus",
      "  effort: high",
      "reviewer:",
      "  provider: codex",
      "  model: gpt-6-astra",
      "  effort: xhigh",
      "plans_dir: docs/plans",
      "max_rounds: 7",
      "human_in_loop: false",
      "revision_mode: edits",
      "planner_mode: external",
      "",
    ].join("\n"),
  ],
  ["unknown top-level key", "max_rounds: 5\nlegacy_option: true\n"],
  ["unknown role key", "reviewer:\n  provider: codex\n  temperature: 0.2\n"],
  ["max_rounds too high", "max_rounds: 99\n"],
  ["max_rounds not an integer", "max_rounds: 2.5\n"],
  ["bad revision_mode", "revision_mode: sometimes\n"],
  ["provider wrong type", "planner:\n  provider: 5\n"],
];

describe("config load golden", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "planpong-zod-golden-"));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("planpong.yaml loads to the same config or fails at the same paths", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, yaml] of configCases) {
      writeFileSync(join(dir, "planpong.yaml"), yaml);
      results[name] = outcome(() => loadConfig({ cwd: dir }));
    }
    await expect(snapshot(results)).toMatchFileSnapshot("./__golden__/config-load.json");
  });
});

const attempt = (over: Record<string, unknown> = {}) => ({
  mode: "structured",
  provider: "codex",
  model: "gpt-6-astra",
  effort: null,
  prompt_chars: 100,
  prompt_lines: 10,
  output_chars: 50,
  output_lines: 5,
  duration_ms: 1000,
  ok: true,
  error_kind: null,
  error_exit_code: null,
  ...over,
});

const metrics = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  session_id: "abc123",
  round: 1,
  phase: "direction",
  role: "review",
  started_at: "2026-09-25T13:12:14.157Z",
  completed_at: "2026-09-25T13:14:22.207Z",
  total_duration_ms: 128050,
  attempts: [attempt()],
  ...over,
});

const metricsCases: Array<[string, unknown]> = [
  ["current file", metrics()],
  ["0.6.x file with legacy mode", metrics({ attempts: [attempt({ mode: "legacy", ok: false, error_kind: "parse" })] })],
  ["inline revision with planner_mode", metrics({ role: "revision", attempts: [], planner_mode: "inline" })],
  ["unknown mode", metrics({ attempts: [attempt({ mode: "telepathic" })] })],
  ["wrong schema_version", metrics({ schema_version: 2 })],
];

describe("round metrics golden", () => {
  it("metrics files parse to the same object or fail at the same paths", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, value] of metricsCases) {
      results[name] = outcome(() => RoundMetricsSchema.parse(value));
    }
    await expect(snapshot(results)).toMatchFileSnapshot("./__golden__/metrics-parse.json");
  });
});
