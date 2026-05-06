import { describe, it, expect } from "vitest";
import { getUnknownValueWarning } from "./config.js";

describe("getUnknownValueWarning", () => {
  it("returns null for a known provider", () => {
    expect(getUnknownValueWarning("planner.provider", "claude", undefined)).toBeNull();
    expect(getUnknownValueWarning("reviewer.provider", "gemini", undefined)).toBeNull();
  });

  it("warns for an unknown provider with the known list", () => {
    const w = getUnknownValueWarning("planner.provider", "gemnii", undefined);
    expect(w).toMatch(/not a known provider/);
    expect(w).toMatch(/claude/);
    expect(w).toMatch(/codex/);
    expect(w).toMatch(/gemini/);
  });

  it("returns null for a known model on the active provider", () => {
    expect(getUnknownValueWarning("planner.model", "opus", "claude")).toBeNull();
    expect(getUnknownValueWarning("reviewer.model", "gpt-5.3-codex", "codex")).toBeNull();
  });

  it("warns for an unknown model with the provider's enumerated list", () => {
    const w = getUnknownValueWarning("planner.model", "totally-fake", "claude");
    expect(w).toMatch(/not in claude's known model list/);
    expect(w).toMatch(/opus/);
    expect(w).toMatch(/may still accept it/);
  });

  it("returns null for a known effort level on codex", () => {
    expect(getUnknownValueWarning("reviewer.effort", "xhigh", "codex")).toBeNull();
  });

  it("warns for an unknown effort level", () => {
    const w = getUnknownValueWarning("reviewer.effort", "xtreme", "codex");
    expect(w).toMatch(/not in codex's known effort level list/);
    expect(w).toMatch(/xhigh/);
  });

  it("returns null when the role's provider can't be resolved", () => {
    expect(getUnknownValueWarning("planner.model", "anything", undefined)).toBeNull();
    expect(getUnknownValueWarning("planner.model", "anything", "nonexistent")).toBeNull();
  });

  it("returns null for keys outside the model/effort/provider set", () => {
    expect(getUnknownValueWarning("max_rounds", "10", "claude")).toBeNull();
    expect(getUnknownValueWarning("plans_dir", "docs/plans", "claude")).toBeNull();
    expect(getUnknownValueWarning("planner_mode", "inline", "claude")).toBeNull();
  });
});
