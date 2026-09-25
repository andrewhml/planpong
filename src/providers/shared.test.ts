import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertMutuallyExclusiveSessions,
  logClassificationFailure,
  summarizeStderr,
} from "./shared.js";
import { readFileSync } from "node:fs";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8");

describe("assertMutuallyExclusiveSessions", () => {
  it("throws when both newSessionId and resumeSessionId are set", () => {
    expect(() =>
      assertMutuallyExclusiveSessions("test", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).toThrow(
      "test provider: newSessionId and resumeSessionId are mutually exclusive",
    );
  });

  it("does not throw when only newSessionId is set", () => {
    expect(() =>
      assertMutuallyExclusiveSessions("test", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
      }),
    ).not.toThrow();
  });

  it("does not throw when only resumeSessionId is set", () => {
    expect(() =>
      assertMutuallyExclusiveSessions("test", {
        cwd: "/tmp",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).not.toThrow();
  });

  it("does not throw when neither is set", () => {
    expect(() =>
      assertMutuallyExclusiveSessions("test", { cwd: "/tmp" }),
    ).not.toThrow();
  });

  it("includes the provider name in the error message", () => {
    expect(() =>
      assertMutuallyExclusiveSessions("foobar", {
        cwd: "/tmp",
        newSessionId: "a",
        resumeSessionId: "b",
      }),
    ).toThrow(/^foobar provider:/);
  });
});

describe("logClassificationFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a single line to stderr in [<name>-provider] format", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logClassificationFailure("claude", 1, "auth required");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "[claude-provider] exit=1 stderr=auth required\n",
    );
  });

  it("uses the provider name verbatim in the prefix", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logClassificationFailure("codex", 42, "bad");
    expect(spy.mock.calls[0]?.[0]).toMatch(/^\[codex-provider\] /);
  });

  it("logs the summarized error line, not the head of stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logClassificationFailure("gemini", 1, "banner line\nError: real cause\n    at frame (x.js:1:1)");
    const written = spy.mock.calls[0]?.[0] as string;
    expect(written).toBe("[gemini-provider] exit=1 stderr=Error: real cause\n");
  });

  it("handles undefined stderr without throwing", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logClassificationFailure("claude", 1, undefined);
    expect(spy).toHaveBeenCalledWith("[claude-provider] exit=1 stderr=\n");
  });
});

describe("summarizeStderr", () => {
  it("returns the last error-like line, skipping stack frames", () => {
    const text = "Starting up\nError: first\n    at a (x.js:1:1)\nFatal failure here\n    at b (y.js:2:2)";
    expect(summarizeStderr(text)).toBe("Fatal failure here");
  });

  it("strips ANSI color codes", () => {
    expect(summarizeStderr("\x1b[31mError: red\x1b[0m")).toBe("Error: red");
  });

  it("falls back to the tail when no line looks like an error", () => {
    expect(summarizeStderr("one\ntwo\nthree", 9)).toBe("two\nthree");
  });

  it("returns an empty string for empty input", () => {
    expect(summarizeStderr("")).toBe("");
  });

  it("surfaces the real cause from captured gemini stderr", () => {
    const summary = summarizeStderr(fixture("gemini-ineligible.stderr.txt"));
    expect(summary).toContain("IneligibleTierError");
    expect(summary).not.toMatch(/^\s+at /);
  });
});
