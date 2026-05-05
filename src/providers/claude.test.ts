import { describe, it, expect } from "vitest";
import {
  ClaudeProvider,
  classifyError,
  extractStructuredOutput,
} from "./claude.js";

describe("extractStructuredOutput", () => {
  it("returns the structured_output as a JSON string when present", () => {
    const envelope = {
      type: "result",
      is_error: false,
      result: "",
      structured_output: { foo: "bar", n: 1 },
    };
    expect(extractStructuredOutput(JSON.stringify(envelope))).toBe(
      JSON.stringify({ foo: "bar", n: 1 }),
    );
  });

  it("returns null when structured_output is missing", () => {
    const envelope = { type: "result", is_error: false, result: "hello" };
    expect(extractStructuredOutput(JSON.stringify(envelope))).toBeNull();
  });

  it("returns null when structured_output is null", () => {
    const envelope = { type: "result", structured_output: null };
    expect(extractStructuredOutput(JSON.stringify(envelope))).toBeNull();
  });

  it("returns null when structured_output is a primitive (not an object)", () => {
    const envelope = { type: "result", structured_output: "not an object" };
    expect(extractStructuredOutput(JSON.stringify(envelope))).toBeNull();
  });

  it("returns null when stdout is not JSON", () => {
    expect(extractStructuredOutput("not json at all")).toBeNull();
  });

  it("returns null when stdout is empty", () => {
    expect(extractStructuredOutput("")).toBeNull();
  });
});

describe("classifyError", () => {
  it("returns fatal kind when stderr contains no capability indicators", () => {
    const err = classifyError("connection refused", 1);
    expect(err.kind).toBe("fatal");
    expect(err.exitCode).toBe(1);
  });

  it("classifies 'unknown flag' as capability", () => {
    expect(classifyError("Error: unknown flag --json-schema", 2).kind).toBe(
      "capability",
    );
  });

  it("classifies 'unknown option' as capability", () => {
    expect(classifyError("unknown option foo", 2).kind).toBe("capability");
  });

  it("classifies 'unrecognized' as capability", () => {
    expect(classifyError("unrecognized argument", 2).kind).toBe("capability");
  });

  it("classifies 'invalid schema' as capability", () => {
    expect(classifyError("invalid schema provided", 2).kind).toBe("capability");
  });

  it("classifies 'json-schema' as capability", () => {
    expect(classifyError("json-schema parse error", 2).kind).toBe("capability");
  });

  it("classifies 'unsupported' as capability", () => {
    expect(classifyError("flag is unsupported", 2).kind).toBe("capability");
  });

  it("matches indicators case-insensitively", () => {
    expect(classifyError("UNKNOWN FLAG", 2).kind).toBe("capability");
  });

  it("falls back to a synthetic message when stderr is empty", () => {
    const err = classifyError("", 137);
    expect(err.message).toBe("claude exited with code 137");
    expect(err.exitCode).toBe(137);
  });

  it("truncates stderr to 500 characters in the message field", () => {
    const long = "x".repeat(800);
    const err = classifyError(long, 1);
    expect(err.message.length).toBe(500);
  });

  it("preserves the raw stderr on the error object", () => {
    const long = "y".repeat(800);
    const err = classifyError(long, 1);
    expect(err.stderr).toBe(long);
  });
});

describe("ClaudeProvider", () => {
  it("name is 'claude'", () => {
    expect(new ClaudeProvider().name).toBe("claude");
  });

  it("getModels returns opus first as the highest-reasoning default", () => {
    const models = new ClaudeProvider().getModels();
    expect(models[0]).toBe("opus");
    expect(models).toContain("sonnet");
    expect(models).toContain("haiku");
  });

  it("getEffortLevels returns ['default'] (effort maps to model selection)", () => {
    expect(new ClaudeProvider().getEffortLevels()).toEqual(["default"]);
  });

  it("invoke throws when both newSessionId and resumeSessionId are set", async () => {
    const provider = new ClaudeProvider();
    await expect(
      provider.invoke("hi", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(
      "claude provider: newSessionId and resumeSessionId are mutually exclusive",
    );
  });
});
