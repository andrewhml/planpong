import { describe, it, expect } from "vitest";
import {
  extractJSON,
  parseFeedback,
  parseFeedbackForPhase,
  parseStructuredFeedbackForPhase,
  parseStructuredRevision,
  parseRevision,
  isConverged,
  StructuredOutputParseError,
  ZodValidationError,
} from "./convergence.js";
import type { ReviewFeedback } from "../schemas/feedback.js";

// --- extractJSON ---

describe("extractJSON", () => {
  it("extracts from sentinel tags", () => {
    const input = `Some preamble\n<planpong-feedback>\n{"verdict": "approved"}\n</planpong-feedback>\ntrailing`;
    expect(extractJSON(input, "planpong-feedback")).toBe('{"verdict": "approved"}');
  });

  it("extracts from sentinel tags case-insensitively", () => {
    const input = `<PLANPONG-FEEDBACK>{"verdict": "approved"}</PLANPONG-FEEDBACK>`;
    expect(extractJSON(input, "planpong-feedback")).toBe('{"verdict": "approved"}');
  });

  it("falls back to JSON code fence", () => {
    const input = "Here is the result:\n```json\n{\"verdict\": \"approved\"}\n```";
    expect(extractJSON(input, "planpong-feedback")).toBe('{"verdict": "approved"}');
  });

  it("falls back to bare code fence", () => {
    const input = "```\n{\"key\": \"value\"}\n```";
    expect(extractJSON(input, "planpong-feedback")).toBe('{"key": "value"}');
  });

  it("falls back to raw JSON object in content", () => {
    const input = 'Some text {"verdict": "approved", "issues": []} more text';
    expect(extractJSON(input, "planpong-feedback")).toBe('{"verdict": "approved", "issues": []}');
  });

  it("returns null when no JSON found", () => {
    expect(extractJSON("no json here", "planpong-feedback")).toBeNull();
  });

  it("prefers sentinel tags over code fences", () => {
    const input = `<planpong-feedback>{"from": "tags"}</planpong-feedback>\n\`\`\`json\n{"from": "fence"}\n\`\`\``;
    expect(extractJSON(input, "planpong-feedback")).toBe('{"from": "tags"}');
  });
});

// --- parseFeedback ---

describe("parseFeedback", () => {
  const validFeedback = {
    verdict: "needs_revision",
    summary: "Plan needs work",
    issues: [
      {
        id: "F1",
        severity: "P1",
        section: "Architecture",
        title: "Missing error handling",
        description: "No error handling strategy",
        suggestion: "Add error handling section",
      },
    ],
  };

  it("parses valid feedback from sentinel tags", () => {
    const input = `<planpong-feedback>${JSON.stringify(validFeedback)}</planpong-feedback>`;
    const result = parseFeedback(input);
    expect(result.verdict).toBe("needs_revision");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("P1");
  });

  it("parses approved feedback with empty issues", () => {
    const fb = { verdict: "approved", summary: "Looks good", issues: [] };
    const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
    const result = parseFeedback(input);
    expect(result.verdict).toBe("approved");
    expect(result.issues).toHaveLength(0);
  });

  it("parses blocked verdict", () => {
    const fb = {
      verdict: "blocked",
      summary: "Non-viable",
      issues: [
        { id: "F1", severity: "P1", section: "s", title: "t", description: "d", suggestion: "s" },
      ],
    };
    const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
    const result = parseFeedback(input);
    expect(result.verdict).toBe("blocked");
  });

  it("rejects approved_with_notes when issues have P1/P2", () => {
    const fb = {
      verdict: "approved_with_notes",
      summary: "Mostly good",
      issues: [
        {
          id: "F1",
          severity: "P1",
          section: "s",
          title: "t",
          description: "d",
          suggestion: "s",
        },
      ],
    };
    const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
    expect(() => parseFeedback(input)).toThrow();
  });

  it("allows approved_with_notes when all issues are P3", () => {
    const fb = {
      verdict: "approved_with_notes",
      summary: "Minor notes",
      issues: [
        {
          id: "F1",
          severity: "P3",
          section: "s",
          title: "t",
          description: "d",
          suggestion: "s",
        },
      ],
    };
    const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
    const result = parseFeedback(input);
    expect(result.verdict).toBe("approved_with_notes");
  });

  it("throws on missing JSON", () => {
    expect(() => parseFeedback("no json")).toThrow("Could not extract feedback JSON");
  });

  it("throws on invalid JSON syntax", () => {
    expect(() => parseFeedback("<planpong-feedback>{invalid}</planpong-feedback>")).toThrow(
      "Invalid JSON",
    );
  });
});

// --- parseRevision ---

describe("parseRevision", () => {
  const validRevision = {
    responses: [
      {
        issue_id: "F1",
        action: "accepted",
        rationale: "Good point, fixed it",
      },
    ],
    updated_plan: "# Updated Plan\n\nContent here",
  };

  it("parses valid revision from sentinel tags", () => {
    const input = `<planpong-revision>${JSON.stringify(validRevision)}</planpong-revision>`;
    const result = parseRevision(input);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].action).toBe("accepted");
    expect(result.updated_plan).toContain("Updated Plan");
  });

  it("parses revision with severity dispute", () => {
    const revision = {
      responses: [
        {
          issue_id: "F1",
          action: "accepted",
          rationale: "Fixed",
          severity_dispute: {
            original: "P1",
            revised: "P3",
            justification: "Not actually critical",
          },
        },
      ],
      updated_plan: "# Plan",
    };
    const input = `<planpong-revision>${JSON.stringify(revision)}</planpong-revision>`;
    const result = parseRevision(input);
    expect(result.responses[0].severity_dispute?.revised).toBe("P3");
  });

  it("throws on missing JSON", () => {
    expect(() => parseRevision("nothing here")).toThrow("Could not extract revision JSON");
  });
});

// --- isConverged ---

describe("isConverged", () => {
  const approved: ReviewFeedback = {
    verdict: "approved",
    summary: "Looks good",
    issues: [],
  };

  const approvedWithNotes: ReviewFeedback = {
    verdict: "approved_with_notes",
    summary: "Minor notes",
    issues: [
      {
        id: "F1",
        severity: "P3",
        section: "s",
        title: "t",
        description: "d",
        suggestion: "s",
      },
    ],
  };

  const needsRevision: ReviewFeedback = {
    verdict: "needs_revision",
    summary: "Needs work",
    issues: [
      {
        id: "F1",
        severity: "P1",
        section: "s",
        title: "t",
        description: "d",
        suggestion: "s",
      },
    ],
  };

  const blocked: ReviewFeedback = {
    verdict: "blocked",
    summary: "Non-viable",
    issues: [
      {
        id: "F1",
        severity: "P1",
        section: "s",
        title: "t",
        description: "d",
        suggestion: "s",
      },
    ],
  };

  it("returns true when approved", () => {
    expect(isConverged(approved)).toBe(true);
  });

  it("returns true when approved_with_notes", () => {
    expect(isConverged(approvedWithNotes)).toBe(true);
  });

  it("returns false when needs_revision", () => {
    expect(isConverged(needsRevision)).toBe(false);
  });

  it("returns true when blocked", () => {
    expect(isConverged(blocked)).toBe(true);
  });
});

// --- parseFeedbackForPhase ---

describe("parseFeedbackForPhase", () => {
  const makeIssue = (id: string) => ({
    id,
    severity: "P2" as const,
    section: "s",
    title: "t",
    description: "d",
    suggestion: "s",
  });

  describe("direction phase", () => {
    it("parses full direction feedback", () => {
      const fb = {
        verdict: "needs_revision",
        summary: "Direction assessment",
        confidence: "medium",
        approach_assessment: "The approach is reasonable",
        alternatives: [{ approach: "Alt A", tradeoff: "More complex" }],
        assumptions: ["API is stable"],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "direction");
      expect(result.verdict).toBe("needs_revision");
      expect("confidence" in result && result.confidence).toBe("medium");
      expect("approach_assessment" in result && result.approach_assessment).toBe(
        "The approach is reasonable",
      );
    });

    it("falls back to base schema and coerces verdict to needs_revision", () => {
      // Missing direction-specific fields → phase parse fails → fallback
      const fb = {
        verdict: "approved",
        summary: "Looks good",
        issues: [],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "direction");
      // Should be coerced to needs_revision
      expect(result.verdict).toBe("needs_revision");
      expect(result.fallback_used).toBe(true);
    });

    it("preserves blocked verdict with valid approach_assessment", () => {
      const fb = {
        verdict: "blocked",
        summary: "Non-viable",
        confidence: "low",
        approach_assessment: "Depends on deprecated API",
        alternatives: [],
        assumptions: [],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "direction");
      expect(result.verdict).toBe("blocked");
    });

    it("coerces blocked to needs_revision when approach_assessment is empty", () => {
      const fb = {
        verdict: "blocked",
        summary: "Non-viable",
        confidence: "low",
        approach_assessment: "",
        alternatives: [],
        assumptions: [],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "direction");
      expect(result.verdict).toBe("needs_revision");
    });

    it("fallback blocked with recoverable rationale preserves blocked", () => {
      // Has blocked + approach_assessment but missing other direction fields
      // → phase parse fails → fallback → secondary extraction recovers rationale
      const fb = {
        verdict: "blocked",
        summary: "Non-viable",
        approach_assessment: "Depends on deprecated API",
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "direction");
      expect(result.verdict).toBe("blocked");
      expect(result.fallback_used).toBe(true);
    });

    it("fallback blocked without rationale coerces to needs_revision", () => {
      const fb = {
        verdict: "blocked",
        summary: "Non-viable",
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "direction");
      expect(result.verdict).toBe("needs_revision");
      expect(result.fallback_used).toBe(true);
    });
  });

  describe("risk phase", () => {
    it("parses full risk feedback", () => {
      const fb = {
        verdict: "needs_revision",
        summary: "Risk assessment",
        risk_level: "high",
        risks: [
          {
            id: "R1",
            category: "dependency",
            likelihood: "high",
            impact: "high",
            title: "External API",
            description: "May be unavailable",
            mitigation: "Add fallback",
          },
        ],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "risk");
      expect(result.verdict).toBe("needs_revision");
      expect("risk_level" in result && result.risk_level).toBe("high");
      expect("risks" in result && result.risks).toHaveLength(1);
    });

    it("falls back to base schema and coerces verdict", () => {
      const fb = {
        verdict: "approved",
        summary: "No risks",
        issues: [],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "risk");
      expect(result.verdict).toBe("needs_revision");
      expect(result.fallback_used).toBe(true);
    });

    it("preserves blocked verdict with non-empty risks", () => {
      const fb = {
        verdict: "blocked",
        summary: "Unmitigable",
        risk_level: "high",
        risks: [
          {
            id: "R1",
            category: "external",
            likelihood: "high",
            impact: "high",
            title: "Hard blocker",
            description: "Cannot proceed",
            mitigation: "None available",
          },
        ],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "risk");
      expect(result.verdict).toBe("blocked");
    });

    it("coerces blocked to needs_revision when risks is empty", () => {
      const fb = {
        verdict: "blocked",
        summary: "Blocked",
        risk_level: "high",
        risks: [],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "risk");
      expect(result.verdict).toBe("needs_revision");
    });

    it("fallback blocked with recoverable risks preserves blocked", () => {
      const fb = {
        verdict: "blocked",
        summary: "Unmitigable",
        risks: [
          {
            id: "R1",
            category: "external",
            likelihood: "high",
            impact: "high",
            title: "Hard blocker",
            description: "Cannot proceed",
            mitigation: "None",
          },
        ],
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "risk");
      expect(result.verdict).toBe("blocked");
      expect(result.fallback_used).toBe(true);
    });

    it("fallback blocked without risks coerces to needs_revision", () => {
      const fb = {
        verdict: "blocked",
        summary: "Blocked",
        issues: [makeIssue("F1")],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "risk");
      expect(result.verdict).toBe("needs_revision");
      expect(result.fallback_used).toBe(true);
    });
  });

  describe("detail phase", () => {
    it("passes through to base parser unchanged", () => {
      const fb = {
        verdict: "approved",
        summary: "All good",
        issues: [],
      };
      const input = `<planpong-feedback>${JSON.stringify(fb)}</planpong-feedback>`;
      const result = parseFeedbackForPhase(input, "detail");
      expect(result.verdict).toBe("approved");
    });
  });
});

// --- Structured output parsing ---

describe("OpenAI-strict null stripping", () => {
  it("strips null optional fields before Zod validation (PlannerRevision)", () => {
    // OpenAI-strict form includes optional fields as null. Our Zod schema
    // uses .optional() which expects missing keys. The parser must strip
    // nulls so validation succeeds.
    const rev = {
      responses: [
        {
          issue_id: "F1",
          action: "accepted",
          severity_dispute: null,
          rationale: "good catch",
        },
      ],
      updated_plan: "# Plan",
    };
    const result = parseStructuredRevision(JSON.stringify(rev));
    expect(result.responses[0].severity_dispute).toBeUndefined();
  });

  it("preserves non-null optional fields", () => {
    const rev = {
      responses: [
        {
          issue_id: "F1",
          action: "accepted",
          severity_dispute: {
            original: "P1",
            revised: "P2",
            justification: "overstated",
          },
          rationale: "good catch",
        },
      ],
      updated_plan: "# Plan",
    };
    const result = parseStructuredRevision(JSON.stringify(rev));
    expect(result.responses[0].severity_dispute).toEqual({
      original: "P1",
      revised: "P2",
      justification: "overstated",
    });
  });
});

describe("parseStructuredFeedbackForPhase", () => {
  it("parses raw JSON without tag extraction (detail phase)", () => {
    const fb = {
      verdict: "approved",
      summary: "looks good",
      issues: [],
    };
    const result = parseStructuredFeedbackForPhase(JSON.stringify(fb), "detail");
    expect(result.verdict).toBe("approved");
    expect(result.summary).toBe("looks good");
  });

  it("parses raw JSON for direction phase", () => {
    const fb = {
      verdict: "needs_revision",
      summary: "rethink",
      issues: [],
      confidence: "medium",
      approach_assessment: "questionable",
      alternatives: [],
      assumptions: [],
    };
    const result = parseStructuredFeedbackForPhase(JSON.stringify(fb), "direction");
    expect(result.verdict).toBe("needs_revision");
    expect("confidence" in result && result.confidence).toBe("medium");
  });

  it("parses raw JSON for risk phase", () => {
    const fb = {
      verdict: "needs_revision",
      summary: "risks present",
      issues: [],
      risk_level: "high",
      risks: [],
    };
    const result = parseStructuredFeedbackForPhase(JSON.stringify(fb), "risk");
    expect(result.verdict).toBe("needs_revision");
    expect("risk_level" in result && result.risk_level).toBe("high");
  });

  it("throws StructuredOutputParseError on invalid JSON (downgrade-eligible)", () => {
    expect(() => parseStructuredFeedbackForPhase("not json", "detail")).toThrow(
      StructuredOutputParseError,
    );
  });

  it("throws ZodValidationError on Zod refinement failure (terminal, F2)", () => {
    // approved_with_notes with a P1 issue violates the Zod refinement —
    // JSON Schema accepts it, Zod rejects it. Must NOT pass through.
    const fb = {
      verdict: "approved_with_notes",
      summary: "looks good",
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
    expect(() =>
      parseStructuredFeedbackForPhase(JSON.stringify(fb), "detail"),
    ).toThrow(ZodValidationError);
  });

  it("throws ZodValidationError when required fields missing", () => {
    const fb = { verdict: "needs_revision" }; // missing summary, issues
    expect(() => parseStructuredFeedbackForPhase(JSON.stringify(fb), "detail")).toThrow(
      ZodValidationError,
    );
  });

  it("coerces blocked verdict to needs_revision when direction rationale missing", () => {
    const fb = {
      verdict: "blocked",
      summary: "blocked",
      issues: [],
      confidence: "low",
      approach_assessment: "   ", // empty after trim
      alternatives: [],
      assumptions: [],
    };
    const result = parseStructuredFeedbackForPhase(JSON.stringify(fb), "direction");
    expect(result.verdict).toBe("needs_revision");
  });

  it("preserves blocked verdict when direction rationale present", () => {
    const fb = {
      verdict: "blocked",
      summary: "blocked",
      issues: [],
      confidence: "low",
      approach_assessment: "depends on a deprecated API",
      alternatives: [],
      assumptions: [],
    };
    const result = parseStructuredFeedbackForPhase(JSON.stringify(fb), "direction");
    expect(result.verdict).toBe("blocked");
  });
});

describe("parseStructuredRevision", () => {
  it("parses raw JSON without tag extraction", () => {
    const rev = {
      responses: [
        { issue_id: "F1", action: "accepted", rationale: "good catch" },
      ],
      updated_plan: "# Updated\n\nNew content",
    };
    const result = parseStructuredRevision(JSON.stringify(rev));
    expect(result.responses).toHaveLength(1);
    expect(result.updated_plan).toBe("# Updated\n\nNew content");
  });

  it("throws StructuredOutputParseError on invalid JSON", () => {
    expect(() => parseStructuredRevision("not json")).toThrow(StructuredOutputParseError);
  });

  it("throws ZodValidationError on schema mismatch", () => {
    const rev = { responses: "not an array", updated_plan: "x" };
    expect(() => parseStructuredRevision(JSON.stringify(rev))).toThrow(ZodValidationError);
  });

  it("preserves updated_plan with code fences and special characters", () => {
    const rev = {
      responses: [],
      updated_plan: '# Plan\n\n```js\nconst x = "hi";\n```\n"quoted" & <special>',
    };
    const result = parseStructuredRevision(JSON.stringify(rev));
    expect(result.updated_plan).toBe(rev.updated_plan);
  });
});
