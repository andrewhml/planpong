import { describe, it, expect } from "vitest";
import {
  GeminiProvider,
  buildArgs,
  extractResponse,
  classifyError,
} from "./gemini.js";

describe("buildArgs", () => {
  it("emits -p with empty string, --skip-trust, and --output-format json by default", () => {
    const args = buildArgs({ cwd: "/tmp" });
    expect(args).toEqual(["-p", "", "--skip-trust", "--output-format", "json"]);
  });

  it("appends -m <model> when model is set", () => {
    const args = buildArgs({ cwd: "/tmp", model: "gemini-2.5-pro" });
    expect(args).toEqual([
      "-p",
      "",
      "--skip-trust",
      "--output-format",
      "json",
      "-m",
      "gemini-2.5-pro",
    ]);
  });

  it("ignores newSessionId and resumeSessionId (v1: no resumption)", () => {
    const args = buildArgs({
      cwd: "/tmp",
      newSessionId: "11111111-1111-1111-1111-111111111111",
      resumeSessionId: "22222222-2222-2222-2222-222222222222",
    });
    expect(args).toEqual(["-p", "", "--skip-trust", "--output-format", "json"]);
  });

  it("ignores effort (gemini has no effort flag)", () => {
    const args = buildArgs({ cwd: "/tmp", effort: "high" });
    expect(args).toEqual(["-p", "", "--skip-trust", "--output-format", "json"]);
  });

  it("always includes --skip-trust to bypass the CLI 0.32 trusted-folder gate", () => {
    // Without --skip-trust, gemini CLI 0.32+ exits 55 in any directory the
    // user has not interactively acknowledged as trusted, blocking planpong
    // in fresh repos, temp dirs, and CI shells. Pin the flag's presence so
    // a refactor of buildArgs cannot silently regress it.
    expect(buildArgs({ cwd: "/tmp" })).toContain("--skip-trust");
    expect(buildArgs({ cwd: "/tmp", model: "gemini-2.5-pro" })).toContain(
      "--skip-trust",
    );
  });
});

describe("extractResponse", () => {
  it("returns the response field on success", () => {
    const stdout = JSON.stringify({
      session_id: "abc",
      response: "hello world",
      stats: {},
    });
    expect(extractResponse(stdout)).toEqual({
      ok: true,
      text: "hello world",
    });
  });

  it("returns ok:false with the error message when envelope has error", () => {
    const stdout = JSON.stringify({
      session_id: "abc",
      error: { type: "Error", message: "auth required", code: 41 },
    });
    expect(extractResponse(stdout)).toEqual({
      ok: false,
      message: "auth required",
      code: 41,
    });
  });

  it("returns ok:false with parse-failure marker on non-JSON stdout", () => {
    expect(extractResponse("not json at all")).toEqual({
      ok: false,
      message: "could not parse gemini JSON envelope",
      code: undefined,
    });
  });

  it("returns ok:false when envelope lacks both response and error", () => {
    const stdout = JSON.stringify({ session_id: "abc" });
    expect(extractResponse(stdout)).toEqual({
      ok: false,
      message: "gemini envelope missing response and error fields",
      code: undefined,
    });
  });
});

describe("classifyError", () => {
  it("classifies empty stderr + non-zero exit as fatal", () => {
    const err = classifyError("", 1);
    expect(err.kind).toBe("fatal");
    expect(err.exitCode).toBe(1);
  });

  it("includes stderr substring in message when present", () => {
    const err = classifyError("auth not configured", 41);
    expect(err.kind).toBe("fatal");
    expect(err.message).toContain("auth not configured");
    expect(err.exitCode).toBe(41);
  });

  it("never emits capability kind (v1: gemini never requests a schema)", () => {
    const err = classifyError("unknown flag --json-schema", 2);
    expect(err.kind).toBe("fatal");
  });
});

describe("GeminiProvider", () => {
  it("name is 'gemini'", () => {
    expect(new GeminiProvider().name).toBe("gemini");
  });

  it("getModels returns gemini-2.5-pro first as the wizard default", () => {
    const models = new GeminiProvider().getModels();
    expect(models[0]).toBe("gemini-2.5-pro");
    expect(models).toContain("gemini-3-pro");
    expect(models).toContain("gemini-2.5-flash");
  });

  it("getEffortLevels returns ['default'] (no native effort flag)", () => {
    expect(new GeminiProvider().getEffortLevels()).toEqual(["default"]);
  });

  it("checkStructuredOutputSupport returns false without invoking the CLI", async () => {
    const provider = new GeminiProvider();
    const supported = await provider.checkStructuredOutputSupport();
    expect(supported).toBe(false);
  });

  it("markNonCapable does not throw and keeps support false", async () => {
    const provider = new GeminiProvider();
    provider.markNonCapable();
    expect(await provider.checkStructuredOutputSupport()).toBe(false);
  });

  it("invoke throws when both newSessionId and resumeSessionId are set", async () => {
    const provider = new GeminiProvider();
    await expect(
      provider.invoke("hi", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(
      "gemini provider: newSessionId and resumeSessionId are mutually exclusive",
    );
  });
});
