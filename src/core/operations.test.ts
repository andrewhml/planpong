import { describe, it, expect } from "vitest";
import {
  severityFromFeedback,
  formatRoundSeverity,
  formatTrajectory,
  formatTallies,
  formatDuration,
  formatProviderLabel,
  updatePlanStatusLine,
  type RoundSeverity,
} from "./operations.js";
import type { ReviewFeedback } from "../schemas/feedback.js";

// --- severityFromFeedback ---

describe("severityFromFeedback", () => {
  it("counts severity levels correctly", () => {
    const feedback: ReviewFeedback = {
      verdict: "needs_revision",
      summary: "Issues found",
      issues: [
        { id: "F1", severity: "P1", section: "s", title: "t", description: "d", suggestion: "s" },
        { id: "F2", severity: "P1", section: "s", title: "t", description: "d", suggestion: "s" },
        { id: "F3", severity: "P2", section: "s", title: "t", description: "d", suggestion: "s" },
        { id: "F4", severity: "P3", section: "s", title: "t", description: "d", suggestion: "s" },
      ],
    };
    const result = severityFromFeedback(feedback);
    expect(result).toEqual({ P1: 2, P2: 1, P3: 1 });
  });

  it("returns zeros for empty issues", () => {
    const feedback: ReviewFeedback = {
      verdict: "approved",
      summary: "Good",
      issues: [],
    };
    expect(severityFromFeedback(feedback)).toEqual({ P1: 0, P2: 0, P3: 0 });
  });
});

// --- formatRoundSeverity ---

describe("formatRoundSeverity", () => {
  it("formats all severity levels", () => {
    expect(formatRoundSeverity({ P1: 2, P2: 1, P3: 3 })).toBe("2P1 1P2 3P3");
  });

  it("omits zero counts", () => {
    expect(formatRoundSeverity({ P1: 0, P2: 1, P3: 0 })).toBe("1P2");
  });

  it("returns '0' when all counts are zero", () => {
    expect(formatRoundSeverity({ P1: 0, P2: 0, P3: 0 })).toBe("0");
  });
});

// --- formatTrajectory ---

describe("formatTrajectory", () => {
  it("joins multiple rounds with arrow separator", () => {
    const trajectory: RoundSeverity[] = [
      { P1: 2, P2: 1, P3: 0 },
      { P1: 0, P2: 1, P3: 1 },
      { P1: 0, P2: 0, P3: 0 },
    ];
    expect(formatTrajectory(trajectory)).toBe("2P1 1P2 → 1P2 1P3 → 0");
  });

  it("handles single round", () => {
    expect(formatTrajectory([{ P1: 1, P2: 0, P3: 0 }])).toBe("1P1");
  });

  it("handles empty trajectory", () => {
    expect(formatTrajectory([])).toBe("");
  });
});

// --- formatTallies ---

describe("formatTallies", () => {
  it("formats all tallies", () => {
    expect(formatTallies(3, 1, 2)).toBe("Accepted: 3 | Rejected: 1 | Deferred: 2");
  });

  it("omits zero tallies", () => {
    expect(formatTallies(3, 0, 0)).toBe("Accepted: 3");
  });

  it("returns empty string when all zero", () => {
    expect(formatTallies(0, 0, 0)).toBe("");
  });
});

// --- formatDuration ---

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("handles exact minutes", () => {
    expect(formatDuration(120000)).toBe("2m 0s");
  });
});

// --- formatProviderLabel ---

describe("formatProviderLabel", () => {
  it("returns provider name when no model or effort", () => {
    expect(formatProviderLabel({ provider: "claude" })).toBe("claude");
  });

  it("returns provider name when model and effort are 'default'", () => {
    expect(formatProviderLabel({ provider: "claude", model: "default", effort: "default" })).toBe(
      "claude",
    );
  });

  it("includes model when specified", () => {
    expect(formatProviderLabel({ provider: "claude", model: "opus" })).toBe("claude(opus)");
  });

  it("includes effort when specified", () => {
    expect(formatProviderLabel({ provider: "codex", effort: "high" })).toBe("codex(high)");
  });

  it("includes both model and effort", () => {
    expect(formatProviderLabel({ provider: "claude", model: "sonnet", effort: "high" })).toBe(
      "claude(sonnet/high)",
    );
  });
});

// --- updatePlanStatusLine ---

describe("updatePlanStatusLine", () => {
  it("replaces existing planpong status line", () => {
    const plan = "# Plan\n\n**planpong:** R1/10 | old status\n\n## Steps\n- Step 1";
    const result = updatePlanStatusLine(plan, "**planpong:** R2/10 | new status");
    expect(result).toContain("**planpong:** R2/10 | new status");
    expect(result).not.toContain("old status");
  });

  it("inserts after Status line if no planpong line exists", () => {
    const plan = "# Plan\n\n**Status:** Draft\n\n## Steps";
    const result = updatePlanStatusLine(plan, "**planpong:** R0/10 | init");
    const lines = result.split("\n");
    const statusIdx = lines.findIndex((l) => l.startsWith("**Status:**"));
    expect(lines[statusIdx + 1]).toBe("**planpong:** R0/10 | init");
  });

  it("inserts after title if no Status or planpong line exists", () => {
    const plan = "# My Plan\n\n## Steps\n- Step 1";
    const result = updatePlanStatusLine(plan, "**planpong:** R0/10 | init");
    const lines = result.split("\n");
    expect(lines[0]).toBe("# My Plan");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("**planpong:** R0/10 | init");
  });
});
