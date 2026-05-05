import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  PlanpongConfigSchema,
  type PlanpongConfig,
} from "../schemas/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";

let geminiReviewerWarningFired = false;

/**
 * Reset the gemini-reviewer-warning gate. Test-only — the gate is a process-
 * lifetime singleton in production so the warning fires exactly once.
 */
export function __resetGeminiReviewerWarningForTesting(): void {
  geminiReviewerWarningFired = false;
}

function maybeEmitGeminiReviewerWarning(config: PlanpongConfig): void {
  if (geminiReviewerWarningFired) return;
  if (config.reviewer.provider !== "gemini") return;
  geminiReviewerWarningFired = true;
  process.stderr.write(
    "warning: gemini reviewer rounds run without persistent session resumption.\n" +
      "         expect noticeably slower per-round wall time than claude/codex.\n" +
      "         tracked: see Future work in docs/plans/gemini-and-init-wizard.md\n",
  );
}

const CONFIG_FILENAMES = [
  "planpong.yaml",
  "planpong.yml",
  ".planpong.yaml",
  ".planpong.yml",
];

/**
 * Search upward from `cwd` for a config file path.
 * Returns the absolute path or null if no file is found.
 */
export function findConfigPath(cwd: string): string | null {
  let dir = cwd;
  const root = "/";

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(dir, filename);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = join(dir, "..");
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  return null;
}

function findConfigFile(cwd: string): Record<string, unknown> | null {
  const path = findConfigPath(cwd);
  if (!path) return null;
  const raw = readFileSync(path, "utf-8");
  return parseYaml(raw) as Record<string, unknown>;
}

export interface LoadConfigOptions {
  cwd: string;
  /** CLI overrides — sparse, merged on top of file + defaults */
  overrides?: Partial<{
    plannerProvider: string;
    plannerModel: string;
    plannerEffort: string;
    reviewerProvider: string;
    reviewerModel: string;
    reviewerEffort: string;
    plansDir: string;
    maxRounds: number;
    autonomous: boolean;
    revisionMode: "edits" | "full";
    plannerMode: "inline" | "external";
  }>;
}

export function loadConfig(options: LoadConfigOptions): PlanpongConfig {
  const fileConfig = findConfigFile(options.cwd) ?? {};
  const overrides = options.overrides ?? {};

  // Merge: defaults < file < CLI overrides
  const merged = {
    planner: {
      provider:
        overrides.plannerProvider ??
        (fileConfig.planner as Record<string, unknown>)?.provider ??
        DEFAULT_CONFIG.planner.provider,
      model:
        overrides.plannerModel ??
        (fileConfig.planner as Record<string, unknown>)?.model ??
        DEFAULT_CONFIG.planner.model,
      effort:
        overrides.plannerEffort ??
        (fileConfig.planner as Record<string, unknown>)?.effort ??
        DEFAULT_CONFIG.planner.effort,
    },
    reviewer: {
      provider:
        overrides.reviewerProvider ??
        (fileConfig.reviewer as Record<string, unknown>)?.provider ??
        DEFAULT_CONFIG.reviewer.provider,
      model:
        overrides.reviewerModel ??
        (fileConfig.reviewer as Record<string, unknown>)?.model ??
        DEFAULT_CONFIG.reviewer.model,
      effort:
        overrides.reviewerEffort ??
        (fileConfig.reviewer as Record<string, unknown>)?.effort ??
        DEFAULT_CONFIG.reviewer.effort,
    },
    plans_dir:
      overrides.plansDir ??
      (fileConfig.plans_dir as string | undefined) ??
      DEFAULT_CONFIG.plans_dir,
    max_rounds:
      overrides.maxRounds ??
      (fileConfig.max_rounds as number | undefined) ??
      DEFAULT_CONFIG.max_rounds,
    human_in_loop:
      overrides.autonomous !== undefined
        ? !overrides.autonomous
        : ((fileConfig.human_in_loop as boolean | undefined) ??
          DEFAULT_CONFIG.human_in_loop),
    revision_mode:
      overrides.revisionMode ??
      (fileConfig.revision_mode as "edits" | "full" | undefined) ??
      DEFAULT_CONFIG.revision_mode,
    planner_mode:
      overrides.plannerMode ??
      (fileConfig.planner_mode as "inline" | "external" | undefined) ??
      DEFAULT_CONFIG.planner_mode,
  };

  const parsed = PlanpongConfigSchema.parse(merged);
  maybeEmitGeminiReviewerWarning(parsed);
  return parsed;
}
