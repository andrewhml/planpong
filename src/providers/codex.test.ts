import { describe, it, expect } from "vitest";
import {
  CodexProvider,
  classifyError,
  extractCodexThreadId,
} from "./codex.js";

describe("extractCodexThreadId", () => {
  it("returns the thread_id from a thread.started event on the first line", () => {
    const stdout = JSON.stringify({
      type: "thread.started",
      thread_id: "abc-123",
    });
    expect(extractCodexThreadId(stdout)).toBe("abc-123");
  });

  it("returns the thread_id from a thread.resumed event", () => {
    const stdout = JSON.stringify({
      type: "thread.resumed",
      thread_id: "resume-id",
    });
    expect(extractCodexThreadId(stdout)).toBe("resume-id");
  });

  it("scans up to 10 lines for the thread event", () => {
    const lines = [
      "not json line 1",
      "still not json",
      JSON.stringify({ type: "other.event", thread_id: "ignored" }),
      JSON.stringify({ type: "thread.started", thread_id: "found-late" }),
    ];
    expect(extractCodexThreadId(lines.join("\n"))).toBe("found-late");
  });

  it("returns undefined when no event has type thread.started or thread.resumed", () => {
    const stdout = JSON.stringify({
      type: "agent.message",
      thread_id: "nope",
    });
    expect(extractCodexThreadId(stdout)).toBeUndefined();
  });

  it("returns undefined when stdout has malformed JSON in the first lines", () => {
    expect(extractCodexThreadId("{ not valid json\n{ also bad }")).toBeUndefined();
  });

  it("returns undefined when stdout is undefined", () => {
    expect(extractCodexThreadId(undefined)).toBeUndefined();
  });

  it("returns undefined when stdout is empty", () => {
    expect(extractCodexThreadId("")).toBeUndefined();
  });

  it("returns undefined when thread.started lacks a thread_id field", () => {
    const stdout = JSON.stringify({ type: "thread.started" });
    expect(extractCodexThreadId(stdout)).toBeUndefined();
  });
});

describe("classifyError", () => {
  it("returns fatal kind by default", () => {
    expect(classifyError("connection refused", 1).kind).toBe("fatal");
  });

  it("classifies 'unknown flag' (word-bounded) as capability", () => {
    expect(classifyError("Error: unknown flag --output-schema", 2).kind).toBe(
      "capability",
    );
  });

  it("classifies 'unknown option' as capability", () => {
    expect(classifyError("unknown option specified", 2).kind).toBe("capability");
  });

  it("classifies 'unknown argument' as capability", () => {
    expect(classifyError("unknown argument", 2).kind).toBe("capability");
  });

  it("classifies 'unrecognized flag/option/argument' as capability", () => {
    expect(classifyError("unrecognized flag", 2).kind).toBe("capability");
    expect(classifyError("unrecognized option", 2).kind).toBe("capability");
    expect(classifyError("unrecognized argument", 2).kind).toBe("capability");
  });

  it("classifies 'unexpected flag/option/argument' as capability", () => {
    expect(classifyError("unexpected flag --foo", 2).kind).toBe("capability");
  });

  it("classifies 'invalid_json_schema' as capability", () => {
    expect(classifyError("invalid_json_schema returned", 2).kind).toBe(
      "capability",
    );
  });

  it("classifies 'invalid schema' as capability", () => {
    expect(classifyError("invalid schema", 2).kind).toBe("capability");
  });

  it("classifies 'schema is not supported' as capability", () => {
    expect(classifyError("the schema is not supported", 2).kind).toBe(
      "capability",
    );
  });

  it("classifies 'structured output not supported' as capability", () => {
    expect(classifyError("structured output not supported here", 2).kind).toBe(
      "capability",
    );
  });

  it("does not match the bare flag name 'output-schema:' (info-line false positive guard)", () => {
    expect(
      classifyError("session info: output-schema: /tmp/schema.json", 1).kind,
    ).toBe("fatal");
  });

  it("matches case-insensitively", () => {
    expect(classifyError("UNKNOWN FLAG --foo", 2).kind).toBe("capability");
  });

  it("falls back to a synthetic message when stderr is empty", () => {
    const err = classifyError("", 137);
    expect(err.message).toBe("codex exited with code 137");
    expect(err.exitCode).toBe(137);
  });

  it("truncates stderr to 500 characters in the message field", () => {
    const long = "x".repeat(800);
    expect(classifyError(long, 1).message.length).toBe(500);
  });

  it("preserves the raw stderr on the error object", () => {
    const long = "y".repeat(800);
    expect(classifyError(long, 1).stderr).toBe(long);
  });
});

describe("CodexProvider", () => {
  it("name is 'codex'", () => {
    expect(new CodexProvider().name).toBe("codex");
  });

  it("getModels returns gpt-5.3-codex first", () => {
    const models = new CodexProvider().getModels();
    expect(models[0]).toBe("gpt-5.3-codex");
    expect(models).toContain("o3-pro");
    expect(models).toContain("o3");
    expect(models).toContain("o4-mini");
  });

  it("getEffortLevels returns the four codex levels", () => {
    expect(new CodexProvider().getEffortLevels()).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("invoke throws when both newSessionId and resumeSessionId are set", async () => {
    const provider = new CodexProvider();
    await expect(
      provider.invoke("hi", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(
      "codex provider: newSessionId and resumeSessionId are mutually exclusive",
    );
  });
});
