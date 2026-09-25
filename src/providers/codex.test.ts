import { describe, it, expect } from "vitest";
import {
  CodexProvider,
  classifyError,
  extractCodexAgentMessage,
  extractCodexError,
  extractCodexThreadId,
  interpretCodexResult,
  parseCodexCatalog,
} from "./codex.js";
import { buildCatalog } from "./shared.js";
import { readFileSync } from "node:fs";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8");

const INVALID_MODEL = fixture("codex-invalid-model.stdout.jsonl");
const SUCCESS = fixture("codex-success.stdout.jsonl");

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

  it("caps the message at 800 characters, keeping the tail", () => {
    const long = "a".repeat(500) + "z".repeat(800);
    expect(classifyError(long, 1).message).toBe("z".repeat(800));
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

  it("getModels returns the built-in snapshot of list-visible models", () => {
    const models = new CodexProvider().getModels();
    expect(models[0]).toBe("gpt-6-astra");
    expect(models).toContain("gpt-5.5");
    expect(models).not.toContain("gpt-5.3-codex");
  });

  it("getEffortLevels returns the codex levels without ultra", () => {
    expect(new CodexProvider().getEffortLevels()).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
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

describe("extractCodexError", () => {
  it("unwraps the 400 reason from a captured invalid-model run", () => {
    const { message } = extractCodexError(INVALID_MODEL);
    expect(message).toBe(
      "400 invalid_request_error: The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
    );
  });

  it("reports the unknown-model metadata item as a warning", () => {
    const { warnings } = extractCodexError(INVALID_MODEL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Model metadata for `gpt-5.3-codex` not found/);
  });

  it("returns no failure for a captured successful run", () => {
    expect(extractCodexError(SUCCESS)).toEqual({ message: undefined, warnings: [] });
  });

  it("ignores a top-level error event when the turn later completes (stream retry)", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t" }),
      JSON.stringify({ type: "error", message: "Reconnecting... 1/5" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");
    expect(extractCodexError(stdout).message).toBeUndefined();
  });

  it("treats a top-level error as terminal when the turn never completes", () => {
    const stdout = JSON.stringify({ type: "error", message: "stream disconnected" });
    expect(extractCodexError(stdout).message).toBe("stream disconnected");
  });
});

describe("extractCodexAgentMessage", () => {
  it("returns the agent message from a captured successful run", () => {
    expect(extractCodexAgentMessage(SUCCESS)).toBe("ok");
  });

  it("returns undefined when there is no agent message", () => {
    expect(extractCodexAgentMessage(INVALID_MODEL)).toBeUndefined();
  });
});

describe("interpretCodexResult", () => {
  const failedRun = { stdout: INVALID_MODEL, stderr: "", exitCode: 1 };

  it("failure events + no output file: fatal with the 400 reason", () => {
    const r = interpretCodexResult({ ...failedRun, fileContent: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("fatal");
    expect(r.error.message).toContain("model is not supported");
  });

  it("failure events + empty output file: fatal", () => {
    const r = interpretCodexResult({ ...failedRun, fileContent: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("fatal");
  });

  it("failure events win even if the output file has content", () => {
    const r = interpretCodexResult({ ...failedRun, fileContent: "partial" });
    expect(r.ok).toBe(false);
  });

  it("success with output file returns the file and thread id", () => {
    const r = interpretCodexResult({ stdout: SUCCESS, stderr: "", exitCode: 0, fileContent: "from file" });
    expect(r).toEqual({ ok: true, output: "from file", sessionId: "01a0d932-d78c-7d21-9b1a-28415aaea2c6" });
  });

  it("success without output file recovers the agent message, never raw stdout", () => {
    const r = interpretCodexResult({ stdout: SUCCESS, stderr: "", exitCode: 0, fileContent: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toBe("ok");
  });

  it("no file and no agent message: failure classified from stderr", () => {
    const r = interpretCodexResult({
      stdout: JSON.stringify({ type: "thread.started", thread_id: "t" }),
      stderr: "error: unexpected argument '--output-schema' found",
      exitCode: 2,
      fileContent: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("capability");
  });

  it("schema rejection reported only in stdout events: capability", () => {
    const stdout = JSON.stringify({
      type: "turn.failed",
      error: { message: "invalid_json_schema: schema is not supported" },
    });
    const r = interpretCodexResult({ stdout, stderr: "", exitCode: 1, fileContent: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("capability");
  });
});

describe("parseCodexCatalog", () => {
  const CATALOG = fixture("codex-debug-models.json");

  it("parses the captured catalog and drops hidden models", () => {
    const r = parseCodexCatalog(CATALOG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.models.map((m) => m.id);
    expect(ids).toEqual([
      "gpt-6-astra", "gpt-6-sol", "gpt-6-luna",
      "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
    ]);
    expect(ids).not.toContain("gpt-reserve");
    expect(r.models.find((m) => m.id === "gpt-5.5")?.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(r.models.find((m) => m.id === "gpt-5.6-sol")?.defaultEffort).toBe("low");
  });

  it("accepts a bare array and entries with only a slug", () => {
    const r = parseCodexCatalog(JSON.stringify([{ slug: "x" }]));
    expect(r).toEqual({ ok: true, models: [{ id: "x", efforts: [] }] });
  });

  it("fails with a reason on malformed JSON", () => {
    expect(parseCodexCatalog("{not json")).toEqual({ ok: false, reason: "output was not JSON" });
  });

  it("fails with a reason on an unknown shape", () => {
    expect(parseCodexCatalog(JSON.stringify({ items: [] }))).toEqual({ ok: false, reason: "unrecognized catalog shape" });
  });

  it("fails when every model is hidden", () => {
    const r = parseCodexCatalog(JSON.stringify({ models: [{ slug: "x", visibility: "hide" }] }));
    expect(r).toEqual({ ok: false, reason: "catalog listed no models" });
  });

  it("builds an intersection that excludes max (gpt-5.5) and a union that includes ultra", () => {
    const r = parseCodexCatalog(CATALOG);
    if (!r.ok) throw new Error("fixture should parse");
    const catalog = buildCatalog("live", r.models);
    expect(catalog.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(catalog.allEfforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });
});
