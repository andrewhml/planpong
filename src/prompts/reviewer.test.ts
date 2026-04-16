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

// --- buildReviewPrompt structured output ---

describe("buildReviewPrompt structuredOutput flag", () => {
  const plan = "# Plan\n\n## Steps\n- Step 1";

  it("includes wrapping instructions when structuredOutput is false (legacy)", () => {
    const prompt = buildReviewPrompt(plan, null, "detail", false);
    expect(prompt).toContain("<planpong-feedback>");
    expect(prompt).toContain("</planpong-feedback>");
    expect(prompt).toContain("Wrap your JSON response");
  });

  it("omits wrapping instructions when structuredOutput is true", () => {
    const prompt = buildReviewPrompt(plan, null, "detail", true);
    expect(prompt).not.toContain("<planpong-feedback>");
    expect(prompt).not.toContain("</planpong-feedback>");
    expect(prompt).not.toContain("Wrap your JSON response");
  });

  it("structured mode still includes the schema and instructions", () => {
    const prompt = buildReviewPrompt(plan, null, "direction", true);
    expect(prompt).toContain("Output ONLY a single JSON object");
    expect(prompt).toContain("verdict");
    expect(prompt).toContain("approach_assessment");
  });

  it("structured mode uses emphatic JSON-only language for advisory providers", () => {
    const prompt = buildReviewPrompt(plan, null, "detail", true);
    expect(prompt).toContain("Output ONLY a single JSON object");
    expect(prompt).toContain("No prose");
    expect(prompt).toContain("No markdown");
    expect(prompt).toContain("No code fences");
    expect(prompt).toMatch(/first character.*must be `\{`/);
  });

  it("defaults to legacy mode (structuredOutput=false) when omitted", () => {
    const prompt = buildReviewPrompt(plan, null, "detail");
    expect(prompt).toContain("<planpong-feedback>");
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

  // Phase-specific JSON schema tests
  it("includes direction-specific JSON schema fields in direction phase", () => {
    const prompt = buildReviewPrompt(plan, null, "direction");
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"approach_assessment"');
    expect(prompt).toContain('"alternatives"');
    expect(prompt).toContain('"assumptions"');
    // Should not include risk-specific fields
    expect(prompt).not.toContain('"risk_level"');
    expect(prompt).not.toContain('"risks"');
  });

  it("includes risk-specific JSON schema fields in risk phase", () => {
    const prompt = buildReviewPrompt(plan, null, "risk");
    expect(prompt).toContain('"risk_level"');
    expect(prompt).toContain('"risks"');
    expect(prompt).toContain('"category"');
    expect(prompt).toContain('"likelihood"');
    expect(prompt).toContain('"impact"');
    expect(prompt).toContain('"mitigation"');
    // Should not include direction-specific fields
    expect(prompt).not.toContain('"confidence"');
    expect(prompt).not.toContain('"approach_assessment"');
  });

  it("includes standard JSON schema for detail phase", () => {
    const prompt = buildReviewPrompt(plan, null, "detail");
    expect(prompt).toContain('"approved"');
    expect(prompt).toContain('"approved_with_notes"');
    // Should not include phase-specific fields
    expect(prompt).not.toContain('"confidence"');
    expect(prompt).not.toContain('"risk_level"');
  });

  // Blocked verdict guidance
  it("includes blocked verdict guidance in direction phase", () => {
    const prompt = buildReviewPrompt(plan, null, "direction");
    expect(prompt).toContain("blocked");
    expect(prompt).toContain("fundamentally non-viable");
    expect(prompt).toContain("CANNOT approve");
  });

  it("includes blocked verdict guidance in risk phase", () => {
    const prompt = buildReviewPrompt(plan, null, "risk");
    expect(prompt).toContain("blocked");
    expect(prompt).toContain("unmitigable");
    expect(prompt).toContain("CANNOT approve");
  });

  it("does not include blocked verdict in detail phase", () => {
    const prompt = buildReviewPrompt(plan, null, "detail");
    expect(prompt).not.toContain('"blocked"');
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
