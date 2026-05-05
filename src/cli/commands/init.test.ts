import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answersToPicks,
  readDiskSnapshot,
  formatPostWriteSummary,
  isInteractiveTty,
  type WizardAnswers,
  type DiskSnapshot,
} from "./init.js";

const baseAnswers: WizardAnswers = {
  plannerProvider: "claude",
  plannerModel: "opus",
  reviewerProvider: "codex",
  reviewerModel: "gpt-5.3-codex",
  maxRounds: 10,
  plansDir: "docs/plans",
  plannerMode: "inline",
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
    ]);
  });

  it("omits keys whose final answer matches the on-disk value", () => {
    const disk: DiskSnapshot = {
      planner: { provider: "claude", model: "opus" },
      reviewer: { provider: "codex", model: "gpt-5.3-codex" },
      max_rounds: 10,
      plans_dir: "docs/plans",
      planner_mode: "inline",
    };
    expect(answersToPicks(baseAnswers, disk)).toEqual([]);
  });

  it("includes only keys that changed", () => {
    const disk: DiskSnapshot = {
      planner: { provider: "claude", model: "opus" },
      reviewer: { provider: "codex", model: "gpt-5.3-codex" },
      max_rounds: 10,
      plans_dir: "docs/plans",
      planner_mode: "inline",
    };
    const changed: WizardAnswers = { ...baseAnswers, maxRounds: 15 };
    const picks = answersToPicks(changed, disk);
    expect(picks).toEqual([{ key: "max_rounds", rawValue: "15" }]);
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

  it("returns an empty snapshot when no config file exists", () => {
    expect(readDiskSnapshot(tmpDir)).toEqual({});
  });

  it("returns only fields present in the on-disk file (not merged defaults)", () => {
    writeFileSync(
      join(tmpDir, "planpong.yaml"),
      "max_rounds: 7\nplanner:\n  provider: claude\n",
      "utf-8",
    );
    const snap = readDiskSnapshot(tmpDir);
    expect(snap.max_rounds).toBe(7);
    expect(snap.planner?.provider).toBe("claude");
    expect(snap.planner?.model).toBeUndefined();
    expect(snap.reviewer).toBeUndefined();
    expect(snap.plans_dir).toBeUndefined();
    expect(snap.planner_mode).toBeUndefined();
  });

  it("does not pull in defaults like docs/plans or planner_mode=inline", () => {
    writeFileSync(join(tmpDir, "planpong.yaml"), "max_rounds: 10\n", "utf-8");
    const snap = readDiskSnapshot(tmpDir);
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
