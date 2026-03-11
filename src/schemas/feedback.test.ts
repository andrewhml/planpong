import { describe, it, expect } from "vitest";
import {
  ReviewFeedbackSchema,
  DirectionFeedbackSchema,
  RiskFeedbackSchema,
  RiskEntrySchema,
} from "./feedback.js";

describe("ReviewFeedbackSchema", () => {
  it("accepts blocked verdict", () => {
    const fb = {
      verdict: "blocked",
      summary: "Non-viable",
      issues: [],
    };
    const result = ReviewFeedbackSchema.parse(fb);
    expect(result.verdict).toBe("blocked");
  });

  it("accepts all original verdicts", () => {
    for (const verdict of ["needs_revision", "approved", "approved_with_notes"]) {
      const fb = {
        verdict,
        summary: "test",
        issues: verdict === "approved_with_notes"
          ? [{ id: "F1", severity: "P3", section: "s", title: "t", description: "d", suggestion: "s" }]
          : [],
      };
      expect(ReviewFeedbackSchema.parse(fb).verdict).toBe(verdict);
    }
  });

  it("accepts optional fallback_used and missing_phase_fields", () => {
    const fb = {
      verdict: "needs_revision",
      summary: "test",
      issues: [],
      fallback_used: true,
      missing_phase_fields: ["confidence", "alternatives"],
    };
    const result = ReviewFeedbackSchema.parse(fb);
    expect(result.fallback_used).toBe(true);
    expect(result.missing_phase_fields).toEqual(["confidence", "alternatives"]);
  });
});

describe("DirectionFeedbackSchema", () => {
  const validDirection = {
    verdict: "needs_revision" as const,
    summary: "Direction assessment",
    confidence: "medium" as const,
    approach_assessment: "The approach is sound",
    alternatives: [{ approach: "Alt A", tradeoff: "More complex" }],
    assumptions: ["API is stable"],
    issues: [],
  };

  it("parses valid direction feedback", () => {
    const result = DirectionFeedbackSchema.parse(validDirection);
    expect(result.confidence).toBe("medium");
    expect(result.approach_assessment).toBe("The approach is sound");
    expect(result.alternatives).toHaveLength(1);
    expect(result.assumptions).toHaveLength(1);
  });

  it("accepts blocked verdict", () => {
    const fb = { ...validDirection, verdict: "blocked" };
    const result = DirectionFeedbackSchema.parse(fb);
    expect(result.verdict).toBe("blocked");
  });

  it("rejects approved verdict", () => {
    const fb = { ...validDirection, verdict: "approved" };
    expect(() => DirectionFeedbackSchema.parse(fb)).toThrow();
  });

  it("rejects approved_with_notes verdict", () => {
    const fb = { ...validDirection, verdict: "approved_with_notes" };
    expect(() => DirectionFeedbackSchema.parse(fb)).toThrow();
  });

  it("rejects missing confidence", () => {
    const { confidence: _, ...fb } = validDirection;
    expect(() => DirectionFeedbackSchema.parse(fb)).toThrow();
  });

  it("rejects missing approach_assessment", () => {
    const { approach_assessment: _, ...fb } = validDirection;
    expect(() => DirectionFeedbackSchema.parse(fb)).toThrow();
  });
});

describe("RiskFeedbackSchema", () => {
  const validRisk = {
    verdict: "needs_revision" as const,
    summary: "Risk assessment",
    risk_level: "high" as const,
    risks: [
      {
        id: "R1",
        category: "dependency" as const,
        likelihood: "high" as const,
        impact: "high" as const,
        title: "External API",
        description: "May be unavailable",
        mitigation: "Add fallback",
      },
    ],
    issues: [],
  };

  it("parses valid risk feedback", () => {
    const result = RiskFeedbackSchema.parse(validRisk);
    expect(result.risk_level).toBe("high");
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0].category).toBe("dependency");
  });

  it("accepts blocked verdict", () => {
    const fb = { ...validRisk, verdict: "blocked" };
    const result = RiskFeedbackSchema.parse(fb);
    expect(result.verdict).toBe("blocked");
  });

  it("rejects approved verdict", () => {
    const fb = { ...validRisk, verdict: "approved" };
    expect(() => RiskFeedbackSchema.parse(fb)).toThrow();
  });

  it("accepts empty risks array", () => {
    const fb = { ...validRisk, risks: [] };
    const result = RiskFeedbackSchema.parse(fb);
    expect(result.risks).toHaveLength(0);
  });
});

describe("RiskEntrySchema", () => {
  it("accepts all valid categories", () => {
    for (const category of ["dependency", "integration", "operational", "assumption", "external"]) {
      const entry = {
        id: "R1",
        category,
        likelihood: "medium",
        impact: "high",
        title: "Test",
        description: "Test desc",
        mitigation: "Test fix",
      };
      expect(RiskEntrySchema.parse(entry).category).toBe(category);
    }
  });

  it("rejects invalid category", () => {
    const entry = {
      id: "R1",
      category: "invalid",
      likelihood: "medium",
      impact: "high",
      title: "Test",
      description: "Test desc",
      mitigation: "Test fix",
    };
    expect(() => RiskEntrySchema.parse(entry)).toThrow();
  });

  it("accepts all likelihood/impact levels", () => {
    for (const level of ["high", "medium", "low"]) {
      const entry = {
        id: "R1",
        category: "dependency",
        likelihood: level,
        impact: level,
        title: "Test",
        description: "Test desc",
        mitigation: "Test fix",
      };
      const result = RiskEntrySchema.parse(entry);
      expect(result.likelihood).toBe(level);
      expect(result.impact).toBe(level);
    }
  });
});
