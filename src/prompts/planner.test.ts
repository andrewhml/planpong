import { describe, it, expect } from "vitest";
import { buildRevisionPrompt } from "./planner.js";
import type { ReviewFeedback } from "../schemas/feedback.js";

const plan = "# Plan\n\n## Steps\n- Step 1";
const feedback: ReviewFeedback = {
  verdict: "needs_revision",
  summary: "needs work",
  issues: [
    {
      id: "F1",
      severity: "P2",
      section: "Steps",
      title: "Missing step",
      description: "Step 2 is missing",
      suggestion: "Add Step 2",
    },
  ],
};

describe("buildRevisionPrompt structuredOutput flag", () => {
  it("includes wrapping instructions when structuredOutput is false (prompted)", () => {
    const prompt = buildRevisionPrompt(plan, feedback, null, null, "detail", false);
    expect(prompt).toContain("<planpong-revision>");
    expect(prompt).toContain("</planpong-revision>");
    expect(prompt).toContain("Wrap your JSON response");
  });

  it("omits wrapping instructions when structuredOutput is true", () => {
    const prompt = buildRevisionPrompt(plan, feedback, null, null, "detail", true);
    expect(prompt).not.toContain("<planpong-revision>");
    expect(prompt).not.toContain("</planpong-revision>");
    expect(prompt).not.toContain("Wrap your JSON response");
  });

  it("structured mode still includes the schema, plan, and feedback", () => {
    const prompt = buildRevisionPrompt(plan, feedback, null, null, "detail", true);
    expect(prompt).toContain("Output ONLY a single JSON object");
    expect(prompt).toContain("updated_plan");
    expect(prompt).toContain("Step 2 is missing");
  });

  it("structured mode uses emphatic JSON-only language for advisory providers", () => {
    const prompt = buildRevisionPrompt(plan, feedback, null, null, "detail", true);
    expect(prompt).toContain("Output ONLY a single JSON object");
    expect(prompt).toContain("No prose");
    expect(prompt).toContain("No markdown");
    expect(prompt).toContain("No code fences");
    expect(prompt).toMatch(/first character.*must be `\{`/);
  });

  it("defaults to prompted mode (structuredOutput=false) when omitted", () => {
    const prompt = buildRevisionPrompt(plan, feedback, null, null, "detail");
    expect(prompt).toContain("<planpong-revision>");
  });

  it("includes the surgical constraint based on phase", () => {
    const directionPrompt = buildRevisionPrompt(plan, feedback, null, null, "direction", true);
    expect(directionPrompt).toContain("structural changes");
    const detailPrompt = buildRevisionPrompt(plan, feedback, null, null, "detail", true);
    expect(detailPrompt).toContain("Only modify sections");
  });
});
