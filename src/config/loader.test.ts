import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, __resetGeminiReviewerWarningForTesting } from "./loader.js";

function withConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "planpong-loader-test-"));
  writeFileSync(join(dir, "planpong.yaml"), yaml, "utf-8");
  return dir;
}

describe("gemini reviewer warning", () => {
  beforeEach(() => {
    __resetGeminiReviewerWarningForTesting();
  });

  it("emits the warning to stderr once when reviewer.provider is gemini", () => {
    const cwd = withConfig(`
planner:
  provider: claude
reviewer:
  provider: gemini
`);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    loadConfig({ cwd });

    const calls = spy.mock.calls.map((c) => String(c[0]));
    const matches = calls.filter((c) => c.includes("gemini reviewer rounds"));
    expect(matches.length).toBe(1);

    spy.mockRestore();
  });

  it("does not fire on a second loadConfig call within the same process", () => {
    const cwd = withConfig(`
planner:
  provider: claude
reviewer:
  provider: gemini
`);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    loadConfig({ cwd });
    loadConfig({ cwd });
    loadConfig({ cwd });

    const calls = spy.mock.calls.map((c) => String(c[0]));
    const matches = calls.filter((c) => c.includes("gemini reviewer rounds"));
    expect(matches.length).toBe(1);

    spy.mockRestore();
  });

  it("does not fire when reviewer.provider is not gemini", () => {
    const cwd = withConfig(`
planner:
  provider: claude
reviewer:
  provider: codex
`);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    loadConfig({ cwd });

    const calls = spy.mock.calls.map((c) => String(c[0]));
    const matches = calls.filter((c) => c.includes("gemini reviewer rounds"));
    expect(matches.length).toBe(0);

    spy.mockRestore();
  });

  it("fires when CLI override sets reviewer.provider to gemini", () => {
    const cwd = withConfig(`
planner:
  provider: claude
reviewer:
  provider: codex
`);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    loadConfig({ cwd, overrides: { reviewerProvider: "gemini" } });

    const calls = spy.mock.calls.map((c) => String(c[0]));
    const matches = calls.filter((c) => c.includes("gemini reviewer rounds"));
    expect(matches.length).toBe(1);

    spy.mockRestore();
  });

  it("warning is written to stderr, not stdout", () => {
    const cwd = withConfig(`
planner:
  provider: claude
reviewer:
  provider: gemini
`);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    loadConfig({ cwd });

    const errCalls = errSpy.mock.calls.map((c) => String(c[0]));
    const outCalls = outSpy.mock.calls.map((c) => String(c[0]));
    expect(errCalls.some((c) => c.includes("gemini reviewer rounds"))).toBe(true);
    expect(outCalls.some((c) => c.includes("gemini reviewer rounds"))).toBe(false);

    errSpy.mockRestore();
    outSpy.mockRestore();
  });
});
