import { describe, it, expect } from "vitest";
import { getUnknownValueWarning } from "./config.js";
import { buildCatalog } from "../../providers/shared.js";
import type { ModelCatalog } from "../../providers/types.js";

// Injected catalogs keep these tests independent of installed CLIs.
const CATALOGS: Record<string, ModelCatalog> = {
  codex: buildCatalog(
    "live",
    [
      { id: "gpt-6-astra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
      { id: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"] },
    ],
    { advisories: { ultra: "ultra enables automatic task delegation" } },
  ),
  claude: buildCatalog("static", [
    { id: "opus", efforts: ["low", "medium", "high", "xhigh", "max"] },
  ]),
};
const getCatalog = async (name: string) => CATALOGS[name] ?? null;
const warn = (key: string, value: string, provider: string | undefined, pinnedModel?: string) =>
  getUnknownValueWarning(key, value, provider, { getCatalog, pinnedModel });

describe("getUnknownValueWarning", () => {
  it("returns null for a known provider", async () => {
    expect(await warn("planner.provider", "claude", undefined)).toBeNull();
    expect(await warn("reviewer.provider", "gemini", undefined)).toBeNull();
  });

  it("warns for an unknown provider with the known list", async () => {
    const w = await warn("planner.provider", "gemnii", undefined);
    expect(w).toMatch(/not a known provider/);
    expect(w).toMatch(/claude/);
  });

  it("returns null for a known model", async () => {
    expect(await warn("planner.model", "opus", "claude")).toBeNull();
    expect(await warn("reviewer.model", "gpt-6-astra", "codex")).toBeNull();
  });

  it("warns for an unknown model with the catalog list", async () => {
    const w = await warn("reviewer.model", "gpt-5.3-codex", "codex");
    expect(w).toMatch(/not in codex's known model list/);
    expect(w).toMatch(/gpt-6-astra/);
    expect(w).toMatch(/may still accept it/);
  });

  it("with no pinned model: a level every model supports is fine", async () => {
    expect(await warn("reviewer.effort", "xhigh", "codex")).toBeNull();
  });

  it("with no pinned model: a level only some models support gets a model-dependent warning", async () => {
    const w = await warn("reviewer.effort", "max", "codex");
    expect(w).toBe(
      "Warning: \"max\" is not supported by every codex model; pin reviewer.model to one that supports it.",
    );
  });

  it("with no pinned model: a level no model supports is unknown", async () => {
    const w = await warn("reviewer.effort", "xtreme", "codex");
    expect(w).toMatch(/not in codex's known effort level list/);
  });

  it("with a pinned model: checks that model's levels", async () => {
    expect(await warn("reviewer.effort", "max", "codex", "gpt-6-astra")).toBeNull();
    expect(await warn("reviewer.effort", "max", "codex", "gpt-5.5")).toMatch(
      /not supported by gpt-5.5 \(low, medium, high, xhigh\)/,
    );
  });

  it("appends the advisory for flagged levels", async () => {
    expect(await warn("reviewer.effort", "ultra", "codex", "gpt-6-astra")).toBe(
      "Note: ultra enables automatic task delegation",
    );
  });

  it("returns null when the role's provider can't be resolved", async () => {
    expect(await warn("planner.model", "anything", undefined)).toBeNull();
    expect(await warn("planner.model", "anything", "nonexistent")).toBeNull();
  });

  it("returns null for keys outside the model/effort/provider set", async () => {
    expect(await warn("max_rounds", "10", "claude")).toBeNull();
    expect(await warn("plans_dir", "docs/plans", "claude")).toBeNull();
    expect(await warn("planner_mode", "inline", "claude")).toBeNull();
  });
});
