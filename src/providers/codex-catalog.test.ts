import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// getModelCatalog shells out to `codex debug models`; mock execa so these
// tests cover the live and fallback paths without a codex install.
const execaMock = vi.fn();
vi.mock("execa", () => ({ execa: (...args: unknown[]) => execaMock(...args) }));

const { CodexProvider } = await import("./codex.js");

const CATALOG = readFileSync(
  new URL("./__fixtures__/codex-debug-models.json", import.meta.url),
  "utf-8",
);

describe("CodexProvider.getModelCatalog", () => {
  beforeEach(() => execaMock.mockReset());

  it("returns a live catalog from codex debug models", async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stdout: CATALOG });
    const catalog = await new CodexProvider().getModelCatalog();
    expect(catalog.source).toBe("live");
    expect(catalog.note).toBeUndefined();
    expect(catalog.models).toHaveLength(7);
    expect(catalog.advisories.ultra).toMatch(/task delegation/);
    expect(execaMock).toHaveBeenCalledWith(
      "codex",
      ["debug", "models"],
      expect.objectContaining({ timeout: 5_000, reject: false }),
    );
  });

  it("falls back to the built-in list with a note on non-zero exit", async () => {
    execaMock.mockResolvedValue({ exitCode: 2, stdout: "" });
    const catalog = await new CodexProvider().getModelCatalog();
    expect(catalog.source).toBe("static");
    expect(catalog.note).toBe("codex model discovery failed (exit 2); showing built-in list");
    expect(catalog.models.map((m) => m.id)).toContain("gpt-6-astra");
  });

  it("falls back with the parse reason on malformed output", async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stdout: "not json" });
    const catalog = await new CodexProvider().getModelCatalog();
    expect(catalog.note).toContain("output was not JSON");
  });

  it("falls back when codex is not installed (execa resolves with ENOENT under reject: false)", async () => {
    execaMock.mockResolvedValue({ failed: true, code: "ENOENT", exitCode: undefined, timedOut: false });
    const catalog = await new CodexProvider().getModelCatalog();
    expect(catalog.source).toBe("static");
    expect(catalog.note).toBe("codex model discovery failed (could not run codex (ENOENT)); showing built-in list");
  });

  it("falls back with 'timed out' when the 5s timeout fires", async () => {
    execaMock.mockResolvedValue({ failed: true, timedOut: true, exitCode: undefined });
    const catalog = await new CodexProvider().getModelCatalog();
    expect(catalog.note).toContain("(timed out)");
  });

  it("caches the catalog per instance", async () => {
    execaMock.mockResolvedValue({ exitCode: 0, stdout: CATALOG });
    const provider = new CodexProvider();
    await provider.getModelCatalog();
    await provider.getModelCatalog();
    expect(execaMock).toHaveBeenCalledTimes(1);
  });
});
