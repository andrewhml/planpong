import { describe, it, expect } from "vitest";
import { getReviewPhase, buildReviewPrompt, formatPriorDecisions } from "./reviewer.js";

// --- getReviewPhase ---

describe("getReviewPhase", () => {
  it("returns 'direction' for round 1", () => {
    expect(getReviewPhase(1)).toBe("direction");
  });

  it("returns 'risk' for round 2", () => {
    expect(getReviewPhase(2)).toBe("risk");
  });

  it("returns 'detail' for round 3", () => {
    expect(getReviewPhase(3)).toBe("detail");
  });

  it("returns 'detail' for rounds beyond 3", () => {
    expect(getReviewPhase(4)).toBe("detail");
    expect(getReviewPhase(10)).toBe("detail");
  });
});

// --- buildReviewPrompt ---

describe("buildReviewPrompt", () => {
  const plan = "# Plan\n\n## Steps\n- Step 1";

  it("uses direction instructions for direction phase", () => {
    const prompt = buildReviewPrompt(plan, null, "direction");
    expect(prompt).toContain("HIGH LEVEL");
    expect(prompt).toContain("Problem framing");
    expect(prompt).not.toContain("PRE-MORTEM");
    expect(prompt).not.toContain("adversarial but fair");
  });

  it("uses risk instructions for risk phase", () => {
    const prompt = buildReviewPrompt(plan, null, "risk");
    expect(prompt).toContain("PRE-MORTEM");
    expect(prompt).toContain("Failure modes");
    expect(prompt).not.toContain("HIGH LEVEL");
  });

  it("uses detail instructions for detail phase", () => {
    const prompt = buildReviewPrompt(plan, null, "detail");
    expect(prompt).toContain("adversarial but fair");
    expect(prompt).not.toContain("HIGH LEVEL");
    expect(prompt).not.toContain("PRE-MORTEM");
  });

  it("defaults to detail phase", () => {
    const prompt = buildReviewPrompt(plan, null);
    expect(prompt).toContain("adversarial but fair");
  });

  it("includes prior decisions in risk phase", () => {
    const priorDecisions = "- R1 F1 (P2): Some issue → ACCEPTED (fixed it)";
    const prompt = buildReviewPrompt(plan, priorDecisions, "risk");
    expect(prompt).toContain("Prior Round Decisions");
    expect(prompt).toContain("ACCEPTED");
  });

  it("includes prior decisions in detail phase", () => {
    const priorDecisions = "- R2 F1 (P1): Risk → REJECTED (not applicable)";
    const prompt = buildReviewPrompt(plan, priorDecisions, "detail");
    expect(prompt).toContain("Prior Round Decisions");
    expect(prompt).toContain("REJECTED");
  });

  it("always includes the plan content", () => {
    const prompt = buildReviewPrompt(plan, null, "direction");
    expect(prompt).toContain("# Plan");
    expect(prompt).toContain("Step 1");
  });

  it("always includes output format instructions", () => {
    const prompt = buildReviewPrompt(plan, null, "direction");
    expect(prompt).toContain("planpong-feedback");
    expect(prompt).toContain("needs_revision");
  });
});

// --- formatPriorDecisions ---

describe("formatPriorDecisions", () => {
  it("formats multiple rounds of decisions", () => {
    const rounds = [
      {
        round: 1,
        responses: [
          { issue_id: "F1", action: "accepted" as const, rationale: "Good point" },
          { issue_id: "F2", action: "rejected" as const, rationale: "Not applicable" },
        ],
        issues: [
          { id: "F1", severity: "P1", title: "Critical bug" },
          { id: "F2", severity: "P3", title: "Minor style" },
        ],
      },
    ];
    const result = formatPriorDecisions(rounds);
    expect(result).toContain("R1 F1 (P1): Critical bug → ACCEPTED");
    expect(result).toContain("R1 F2 (P3): Minor style → REJECTED");
  });

  it("truncates long rationales", () => {
    const longRationale = "x".repeat(100);
    const rounds = [
      {
        round: 1,
        responses: [{ issue_id: "F1", action: "accepted" as const, rationale: longRationale }],
        issues: [{ id: "F1", severity: "P2", title: "Issue" }],
      },
    ];
    const result = formatPriorDecisions(rounds);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(200);
  });
});
