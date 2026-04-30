import { describe, it, expect, vi } from "vitest";
import {
  verifyIssue,
  verifyFeedback,
  stripModelVerified,
  MIN_QUOTE_LENGTH,
  MAX_QUOTE_LENGTH,
  COMPLIANCE_WARNING_THRESHOLD,
} from "./verify-evidence.js";
import type { FeedbackIssue, ReviewFeedback } from "../schemas/feedback.js";

const PLAN_TEXT = `# Sample Plan

**Status:** Draft

## Context

The CLI prints help with --help but there's no way to print the version.

## Steps

- [ ] Add a --version flag to the commander program registration in src/cli/index.ts
- [ ] Read the version from package.json at startup and pass it to program.version()
- [ ] Update the CLI's top-level help to mention --version

## Key Decisions

Use commander's built-in .version() rather than a custom handler.`;

function issue(overrides: Partial<FeedbackIssue> = {}): FeedbackIssue {
  return {
    id: overrides.id ?? "F1",
    severity: overrides.severity ?? "P2",
    section: overrides.section ?? "Steps",
    title: overrides.title ?? "test issue",
    description: overrides.description ?? "test description",
    suggestion: overrides.suggestion ?? "test suggestion",
    quoted_text: overrides.quoted_text,
    verified: overrides.verified,
  };
}

describe("verifyIssue", () => {
  it("verifies a verbatim quote present in the plan", () => {
    const result = verifyIssue(
      issue({
        quoted_text: "Add a --version flag to the commander program registration",
      }),
      PLAN_TEXT,
    );
    expect(result.verified).toBe(true);
  });

  it("verifies a quote with whitespace collapsed across lines", () => {
    // The plan has the version string + program.version() on consecutive
    // step lines. A quote that crosses line boundaries with normalized
    // whitespace should still match.
    const result = verifyIssue(
      issue({
        quoted_text:
          "pass    it    to    program.version()\n  - [ ] Update    the   CLI's",
      }),
      PLAN_TEXT,
    );
    expect(result.verified).toBe(true);
  });

  it("returns verified=false when the quote does not appear in the plan", () => {
    const result = verifyIssue(
      issue({ quoted_text: "this string does not appear anywhere" }),
      PLAN_TEXT,
    );
    expect(result.verified).toBe(false);
  });

  it("returns verified=false for missing quoted_text", () => {
    expect(verifyIssue(issue({}), PLAN_TEXT).verified).toBe(false);
  });

  it("returns verified=false for empty quoted_text", () => {
    expect(verifyIssue(issue({ quoted_text: "" }), PLAN_TEXT).verified).toBe(
      false,
    );
    expect(
      verifyIssue(issue({ quoted_text: "   \n  " }), PLAN_TEXT).verified,
    ).toBe(false);
  });

  it("returns verified=false for quotes below the distinctiveness floor", () => {
    // "Status:" is 7 chars and IS in the plan, but below MIN_QUOTE_LENGTH.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = verifyIssue(issue({ quoted_text: "Status:" }), PLAN_TEXT);
    expect(result.verified).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("below distinctiveness floor"),
    );
    stderrSpy.mockRestore();
  });

  it("returns verified=false for quotes above the length cap", () => {
    const longQuote = "x".repeat(MAX_QUOTE_LENGTH + 1);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = verifyIssue(
      issue({ quoted_text: longQuote }),
      PLAN_TEXT + longQuote,
    );
    expect(result.verified).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceeds length cap"),
    );
    stderrSpy.mockRestore();
  });

  it("does not throw on adversarial input (regex special chars)", () => {
    const adversarial = "( [ { . * + ? \\ } ] ) | ^ $".repeat(5);
    expect(() =>
      verifyIssue(issue({ quoted_text: adversarial }), PLAN_TEXT),
    ).not.toThrow();
  });

  it("does not throw on adversarial input (10K chars)", () => {
    const huge = "x".repeat(10_000);
    expect(() =>
      verifyIssue(issue({ quoted_text: huge }), PLAN_TEXT),
    ).not.toThrow();
  });
});

describe("verifyFeedback", () => {
  function feedback(issues: FeedbackIssue[]): ReviewFeedback {
    return {
      verdict: "needs_revision",
      summary: "test",
      issues,
    };
  }

  it("annotates each issue with verified flag", () => {
    const result = verifyFeedback(
      feedback([
        issue({
          id: "F1",
          quoted_text:
            "Add a --version flag to the commander program registration",
        }),
        issue({ id: "F2", quoted_text: "this string does not appear at all" }),
      ]),
      PLAN_TEXT,
    );
    expect(result.feedback.issues[0]?.verified).toBe(true);
    expect(result.feedback.issues[1]?.verified).toBe(false);
  });

  it("populates unverified_count from the issue verifications", () => {
    const result = verifyFeedback(
      feedback([
        issue({ id: "F1", quoted_text: "version from package.json at startup" }),
        issue({ id: "F2", quoted_text: "missing in plan entirely" }),
        issue({ id: "F3", quoted_text: "also not present here" }),
      ]),
      PLAN_TEXT,
    );
    expect(result.feedback.unverified_count).toBe(2);
  });

  it("flips quote_compliance_warning when >50% of issues lack quoted_text", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = verifyFeedback(
      feedback([
        issue({
          id: "F1",
          quoted_text: "Add a --version flag to the commander",
        }),
        issue({ id: "F2" }),
        issue({ id: "F3" }),
      ]),
      PLAN_TEXT,
    );
    expect(result.feedback.quote_compliance_warning).toBe(true);
    stderrSpy.mockRestore();
  });

  it("leaves quote_compliance_warning false when ≤50% missing", () => {
    const result = verifyFeedback(
      feedback([
        issue({
          id: "F1",
          quoted_text: "Add a --version flag to the commander",
        }),
        issue({
          id: "F2",
          quoted_text: "version from package.json at startup",
        }),
        issue({ id: "F3" }),
      ]),
      PLAN_TEXT,
    );
    expect(result.feedback.quote_compliance_warning).toBe(false);
  });

  it("returns exceptionCount from the result for telemetry", () => {
    const result = verifyFeedback(
      feedback([
        issue({
          id: "F1",
          quoted_text: "Add a --version flag to the commander",
        }),
      ]),
      PLAN_TEXT,
    );
    expect(result.exceptionCount).toBe(0);
  });

  it("does not mutate the input feedback", () => {
    const orig = feedback([
      issue({ id: "F1", quoted_text: "irrelevant text not in plan" }),
    ]);
    verifyFeedback(orig, PLAN_TEXT);
    expect(orig.unverified_count).toBeUndefined();
    expect(orig.quote_compliance_warning).toBeUndefined();
  });

  it("returns 0 unverified_count for empty issues array", () => {
    const result = verifyFeedback(feedback([]), PLAN_TEXT);
    expect(result.feedback.unverified_count).toBe(0);
    expect(result.feedback.quote_compliance_warning).toBe(false);
  });
});

describe("stripModelVerified", () => {
  it("removes verified field from each issue in place", () => {
    const issues: FeedbackIssue[] = [
      issue({ id: "F1", verified: true, quoted_text: "abc" }),
      issue({ id: "F2", verified: false, quoted_text: "def" }),
    ];
    stripModelVerified(issues);
    expect(issues[0]).not.toHaveProperty("verified");
    expect(issues[1]).not.toHaveProperty("verified");
    expect(issues[0]?.quoted_text).toBe("abc");
  });

  it("leaves issues without verified untouched", () => {
    const issues: FeedbackIssue[] = [issue({ id: "F1", quoted_text: "x" })];
    stripModelVerified(issues);
    expect(issues[0]?.id).toBe("F1");
  });

  it("verifier overrides any model-supplied verified=true", () => {
    // Defense-in-depth: if stripModelVerified is bypassed, the verifier's
    // own logic decides. But the canonical path strips first.
    const issues: FeedbackIssue[] = [
      issue({
        id: "F1",
        verified: true,
        quoted_text: "this is not in the plan",
      }),
    ];
    stripModelVerified(issues);
    const result = verifyFeedback(
      {
        verdict: "needs_revision",
        summary: "x",
        issues,
      },
      PLAN_TEXT,
    );
    expect(result.feedback.issues[0]?.verified).toBe(false);
  });
});

describe("constants are sane", () => {
  it("MIN < MAX", () => {
    expect(MIN_QUOTE_LENGTH).toBeLessThan(MAX_QUOTE_LENGTH);
  });
  it("threshold is between 0 and 1 exclusive", () => {
    expect(COMPLIANCE_WARNING_THRESHOLD).toBeGreaterThan(0);
    expect(COMPLIANCE_WARNING_THRESHOLD).toBeLessThan(1);
  });
});
