import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordRevisionHandler } from "./record-revision.js";
import {
  createSession,
  writeSessionState,
  writeRoundFeedback,
} from "../../core/session.js";
import { hashFile } from "../../core/operations.js";
import { RoundMetricsSchema } from "../../schemas/metrics.js";
import type { ReviewFeedback } from "../../schemas/feedback.js";

function parseResponseJson(
  result: Awaited<ReturnType<typeof recordRevisionHandler>>,
) {
  // Success path returns 2 content blocks: status_line + JSON; error path
  // returns 1 (the JSON error). Handle both.
  const block = result.isError ? result.content[0] : result.content[1];
  if (!block || block.type !== "text") {
    throw new Error("expected text block");
  }
  return JSON.parse(block.text);
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
        title: "fix this",
        description: "the plan is missing X",
        suggestion: "add X",
      },
      {
        id: "F2",
        severity: "P3",
        section: "Notes",
        title: "minor thing",
        description: "consider Y",
        suggestion: "mention Y",
      },
    ],
  };
}

describe("recordRevisionHandler", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-record-rev-"));
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

  function seedSession(opts: {
    plannerMode?: "inline" | "external";
    currentRound?: number;
    feedback?: ReviewFeedback | null;
  } = {}): string {
    // Seed planHash with the real file hash so finalizeRevision's hashFile
    // produces an unchanged value when the test doesn't actually edit the
    // plan. Without this the warn-on-no-op test would see a hash "change"
    // from the fake string to the real hash, masking the no-op condition.
    const session = createSession(
      tmpDir,
      "docs/plans/plan.md",
      { provider: "claude" },
      { provider: "codex" },
      hashFile(planPath),
      opts.plannerMode ?? "inline",
    );
    session.status = "in_review";
    session.currentRound = opts.currentRound ?? 1;
    session.initialLineCount = 7;
    writeSessionState(tmpDir, session);
    if (opts.feedback !== null) {
      writeRoundFeedback(
        tmpDir,
        session.id,
        session.currentRound,
        opts.feedback ?? makeFeedback(),
      );
    }
    return session.id;
  }

  it("records responses, finalizes the round, and returns tally", async () => {
    const sessionId = seedSession();
    const result = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "valid concern" },
        { issue_id: "F2", action: "deferred", rationale: "out of scope" },
      ],
      cwd: tmpDir,
    });

    const payload = parseResponseJson(result);
    expect(payload.round).toBe(1);
    expect(payload.accepted).toBe(1);
    expect(payload.deferred).toBe(1);
    expect(payload.rejected).toBe(0);
    expect(payload.planner_mode).toBe("inline");

    // Response file written.
    const responseFile = join(
      tmpDir,
      ".planpong/sessions",
      sessionId,
      "round-1-response.json",
    );
    expect(existsSync(responseFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(responseFile, "utf-8"));
    expect(persisted.responses).toHaveLength(2);
  });

  it("rejects when planner_mode is external", async () => {
    const sessionId = seedSession({ plannerMode: "external" });
    const result = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "x" },
        { issue_id: "F2", action: "accepted", rationale: "x" },
      ],
      cwd: tmpDir,
    });
    expect(result.isError).toBe(true);
    expect(parseResponseJson(result).error).toMatch(/external planner mode/);
  });

  it("rejects when expected_round mismatches session.currentRound", async () => {
    const sessionId = seedSession({ currentRound: 2 });
    const result = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "x" },
        { issue_id: "F2", action: "accepted", rationale: "x" },
      ],
      cwd: tmpDir,
    });
    expect(result.isError).toBe(true);
    const err = parseResponseJson(result);
    expect(err.error).toMatch(/already finalized/);
    expect(err.expected_round).toBe(1);
    expect(err.current_round).toBe(2);
  });

  it("rejects when a feedback issue has no matching response", async () => {
    const sessionId = seedSession();
    const result = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "x" },
        // F2 missing
      ],
      cwd: tmpDir,
    });
    expect(result.isError).toBe(true);
    const err = parseResponseJson(result);
    expect(err.error).toMatch(/missing for issue\(s\): F2/);
    expect(err.missing_issue_ids).toEqual(["F2"]);
  });

  it("writes a fully valid RoundMetrics file (passes RoundMetricsSchema.parse)", async () => {
    const sessionId = seedSession();
    await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        { issue_id: "F1", action: "rejected", rationale: "no" },
        { issue_id: "F2", action: "rejected", rationale: "no" },
      ],
      cwd: tmpDir,
    });

    const metricsFile = join(
      tmpDir,
      ".planpong/sessions",
      sessionId,
      "round-1-revision-metrics.json",
    );
    expect(existsSync(metricsFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(metricsFile, "utf-8"));
    // The authoritative test: the metrics file must round-trip through the
    // schema bench/run.ts uses to consume metrics. If it doesn't, the inline
    // round is silently dropped from analysis.
    const validated = RoundMetricsSchema.parse(parsed);
    expect(validated.schema_version).toBe(1);
    expect(validated.session_id).toBe(sessionId);
    expect(validated.round).toBe(1);
    expect(validated.role).toBe("revision");
    expect(validated.phase).toBe("direction");
    expect(validated.attempts).toEqual([]);
    expect(validated.total_duration_ms).toBe(0);
    expect(validated.planner_mode).toBe("inline");
    expect(validated.started_at).toBeTruthy();
    expect(validated.completed_at).toBeTruthy();
  });

  it("counts unverified_rejected from rationale", async () => {
    const sessionId = seedSession();
    const result = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        {
          issue_id: "F1",
          action: "rejected",
          rationale: "Unverified evidence — quote not in plan",
        },
        { issue_id: "F2", action: "accepted", rationale: "fixed" },
      ],
      cwd: tmpDir,
    });
    expect(parseResponseJson(result).unverified_rejected).toBe(1);
  });

  it("warns when accepted issues exist but plan hash is unchanged", async () => {
    const sessionId = seedSession();
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "x" },
        { issue_id: "F2", action: "rejected", rationale: "x" },
      ],
      cwd: tmpDir,
    });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("plan hash is unchanged"),
    );
  });

  it("is idempotent on duplicate calls with identical responses", async () => {
    const sessionId = seedSession();
    const responses = [
      { issue_id: "F1", action: "accepted" as const, rationale: "x" },
      { issue_id: "F2", action: "accepted" as const, rationale: "x" },
    ];

    const first = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses,
      cwd: tmpDir,
    });
    expect(parseResponseJson(first).idempotent_replay).toBe(false);

    const second = await recordRevisionHandler({
      session_id: sessionId,
      expected_round: 1,
      responses,
      cwd: tmpDir,
    });
    const secondPayload = parseResponseJson(second);
    expect(secondPayload.idempotent_replay).toBe(true);
    expect(secondPayload.accepted).toBe(2);
  });
});
