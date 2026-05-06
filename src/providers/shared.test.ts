import { describe, it, expect } from "vitest";
import { assertMutuallyExclusiveSessions } from "./shared.js";

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
