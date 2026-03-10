import { describe, it, expect } from "vitest";
import { extractJSON, parseFeedback, parseRevision, isConverged } from "./convergence.js";
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

  it("returns false in round 1 (direction) even if approved", () => {
    expect(isConverged(approved, 1)).toBe(false);
  });

  it("returns false in round 2 (risk) even if approved", () => {
    expect(isConverged(approved, 2)).toBe(false);
  });

  it("returns false in round 2 even with approved_with_notes", () => {
    expect(isConverged(approvedWithNotes, 2)).toBe(false);
  });

  it("returns true in round 3 (detail) when approved", () => {
    expect(isConverged(approved, 3)).toBe(true);
  });

  it("returns true in round 3 with approved_with_notes", () => {
    expect(isConverged(approvedWithNotes, 3)).toBe(true);
  });

  it("returns false in round 3 when needs_revision", () => {
    expect(isConverged(needsRevision, 3)).toBe(false);
  });

  it("returns true in later rounds when approved", () => {
    expect(isConverged(approved, 5)).toBe(true);
    expect(isConverged(approved, 10)).toBe(true);
  });

  it("returns false in later rounds when needs_revision", () => {
    expect(isConverged(needsRevision, 5)).toBe(false);
  });
});
