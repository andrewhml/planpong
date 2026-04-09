import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import {
  DirectionFeedbackJsonSchema,
  RiskFeedbackJsonSchema,
  ReviewFeedbackJsonSchema,
  PlannerRevisionJsonSchema,
  getFeedbackJsonSchemaForPhase,
} from "./json-schema.js";
import {
  DirectionFeedbackSchema,
  RiskFeedbackSchema,
  ReviewFeedbackSchema,
} from "./feedback.js";
import { PlannerRevisionSchema } from "./revision.js";

const ajv = new Ajv({ strict: false, allErrors: true });

describe("JSON Schema generation", () => {
  it("generates a JSON Schema for DirectionFeedback", () => {
    expect(DirectionFeedbackJsonSchema).toBeDefined();
    expect(DirectionFeedbackJsonSchema.type).toBe("object");
  });

  it("generates a JSON Schema for RiskFeedback", () => {
    expect(RiskFeedbackJsonSchema).toBeDefined();
    expect(RiskFeedbackJsonSchema.type).toBe("object");
  });

  it("generates a JSON Schema for ReviewFeedback", () => {
    expect(ReviewFeedbackJsonSchema).toBeDefined();
    expect(ReviewFeedbackJsonSchema.type).toBe("object");
  });

  it("generates a JSON Schema for PlannerRevision", () => {
    expect(PlannerRevisionJsonSchema).toBeDefined();
    expect(PlannerRevisionJsonSchema.type).toBe("object");
  });

  it("returns the right schema per phase", () => {
    expect(getFeedbackJsonSchemaForPhase("direction")).toBe(DirectionFeedbackJsonSchema);
    expect(getFeedbackJsonSchemaForPhase("risk")).toBe(RiskFeedbackJsonSchema);
    expect(getFeedbackJsonSchemaForPhase("detail")).toBe(ReviewFeedbackJsonSchema);
  });
});

describe("Contract tests — JSON Schema and Zod agree on structural subset", () => {
  it("DirectionFeedback: valid payload passes both", () => {
    const payload = {
      verdict: "needs_revision",
      summary: "test",
      issues: [],
      confidence: "high",
      approach_assessment: "looks good",
      alternatives: [],
      assumptions: [],
    };
    const validate = ajv.compile(DirectionFeedbackJsonSchema);
    expect(validate(payload)).toBe(true);
    expect(() => DirectionFeedbackSchema.parse(payload)).not.toThrow();
  });

  it("DirectionFeedback: missing required field fails both", () => {
    const payload = {
      verdict: "needs_revision",
      summary: "test",
      issues: [],
      // missing: confidence, approach_assessment, alternatives, assumptions
    };
    const validate = ajv.compile(DirectionFeedbackJsonSchema);
    expect(validate(payload)).toBe(false);
    expect(() => DirectionFeedbackSchema.parse(payload)).toThrow();
  });

  it("RiskFeedback: valid payload passes both", () => {
    const payload = {
      verdict: "needs_revision",
      summary: "test",
      issues: [],
      risk_level: "low",
      risks: [],
    };
    const validate = ajv.compile(RiskFeedbackJsonSchema);
    expect(validate(payload)).toBe(true);
    expect(() => RiskFeedbackSchema.parse(payload)).not.toThrow();
  });

  it("ReviewFeedback: valid payload passes both", () => {
    const payload = {
      verdict: "approved",
      summary: "test",
      issues: [],
    };
    const validate = ajv.compile(ReviewFeedbackJsonSchema);
    expect(validate(payload)).toBe(true);
    expect(() => ReviewFeedbackSchema.parse(payload)).not.toThrow();
  });

  it("ReviewFeedback: refinement violation passes JSON Schema but fails Zod (documented divergence)", () => {
    // approved_with_notes requires all issues to be P3 — this is a Zod refinement
    // that does not round-trip to JSON Schema
    const payload = {
      verdict: "approved_with_notes",
      summary: "test",
      issues: [
        {
          id: "F1",
          severity: "P1",
          section: "test",
          title: "test",
          description: "test",
          suggestion: "test",
        },
      ],
    };
    const validate = ajv.compile(ReviewFeedbackJsonSchema);
    // JSON Schema accepts it (refinement not representable)
    expect(validate(payload)).toBe(true);
    // Zod rejects it (refinement enforced post-parse)
    expect(() => ReviewFeedbackSchema.parse(payload)).toThrow();
  });

  it("PlannerRevision: valid payload passes both", () => {
    const payload = {
      responses: [
        {
          issue_id: "F1",
          action: "accepted",
          rationale: "good catch",
        },
      ],
      updated_plan: "# Plan\n\nUpdated content",
    };
    const validate = ajv.compile(PlannerRevisionJsonSchema);
    expect(validate(payload)).toBe(true);
    expect(() => PlannerRevisionSchema.parse(payload)).not.toThrow();
  });

  it("PlannerRevision: updated_plan with code fences and special characters roundtrips", () => {
    const payload = {
      responses: [],
      updated_plan: '# Plan\n\n```js\nconst x = "hello";\n```\n\n"quoted" & special <chars>',
    };
    const validate = ajv.compile(PlannerRevisionJsonSchema);
    expect(validate(payload)).toBe(true);
    const parsed = PlannerRevisionSchema.parse(payload);
    expect(parsed.updated_plan).toBe(payload.updated_plan);
  });
});
