import { describe, it, expect } from "vitest";
import {
  ClaudeProvider,
  classifyError,
  extractEnvelopeError,
  extractStructuredOutput,
  interpretStructuredResult,
  parseClaudeHelp,
  resolveEffortArgs,
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

  it("getModels returns the self-updating aliases, fable first", () => {
    expect(new ClaudeProvider().getModels()).toEqual(["fable", "opus", "sonnet", "haiku"]);
  });

  it("getEffortLevels returns the --effort values", () => {
    expect(new ClaudeProvider().getEffortLevels()).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("getModelCatalog is static with every alias accepting every effort", async () => {
    const catalog = await new ClaudeProvider().getModelCatalog();
    expect(catalog.source).toBe("static");
    expect(catalog.models.map((m) => m.id)).toEqual(["fable", "opus", "sonnet", "haiku"]);
    expect(catalog.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
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

// Excerpt of `claude --help` from claude 2.1.282.
const HELP_WITH_EFFORT = [
  "  --disallowedTools, --disallowed-tools <tools...>",
  "  --effort <level>                      Effort level for the current session",
  "                                        (low, medium, high, xhigh, max)",
  "  --environment <environment_id>        Create a new cloud session that runs on",
  "  --json-schema <schema>                JSON Schema for structured output",
].join("\n");
const HELP_WITHOUT_EFFORT = "  --json-schema <schema>   JSON Schema for structured output\n  --model <model>  Model";

describe("parseClaudeHelp", () => {
  it("reads --effort support and its advertised values", () => {
    expect(parseClaudeHelp(HELP_WITH_EFFORT)).toEqual({
      supportsJsonSchema: true,
      supportsEffort: true,
      advertisedEfforts: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  it("reports no effort support on an older CLI", () => {
    expect(parseClaudeHelp(HELP_WITHOUT_EFFORT)).toEqual({
      supportsJsonSchema: true,
      supportsEffort: false,
      advertisedEfforts: null,
    });
  });

  it("does not borrow a parenthetical from the next option", () => {
    const help = "  --effort <level>   Effort level\n  --other <x>   Something (a, b)";
    expect(parseClaudeHelp(help).advertisedEfforts).toBeNull();
  });
});

describe("resolveEffortArgs", () => {
  const current = parseClaudeHelp(HELP_WITH_EFFORT);

  it("passes --effort when set and advertised", () => {
    expect(resolveEffortArgs("high", current)).toEqual({ args: ["--effort", "high"] });
  });

  it("omits the flag for unset and 'default'", () => {
    expect(resolveEffortArgs(undefined, current)).toEqual({ args: [] });
    expect(resolveEffortArgs("default", current)).toEqual({ args: [] });
  });

  it("omits with a warning when the CLI lacks --effort", () => {
    const r = resolveEffortArgs("high", parseClaudeHelp(HELP_WITHOUT_EFFORT));
    expect(r.args).toEqual([]);
    expect(r.warning).toMatch(/does not support --effort; ignoring effort=high/);
  });

  it("omits with a warning naming valid values when the value is not advertised", () => {
    const r = resolveEffortArgs("ultra", current);
    expect(r.args).toEqual([]);
    expect(r.warning).toContain("Valid values: low, medium, high, xhigh, max");
  });

  it("passes the value through when help lists no values", () => {
    const help = { supportsJsonSchema: true, supportsEffort: true, advertisedEfforts: null };
    expect(resolveEffortArgs("max", help)).toEqual({ args: ["--effort", "max"] });
  });
});

describe("effort warnings never become failures", () => {
  it("stdout present with an Unknown --effort warning on stderr is ok and not capability", () => {
    const env = JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { a: 1 } });
    const r = interpretStructuredResult({
      stdout: env,
      stderr: "Warning: Unknown --effort value 'bogus', ignoring it and using the default effort.",
      exitCode: 0,
    });
    expect(r.ok).toBe(true);
  });
});
