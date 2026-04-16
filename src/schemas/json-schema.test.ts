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

// --- OpenAI strict dialect compliance ---

/**
 * OpenAI structured output requires: every property in `required`,
 * `additionalProperties: false`, optional fields nullable. Verify that
 * the generator produces these everywhere.
 */
function assertStrictRecursive(node: unknown, path: string = "root"): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertStrictRecursive(child, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    expect(obj.additionalProperties, `${path} must have additionalProperties: false`).toBe(false);
    const keys = Object.keys(obj.properties as Record<string, unknown>);
    const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
    for (const key of keys) {
      expect(required, `${path}.${key} must appear in required`).toContain(key);
    }
  }
  for (const value of Object.values(obj)) {
    assertStrictRecursive(value, path);
  }
}

describe("OpenAI strict dialect compliance", () => {
  it("DirectionFeedback schema conforms to OpenAI strict mode", () => {
    assertStrictRecursive(DirectionFeedbackJsonSchema);
  });

  it("RiskFeedback schema conforms to OpenAI strict mode", () => {
    assertStrictRecursive(RiskFeedbackJsonSchema);
  });

  it("ReviewFeedback schema conforms to OpenAI strict mode", () => {
    assertStrictRecursive(ReviewFeedbackJsonSchema);
  });

  it("PlannerRevision schema conforms to OpenAI strict mode", () => {
    assertStrictRecursive(PlannerRevisionJsonSchema);
  });

  it("strips internal observability fields from generated schemas", () => {
    // fallback_used and missing_phase_fields are parser-set, not model-set
    const json = JSON.stringify(DirectionFeedbackJsonSchema);
    expect(json).not.toContain("fallback_used");
    expect(json).not.toContain("missing_phase_fields");
  });

  it("optional fields are expressed as nullable", () => {
    // severity_dispute is an optional field in IssueResponseSchema
    const schemaStr = JSON.stringify(PlannerRevisionJsonSchema);
    // severity_dispute must appear in required, and its type must include null
    // (either as [X, "null"] or wrapped in anyOf)
    expect(schemaStr).toContain("severity_dispute");
    expect(schemaStr).toContain("null");
  });
});

// --- Contract tests: JSON Schema accepts, Zod accepts (after null-stripping) ---

describe("Contract tests — JSON Schema and Zod agree on structural subset", () => {
  it("DirectionFeedback: OpenAI-strict payload passes JSON Schema", () => {
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

  it("DirectionFeedback: missing required field fails JSON Schema and Zod", () => {
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

  it("RiskFeedback: valid payload passes JSON Schema and Zod", () => {
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

  it("ReviewFeedback: valid payload passes JSON Schema and Zod", () => {
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

  it("PlannerRevision: OpenAI-strict payload (with nulls for optional fields) passes JSON Schema", () => {
    const payload = {
      responses: [
        {
          issue_id: "F1",
          action: "accepted",
          severity_dispute: null, // OpenAI-strict form: null instead of missing
          rationale: "good catch",
        },
      ],
      updated_plan: "# Plan\n\nUpdated content",
    };
    const validate = ajv.compile(PlannerRevisionJsonSchema);
    expect(validate(payload)).toBe(true);
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
