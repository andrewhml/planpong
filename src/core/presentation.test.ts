import { describe, expect, it } from "vitest";
import {
  buildDecisionRows,
  formatDecisionDisplay,
  formatFeedbackDisplay,
} from "./presentation.js";
import type { ReviewFeedback } from "../schemas/feedback.js";
import type { PlannerRevision } from "../schemas/revision.js";

function feedback(): ReviewFeedback {
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
        verified: true,
      },
      {
        id: "F2",
        severity: "P3",
        section: "Risks",
        title: "Pipe | newline\nissue",
        description: "x",
        suggestion: "y",
        verified: false,
      },
    ],
  };
}

describe("presentation helpers", () => {
  it("formats feedback with pending planner decisions", () => {
    const result = formatFeedbackDisplay({
      round: 1,
      phase: "direction",
      verdict: "needs_revision",
      severity: { P1: 0, P2: 1, P3: 1 },
      feedback: feedback(),
      phaseSignal: "confidence: high",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.decision).toBe("pending");
    expect(result.markdown).toContain("Round 1 - Direction - Needs Revision");
    expect(result.markdown).toContain("confidence: high");
    expect(result.markdown).toContain("| F1 | P2 | Steps | Missing verification | Pending |");
    expect(result.markdown).toContain("Pipe \\| newline issue");
  });

  it("formats decisions by joining feedback issues to revision responses", () => {
    const revision: PlannerRevision = {
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "added tests" },
        { issue_id: "F2", action: "deferred", rationale: "needs user input" },
      ],
      updated_plan: "# Plan",
    };

    const result = formatDecisionDisplay({
      round: 1,
      feedback: feedback(),
      revision,
    });

    expect(result.rows.map((row) => row.decision)).toEqual([
      "accepted",
      "deferred",
    ]);
    expect(result.markdown).toContain("| F1 | P2 | Missing verification | Accepted | added tests |");
    expect(result.markdown).toContain("| F2 | P3 | Pipe \\| newline issue | Deferred | needs user input |");
  });

  it("reports missing and unmatched responses", () => {
    const revision: PlannerRevision = {
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "fixed" },
        { issue_id: "F9", action: "rejected", rationale: "unknown" },
      ],
      updated_plan: "# Plan",
    };

    const result = buildDecisionRows(feedback(), revision);

    expect(result.rows[1]?.decision).toBe("missing");
    expect(result.warnings).toContain("Unmatched response issue IDs: F9");
    expect(result.warnings).toContain("Missing response for issue F2");
  });

  it("truncates long rationales in markdown while preserving row data", () => {
    const long = "a".repeat(180);
    const revision: PlannerRevision = {
      responses: [
        { issue_id: "F1", action: "accepted", rationale: long },
        { issue_id: "F2", action: "rejected", rationale: "no" },
      ],
      updated_plan: "# Plan",
    };

    const result = formatDecisionDisplay({
      round: 2,
      feedback: feedback(),
      revision,
    });

    expect(result.rows[0]?.rationale).toBe(long);
    expect(result.markdown).toContain(`${"a".repeat(137)}...`);
    expect(result.markdown).not.toContain(long);
  });
});
