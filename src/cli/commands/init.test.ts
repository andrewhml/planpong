import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answersToPicks,
  readDiskSnapshot,
  formatPostWriteSummary,
  isInteractiveTty,
  effortLabel,
  buildModelChoices,
  buildEffortChoices,
  CLI_DEFAULT,
  type WizardAnswers,
  type DiskSnapshot,
} from "./init.js";
import { setConfigValuesBatch } from "../../config/mutate.js";
import { buildCatalog } from "../../providers/shared.js";

// Shape of the live codex catalog on 2026-09-25, trimmed.
const CODEX_CATALOG = buildCatalog(
  "live",
  [
    { id: "gpt-6-astra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
    { id: "gpt-6-luna", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"] },
  ],
  { advisories: { ultra: "delegation" } },
);
const GEMINI_CATALOG = buildCatalog("static", [{ id: "gemini-2.5-pro", efforts: [] }]);

const baseAnswers: WizardAnswers = {
  plannerProvider: "claude",
  plannerModel: "opus",
  reviewerProvider: "codex",
  reviewerModel: "gpt-6-astra",
  maxRounds: 10,
  plansDir: "docs/plans",
  plannerMode: "inline",
  revisionMode: "full",
  humanInLoop: true,
};

describe("answersToPicks", () => {
  it("emits all picks when on-disk file is empty", () => {
    const picks = answersToPicks(baseAnswers, {});
    const keys = picks.map((p) => p.key);
    expect(keys).toEqual([
      "planner.provider",
      "planner.model",
      "reviewer.provider",
      "reviewer.model",
      "max_rounds",
      "plans_dir",
      "planner_mode",
      "revision_mode",
      "human_in_loop",
    ]);
  });

  it("omits keys whose final answer matches the on-disk value", () => {
    const disk: DiskSnapshot = {
      planner: { provider: "claude", model: "opus" },
      reviewer: { provider: "codex", model: "gpt-6-astra" },
      max_rounds: 10,
      plans_dir: "docs/plans",
      planner_mode: "inline",
      revision_mode: "full",
      human_in_loop: true,
    };
    expect(answersToPicks(baseAnswers, disk)).toEqual([]);
  });

  it("includes only keys that changed", () => {
    const disk: DiskSnapshot = {
      planner: { provider: "claude", model: "opus" },
      reviewer: { provider: "codex", model: "gpt-6-astra" },
      max_rounds: 10,
      plans_dir: "docs/plans",
      planner_mode: "inline",
      revision_mode: "full",
      human_in_loop: true,
    };
    const changed: WizardAnswers = { ...baseAnswers, maxRounds: 15 };
    const picks = answersToPicks(changed, disk);
    expect(picks).toEqual([{ key: "max_rounds", rawValue: "15" }]);
  });

  it("includes effort picks only when answers provide them (effort prompt fired)", () => {
    const withEffort: WizardAnswers = {
      ...baseAnswers,
      plannerEffort: "high",
      reviewerEffort: "xhigh",
    };
    const picks = answersToPicks(withEffort, {});
    const keys = picks.map((p) => p.key);
    expect(keys).toContain("planner.effort");
    expect(keys).toContain("reviewer.effort");
  });

  it("omits effort picks when answers leave them undefined (single-level provider)", () => {
    const picks = answersToPicks(baseAnswers, {});
    const keys = picks.map((p) => p.key);
    expect(keys).not.toContain("planner.effort");
    expect(keys).not.toContain("reviewer.effort");
  });

  it("emits revision_mode and human_in_loop changes", () => {
    const disk: DiskSnapshot = {
      planner: { provider: "claude", model: "opus" },
      reviewer: { provider: "codex", model: "gpt-6-astra" },
      max_rounds: 10,
      plans_dir: "docs/plans",
      planner_mode: "inline",
      revision_mode: "full",
      human_in_loop: true,
    };
    const changed: WizardAnswers = {
      ...baseAnswers,
      revisionMode: "edits",
      humanInLoop: false,
    };
    const picks = answersToPicks(changed, disk);
    expect(picks).toEqual([
      { key: "revision_mode", rawValue: "edits" },
      { key: "human_in_loop", rawValue: "false" },
    ]);
  });

  it("includes new keys absent from the on-disk file", () => {
    const disk: DiskSnapshot = { max_rounds: 10 };
    const picks = answersToPicks(baseAnswers, disk);
    const keys = picks.map((p) => p.key);
    expect(keys).toContain("planner.provider");
    expect(keys).toContain("reviewer.provider");
    expect(keys).not.toContain("max_rounds");
  });

  it("emits rawValues as strings (max_rounds → '10' not 10)", () => {
    const picks = answersToPicks(baseAnswers, {});
    const maxRoundsPick = picks.find((p) => p.key === "max_rounds");
    expect(maxRoundsPick?.rawValue).toBe("10");
    expect(typeof maxRoundsPick?.rawValue).toBe("string");
  });

  it("treats only the partial planner block as on-disk (provider set, model missing)", () => {
    const disk: DiskSnapshot = {
      planner: { provider: "claude" },
    };
    const picks = answersToPicks(baseAnswers, disk);
    const keys = picks.map((p) => p.key);
    expect(keys).not.toContain("planner.provider");
    expect(keys).toContain("planner.model");
  });
});

describe("readDiskSnapshot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-snapshot-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty snapshot and null path when no config file exists", () => {
    expect(readDiskSnapshot(tmpDir)).toEqual({ path: null, snapshot: {} });
  });

  it("resolves a parent directory's config, the same file the writer targets", () => {
    writeFileSync(join(tmpDir, "planpong.yaml"), "reviewer:\n  provider: codex\n  model: gpt-6-sol\n");
    const child = join(tmpDir, "packages", "app");
    mkdirSync(child, { recursive: true });
    const { path, snapshot } = readDiskSnapshot(child);
    expect(path).toBe(join(tmpDir, "planpong.yaml"));
    expect(snapshot.reviewer?.model).toBe("gpt-6-sol");
  });

  it("returns only fields present in the on-disk file (not merged defaults)", () => {
    writeFileSync(
      join(tmpDir, "planpong.yaml"),
      "max_rounds: 7\nplanner:\n  provider: claude\n",
      "utf-8",
    );
    const snap = readDiskSnapshot(tmpDir).snapshot;
    expect(snap.max_rounds).toBe(7);
    expect(snap.planner?.provider).toBe("claude");
    expect(snap.planner?.model).toBeUndefined();
    expect(snap.reviewer).toBeUndefined();
    expect(snap.plans_dir).toBeUndefined();
    expect(snap.planner_mode).toBeUndefined();
  });

  it("does not pull in defaults like docs/plans or planner_mode=inline", () => {
    writeFileSync(join(tmpDir, "planpong.yaml"), "max_rounds: 10\n", "utf-8");
    const snap = readDiskSnapshot(tmpDir).snapshot;
    expect(snap.plans_dir).toBeUndefined();
    expect(snap.planner_mode).toBeUndefined();
  });
});

describe("formatPostWriteSummary", () => {
  const baseAnswers: WizardAnswers = {
    plannerProvider: "claude",
    plannerModel: "opus",
    reviewerProvider: "codex",
    reviewerModel: "gpt-5.3-codex",
    maxRounds: 10,
    plansDir: "docs/plans",
    plannerMode: "inline",
    revisionMode: "full",
    humanInLoop: true,
  };

  it("includes the gemini auth reminder when gemini is picked as planner", () => {
    const out = formatPostWriteSummary({
      ...baseAnswers,
      plannerProvider: "gemini",
    });
    expect(out).toMatch(/gemini requires Google account auth/);
  });

  it("includes the gemini auth reminder when gemini is picked as reviewer", () => {
    const out = formatPostWriteSummary({
      ...baseAnswers,
      reviewerProvider: "gemini",
    });
    expect(out).toMatch(/gemini requires Google account auth/);
  });

  it("omits the gemini auth reminder when gemini is not picked anywhere", () => {
    const out = formatPostWriteSummary(baseAnswers);
    expect(out).not.toMatch(/gemini requires Google account auth/);
  });

  it("includes the next-step hint pointing at planpong review", () => {
    const out = formatPostWriteSummary(baseAnswers);
    expect(out).toMatch(/planpong review/);
  });
});

describe("isInteractiveTty", () => {
  it("returns true when isTTY === true", () => {
    expect(isInteractiveTty({ isTTY: true })).toBe(true);
  });

  it("returns false when isTTY is undefined (pipe / redirect)", () => {
    expect(isInteractiveTty({})).toBe(false);
  });

  it("returns false when isTTY === false", () => {
    expect(isInteractiveTty({ isTTY: false })).toBe(false);
  });
});

describe("effortLabel", () => {
  it("returns descriptive labels for codex effort levels", () => {
    expect(effortLabel("low")).toMatch(/fastest|cheap/);
    expect(effortLabel("high")).toMatch(/recommended/);
    expect(effortLabel("xhigh")).toMatch(/thorough/);
    expect(effortLabel("max")).toMatch(/slowest|most thorough/);
  });

  it("returns the raw level for unknown values", () => {
    expect(effortLabel("medium")).toBe("medium");
    expect(effortLabel("unknown-future-tier")).toBe("unknown-future-tier");
  });
});

describe("CLI default answers", () => {
  it("fresh config choosing CLI default writes no model or effort keys", () => {
    const answers: WizardAnswers = {
      ...baseAnswers,
      plannerModel: CLI_DEFAULT,
      plannerEffort: CLI_DEFAULT,
      reviewerModel: CLI_DEFAULT,
      reviewerEffort: CLI_DEFAULT,
    };
    const keys = answersToPicks(answers, {}).map((p) => p.key);
    expect(keys).not.toContain("planner.model");
    expect(keys).not.toContain("planner.effort");
    expect(keys).not.toContain("reviewer.model");
    expect(keys).not.toContain("reviewer.effort");
  });

  it("switching an existing pin back to CLI default emits unset picks", () => {
    const disk: DiskSnapshot = { reviewer: { provider: "codex", model: "gpt-6-sol", effort: "max" } };
    const answers: WizardAnswers = { ...baseAnswers, reviewerModel: CLI_DEFAULT, reviewerEffort: CLI_DEFAULT };
    const picks = answersToPicks(answers, disk);
    expect(picks).toContainEqual({ key: "reviewer.model", unset: true });
    expect(picks).toContainEqual({ key: "reviewer.effort", unset: true });
    expect(picks.find((p) => p.key === "reviewer.provider")).toBeUndefined();
  });

  it("never serializes the sentinel as a string", () => {
    const answers: WizardAnswers = { ...baseAnswers, reviewerModel: CLI_DEFAULT };
    const picks = answersToPicks(answers, { reviewer: { model: "x" } });
    expect(picks).toContainEqual({ key: "reviewer.model", unset: true });
    for (const p of picks) {
      if (p.rawValue !== undefined) expect(p.rawValue).not.toMatch(/undefined|Symbol/);
    }
  });
});

describe("buildModelChoices", () => {
  it("lists CLI default first, then catalog models", () => {
    const r = buildModelChoices("codex", CODEX_CATALOG, false, undefined);
    expect(r.choices[0].value).toBe(CLI_DEFAULT);
    expect(r.choices.slice(1).map((c) => c.value)).toEqual(["gpt-6-astra", "gpt-6-luna", "gpt-5.5"]);
    expect(r.default).toBe(CLI_DEFAULT);
  });

  it("unchanged provider preserves and preselects an unknown pinned model", () => {
    const r = buildModelChoices("codex", CODEX_CATALOG, false, "gpt-5.3-codex");
    expect(r.default).toBe("gpt-5.3-codex");
    expect(r.choices.at(-1)).toEqual({ name: "gpt-5.3-codex (current, not in catalog)", value: "gpt-5.3-codex" });
  });

  it("unchanged provider preselects a known pinned model without duplicating it", () => {
    const r = buildModelChoices("codex", CODEX_CATALOG, false, "gpt-6-luna");
    expect(r.default).toBe("gpt-6-luna");
    expect(r.choices.filter((c) => c.value === "gpt-6-luna")).toHaveLength(1);
  });

  it("provider change never offers or preselects the old model", () => {
    const r = buildModelChoices("claude", buildCatalog("static", [{ id: "opus", efforts: [] }]), true, "gpt-6-sol");
    expect(r.default).toBe(CLI_DEFAULT);
    expect(r.choices.map((c) => c.value)).not.toContain("gpt-6-sol");
  });
});

describe("buildEffortChoices", () => {
  it("returns null when the provider has no effort levels", () => {
    expect(buildEffortChoices(GEMINI_CATALOG, CLI_DEFAULT, false, undefined)).toBeNull();
  });

  it("CLI-default model offers only the intersection, with a hint", () => {
    const r = buildEffortChoices(CODEX_CATALOG, CLI_DEFAULT, false, undefined)!;
    expect(r.choices.slice(1).map((c) => c.value)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(r.hint).toBe("pin a model to see its full effort range");
  });

  it("a pinned model offers its own levels minus advisories", () => {
    const r = buildEffortChoices(CODEX_CATALOG, "gpt-6-astra", false, undefined)!;
    expect(r.choices.slice(1).map((c) => c.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("preselects a pinned effort the model supports", () => {
    expect(buildEffortChoices(CODEX_CATALOG, "gpt-6-luna", false, "max")!.default).toBe("max");
  });

  it("falls back to CLI default when the pinned effort is outside the new choices", () => {
    // max pinned, then model set back to CLI default (intersection lacks max)
    expect(buildEffortChoices(CODEX_CATALOG, CLI_DEFAULT, false, "max")!.default).toBe(CLI_DEFAULT);
  });

  it("keeps a current advisory pin visible instead of silently dropping it", () => {
    const r = buildEffortChoices(CODEX_CATALOG, "gpt-6-astra", false, "ultra")!;
    expect(r.default).toBe("ultra");
    expect(r.choices.at(-1)).toEqual({ name: "ultra (current)", value: "ultra" });
  });

  it("provider change preselects CLI default, ignoring the old effort", () => {
    expect(buildEffortChoices(CODEX_CATALOG, "gpt-6-astra", true, "high")!.default).toBe(CLI_DEFAULT);
  });
});

describe("wizard write path (answersToPicks + setConfigValuesBatch)", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-wizard-write-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run from a child dir, CLI default removes the parent file's pins and creates no child file", () => {
    const parentFile = join(tmpDir, "planpong.yaml");
    writeFileSync(parentFile, "reviewer:\n  provider: codex\n  model: gpt-6-sol\n  effort: max\n");
    const child = join(tmpDir, "sub");
    mkdirSync(child);
    const { path, snapshot } = readDiskSnapshot(child);
    const answers: WizardAnswers = { ...baseAnswers, reviewerModel: CLI_DEFAULT, reviewerEffort: CLI_DEFAULT };
    const picks = answersToPicks(answers, snapshot).filter((p) => p.key.startsWith("reviewer."));
    setConfigValuesBatch(child, picks, { configPath: path! });
    const written = readFileSync(parentFile, "utf-8");
    expect(written).toContain("provider: codex");
    expect(written).not.toContain("model:");
    expect(written).not.toContain("effort:");
    expect(existsSync(join(child, "planpong.yaml"))).toBe(false);
  });

  it("provider switch accepting defaults leaves no stale model or effort", () => {
    const file = join(tmpDir, "planpong.yaml");
    writeFileSync(file, "reviewer:\n  provider: codex\n  model: gpt-6-sol\n  effort: max\n");
    const { path, snapshot } = readDiskSnapshot(tmpDir);
    const answers: WizardAnswers = {
      ...baseAnswers,
      reviewerProvider: "claude",
      reviewerModel: CLI_DEFAULT,
      reviewerEffort: CLI_DEFAULT,
    };
    const picks = answersToPicks(answers, snapshot).filter((p) => p.key.startsWith("reviewer."));
    setConfigValuesBatch(tmpDir, picks, { configPath: path! });
    const written = readFileSync(file, "utf-8");
    expect(written).toContain("provider: claude");
    expect(written).not.toContain("gpt-6-sol");
    expect(written).not.toContain("effort:");
  });

  it("provider switch picking an explicit model writes it with no stale effort", () => {
    const file = join(tmpDir, "planpong.yaml");
    writeFileSync(file, "reviewer:\n  provider: codex\n  model: gpt-6-sol\n  effort: max\n");
    const { path, snapshot } = readDiskSnapshot(tmpDir);
    const answers: WizardAnswers = {
      ...baseAnswers,
      reviewerProvider: "claude",
      reviewerModel: "opus",
      reviewerEffort: CLI_DEFAULT,
    };
    const picks = answersToPicks(answers, snapshot).filter((p) => p.key.startsWith("reviewer."));
    setConfigValuesBatch(tmpDir, picks, { configPath: path! });
    const written = readFileSync(file, "utf-8");
    expect(written).toContain("model: opus");
    expect(written).not.toContain("effort:");
  });
});
