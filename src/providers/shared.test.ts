import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertMutuallyExclusiveSessions,
  logClassificationFailure,
} from "./shared.js";

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

  it("truncates stderr to 500 characters", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const long = "x".repeat(800);
    logClassificationFailure("gemini", 1, long);
    const written = spy.mock.calls[0]?.[0] as string;
    expect(written).toBe(`[gemini-provider] exit=1 stderr=${"x".repeat(500)}\n`);
  });

  it("handles undefined stderr without throwing", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logClassificationFailure("claude", 1, undefined);
    expect(spy).toHaveBeenCalledWith("[claude-provider] exit=1 stderr=\n");
  });
});
