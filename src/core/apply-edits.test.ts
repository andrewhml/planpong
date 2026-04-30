import { describe, it, expect } from "vitest";
import { applyEdits } from "./apply-edits.js";

const PLAN = `# Test Plan

**Status:** Draft
**planpong:** R0/10 | x → y | Awaiting review

## Context

Some context paragraph.

## Steps

- [ ] Do thing A
- [ ] Do thing B
- [ ] Do thing C

## Limitations & Future Work

A limitation paragraph.
`;

describe("applyEdits", () => {
  it("applies a single edit successfully within a section", () => {
    const result = applyEdits(PLAN, [
      { section: "Steps", before: "- [ ] Do thing B\n", after: "- [ ] Do thing B (revised)\n" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(result.plan).toContain("- [ ] Do thing B (revised)");
    expect(result.plan).not.toContain("- [ ] Do thing B\n- [ ] Do thing C");
  });

  it("applies multiple sequential edits, later edits see earlier results", () => {
    const result = applyEdits(PLAN, [
      { section: "Steps", before: "- [ ] Do thing A\n", after: "- [ ] Do A1\n- [ ] Do A2\n" },
      { section: "Steps", before: "- [ ] Do A2\n", after: "- [ ] Do A2 (refined)\n" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.applied).toHaveLength(2);
    expect(result.plan).toContain("- [ ] Do A1");
    expect(result.plan).toContain("- [ ] Do A2 (refined)");
  });

  it("records no-match failure when before is not in section", () => {
    const result = applyEdits(PLAN, [
      { section: "Steps", before: "- [ ] Do thing Z\n", after: "x" },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("no-match");
    expect(result.applied).toHaveLength(0);
    expect(result.plan).toBe(PLAN);
  });

  it("emits diagnostic when plan-wide search would have matched", () => {
    const result = applyEdits(PLAN, [
      { section: "Steps", before: "Some context paragraph.", after: "x" },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("no-match");
    expect(result.failures[0].diagnostic).toContain("would have matched");
  });

  it("records multi-match failure when before appears more than once in section", () => {
    const plan = `# T\n## Steps\n\nfoo\nfoo\n`;
    const result = applyEdits(plan, [
      { section: "Steps", before: "foo", after: "bar" },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("multi-match");
  });

  it("rejects edits to the **planpong:** status line", () => {
    const result = applyEdits(PLAN, [
      { section: "Test Plan", before: "**planpong:** R0/10 | x → y | Awaiting review", after: "**planpong:** R99/10 | tampered" },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("status-line");
    expect(result.plan).toContain("Awaiting review");
  });

  it("performs deletion when after is empty", () => {
    const result = applyEdits(PLAN, [
      { section: "Steps", before: "- [ ] Do thing C\n", after: "" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.plan).not.toContain("Do thing C");
  });

  it("returns plan unchanged for empty edits list", () => {
    const result = applyEdits(PLAN, []);
    expect(result.plan).toBe(PLAN);
    expect(result.applied).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });

  it("normalizes trailing whitespace when matching before", () => {
    const planWithTrailingSpaces = "# T\n## Steps\n\nhello \nworld\n";
    const result = applyEdits(planWithTrailingSpaces, [
      { section: "Steps", before: "hello\nworld", after: "goodbye" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.plan).toContain("goodbye");
  });

  it("scopes edits to the named section when before appears in two sections", () => {
    const plan = `# T\n## A\n\nfoo\n\n## B\n\nfoo\n`;
    const result = applyEdits(plan, [
      { section: "B", before: "foo", after: "bar" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(result.plan).toMatch(/## A\n\nfoo\n\n## B\n\nbar\n/);
  });

  it("ignores headings inside fenced code blocks", () => {
    const plan = `# T\n## Real\n\n\`\`\`\n## Fake heading inside fence\n\`\`\`\n\nbody\n`;
    const result = applyEdits(plan, [
      { section: "Real", before: "body\n", after: "REPLACED\n" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.plan).toContain("REPLACED");
  });

  it("normalizes CRLF in plan content before matching", () => {
    const plan = `# T\r\n## Steps\r\n\r\nhello\r\nworld\r\n`;
    const result = applyEdits(plan, [
      { section: "Steps", before: "hello\nworld", after: "goodbye" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.plan).toContain("goodbye");
  });

  it("uses first match for duplicate heading labels", () => {
    const plan = `# T\n## Notes\n\nfirst body\n\n## Notes\n\nsecond body\n`;
    const result = applyEdits(plan, [
      { section: "Notes", before: "first body", after: "REPLACED" },
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.plan).toContain("REPLACED");
    expect(result.plan).toContain("second body");
  });

  it("reports section-not-found when section heading does not exist", () => {
    const result = applyEdits(PLAN, [
      { section: "Nonexistent", before: "x", after: "y" },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("section-not-found");
  });
});
