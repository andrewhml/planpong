import { describe, it, expect } from "vitest";
import {
  ClaudeProvider,
  classifyError,
  extractEnvelopeError,
  extractStructuredOutput,
  interpretStructuredResult,
} from "./claude.js";

// Captured 2026-09-25 from claude 2.1.282 with --model claude-nonexistent-9
// (session, cost, and usage fields trimmed).
const UNKNOWN_MODEL_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: true,
  api_error_status: 404,
  result:
    "There's an issue with the selected model (claude-nonexistent-9). It may not exist or you may not have access to it. Run --model to pick a different model.",
  structured_output: null,
});
const UNKNOWN_MODEL_STDERR =
  '[claude-code:unrecognized_model] {"model":"claude-nonexistent-9","query_source":"sdk"}';

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

  it("caps the message at 800 characters, keeping the tail", () => {
    const long = "a".repeat(500) + "z".repeat(800);
    const err = classifyError(long, 1);
    expect(err.message).toBe("z".repeat(800));
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

describe("extractEnvelopeError", () => {
  it("detects is_error even when subtype is success", () => {
    expect(extractEnvelopeError(UNKNOWN_MODEL_ENVELOPE)).toContain("selected model");
  });

  it("detects error subtypes", () => {
    const env = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: false });
    expect(extractEnvelopeError(env)).toContain("error_max_turns");
  });

  it("returns null for a successful envelope", () => {
    const env = JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { a: 1 } });
    expect(extractEnvelopeError(env)).toBeNull();
  });

  it("returns null for non-JSON stdout", () => {
    expect(extractEnvelopeError("plain text")).toBeNull();
  });
});

describe("interpretStructuredResult", () => {
  it("unknown-model error envelope is fatal, not capability", () => {
    const r = interpretStructuredResult({
      stdout: UNKNOWN_MODEL_ENVELOPE,
      stderr: UNKNOWN_MODEL_STDERR,
      exitCode: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("fatal");
    expect(r.error.message).toContain("claude-nonexistent-9");
  });

  it("auth-error envelope is fatal", () => {
    const env = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Invalid API key. Please run /login" });
    const r = interpretStructuredResult({ stdout: env, stderr: "", exitCode: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("fatal");
  });

  it("schema rejection inside an error envelope is capability", () => {
    const env = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "invalid json schema provided" });
    const r = interpretStructuredResult({ stdout: env, stderr: "", exitCode: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("capability");
  });

  it("successful envelope without structured_output stays capability", () => {
    const env = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "" });
    const r = interpretStructuredResult({ stdout: env, stderr: "", exitCode: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("capability");
  });

  it("successful envelope with structured_output returns it", () => {
    const env = JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { a: "b" } });
    expect(interpretStructuredResult({ stdout: env, stderr: "", exitCode: 0 })).toEqual({ ok: true, output: '{"a":"b"}' });
  });

  it("unknown option on stderr with empty stdout stays capability (unchanged)", () => {
    expect(classifyError("error: unknown option '--json-schema'", 1).kind).toBe("capability");
  });
});
