import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Command } from "commander";
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  setConfigValuesBatch,
  type BatchPick,
} from "../../config/mutate.js";
import {
  getAllProviders,
  getInstallHint,
} from "../../providers/registry.js";
import type { Provider } from "../../providers/types.js";

export interface WizardAnswers {
  plannerProvider: string;
  plannerModel: string;
  plannerEffort?: string;
  reviewerProvider: string;
  reviewerModel: string;
  reviewerEffort?: string;
  maxRounds: number;
  plansDir: string;
  plannerMode: "inline" | "external";
  revisionMode: "full" | "edits";
  humanInLoop: boolean;
}

export interface DiskSnapshot {
  planner?: { provider?: string; model?: string; effort?: string };
  reviewer?: { provider?: string; model?: string; effort?: string };
  max_rounds?: number;
  plans_dir?: string;
  planner_mode?: "inline" | "external";
  revision_mode?: "full" | "edits";
  human_in_loop?: boolean;
}

/**
 * Map a codex effort level to a human-readable label for the wizard.
 * Falls through to the raw value for unknown levels (future-proofing
 * against new effort tiers).
 */
export function effortLabel(level: string): string {
  switch (level) {
    case "low":
      return "low — fastest, cheapest";
    case "medium":
      return "medium";
    case "high":
      return "high — recommended";
    case "xhigh":
      return "xhigh — slowest, most thorough";
    default:
      return level;
  }
}

const CONFIG_FILENAMES = [
  "planpong.yaml",
  "planpong.yml",
  ".planpong.yaml",
  ".planpong.yml",
];

const GEMINI_REVIEWER_INLINE_WARNING =
  "warning: gemini reviewer rounds run without persistent session resumption.\n" +
  "         expect noticeably slower per-round wall time than claude/codex.\n" +
  "         tracked: see Future work in docs/plans/gemini-and-init-wizard.md";

/**
 * Read planpong.yaml directly into a partial snapshot. Unlike loadConfig(),
 * this does NOT merge defaults — fields the user never wrote remain
 * undefined so the wizard can omit them from the batch write.
 */
export function readDiskSnapshot(cwd: string): DiskSnapshot {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(cwd, filename);
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf-8");
      return (parseYaml(raw) as DiskSnapshot) ?? {};
    }
  }
  return {};
}

/**
 * Pure formatter for the post-write summary. The auth reminder appears
 * whenever gemini is picked for any role; it is intentionally a static
 * message rather than a probe of auth state.
 */
export function formatPostWriteSummary(answers: WizardAnswers): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "Run 'planpong review <plan-file>' to start a review, or",
    "    'planpong plan <requirements>' to generate a new plan.",
  );
  if (
    answers.plannerProvider === "gemini" ||
    answers.reviewerProvider === "gemini"
  ) {
    lines.push("");
    lines.push(
      "Note: gemini requires Google account auth. Run `gemini` once",
      "      before invoking planpong if you haven't already.",
    );
  }
  return lines.join("\n");
}

/**
 * Convert the wizard's answer object plus the on-disk-file snapshot into
 * the batch picks list. Omits keys whose answer matches the on-disk value
 * so the wizard never writes a default into an existing yaml the user
 * didn't touch. Output order is stable to keep diff output predictable.
 */
export function answersToPicks(
  answers: WizardAnswers,
  disk: DiskSnapshot,
): BatchPick[] {
  const picks: BatchPick[] = [];
  const add = (key: string, answer: unknown, diskValue: unknown): void => {
    if (answer === diskValue) return;
    picks.push({ key, rawValue: String(answer) });
  };

  add("planner.provider", answers.plannerProvider, disk.planner?.provider);
  add("planner.model", answers.plannerModel, disk.planner?.model);
  if (answers.plannerEffort !== undefined) {
    add("planner.effort", answers.plannerEffort, disk.planner?.effort);
  }
  add("reviewer.provider", answers.reviewerProvider, disk.reviewer?.provider);
  add("reviewer.model", answers.reviewerModel, disk.reviewer?.model);
  if (answers.reviewerEffort !== undefined) {
    add("reviewer.effort", answers.reviewerEffort, disk.reviewer?.effort);
  }
  add("max_rounds", answers.maxRounds, disk.max_rounds);
  add("plans_dir", answers.plansDir, disk.plans_dir);
  add("planner_mode", answers.plannerMode, disk.planner_mode);
  add("revision_mode", answers.revisionMode, disk.revision_mode);
  add("human_in_loop", answers.humanInLoop, disk.human_in_loop);

  return picks;
}

interface ProviderStatus {
  provider: Provider;
  available: boolean;
}

async function probeProviders(): Promise<ProviderStatus[]> {
  const all = getAllProviders();
  return Promise.all(
    all.map(async (p) => ({ provider: p, available: await p.isAvailable() })),
  );
}

function printDetectionTable(statuses: ProviderStatus[]): void {
  console.log(chalk.bold("\nDetected CLIs:"));
  for (const s of statuses) {
    const mark = s.available ? chalk.green("✓") : chalk.dim("✗");
    const name = s.provider.name.padEnd(8);
    if (s.available) {
      console.log(`  ${mark} ${name}available`);
    } else {
      console.log(`  ${mark} ${name}${chalk.dim("not installed — " + getInstallHint(s.provider.name))}`);
    }
  }
  console.log();
}

/**
 * Detect whether stdin is a real TTY. Node sets `isTTY` to `true` for a TTY
 * and leaves it `undefined` (NOT `false`) for pipes/redirects, so a strict
 * `=== false` check would silently let the wizard fall through to inquirer
 * and hang on the first prompt.
 */
export function isInteractiveTty(stdin: { isTTY?: boolean }): boolean {
  return stdin.isTTY === true;
}

async function runWizard(cwd: string): Promise<void> {
  if (!isInteractiveTty(process.stdin)) {
    process.stderr.write(
      "planpong init must run interactively. Use 'planpong config set <key> <value>' for scripted setup.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(chalk.bold("\nplanpong init") + chalk.dim(" — first-run setup\n"));

  const statuses = await probeProviders();
  printDetectionTable(statuses);

  const installed = statuses.filter((s) => s.available);
  if (installed.length === 0) {
    console.error(
      chalk.red("No supported AI CLIs are installed."),
      "Install at least one of:",
    );
    for (const s of statuses) {
      console.error(`  - ${getInstallHint(s.provider.name)}`);
    }
    process.exitCode = 1;
    return;
  }

  const disk = readDiskSnapshot(cwd);

  const installedChoices = installed.map((s) => ({
    name: s.provider.name,
    value: s.provider.name,
  }));

  const plannerProvider = await select({
    message: "Planner provider:",
    choices: installedChoices,
    default: disk.planner?.provider ?? installedChoices[0].value,
  });
  const plannerProviderObj = statuses.find(
    (s) => s.provider.name === plannerProvider,
  )?.provider;
  const plannerModelChoices = (plannerProviderObj?.getModels() ?? []).map(
    (m) => ({ name: m, value: m }),
  );
  const plannerModel = await select({
    message: "Planner model:",
    choices: plannerModelChoices,
    default: disk.planner?.model ?? plannerModelChoices[0]?.value,
  });
  const plannerEffortLevels = plannerProviderObj?.getEffortLevels() ?? [];
  let plannerEffort: string | undefined;
  if (plannerEffortLevels.length > 1) {
    plannerEffort = await select({
      message: "Planner effort level:",
      choices: plannerEffortLevels.map((l) => ({ name: effortLabel(l), value: l })),
      default:
        disk.planner?.effort ??
        plannerEffortLevels[Math.floor(plannerEffortLevels.length / 2)],
    });
  }

  const reviewerProvider = await select({
    message: "Reviewer provider:",
    choices: installedChoices,
    default: disk.reviewer?.provider ?? installedChoices[0].value,
  });
  if (reviewerProvider === plannerProvider) {
    console.log(
      chalk.yellow(
        "  note: planner and reviewer use the same provider. Adversarial signal is reduced when both roles share a model lineage.",
      ),
    );
  }
  const reviewerProviderObj = statuses.find(
    (s) => s.provider.name === reviewerProvider,
  )?.provider;
  const reviewerModelChoices = (reviewerProviderObj?.getModels() ?? []).map(
    (m) => ({ name: m, value: m }),
  );
  const reviewerModel = await select({
    message: "Reviewer model:",
    choices: reviewerModelChoices,
    default: disk.reviewer?.model ?? reviewerModelChoices[0]?.value,
  });
  const reviewerEffortLevels = reviewerProviderObj?.getEffortLevels() ?? [];
  let reviewerEffort: string | undefined;
  if (reviewerEffortLevels.length > 1) {
    reviewerEffort = await select({
      message: "Reviewer effort level:",
      choices: reviewerEffortLevels.map((l) => ({ name: effortLabel(l), value: l })),
      default:
        disk.reviewer?.effort ??
        reviewerEffortLevels[Math.floor(reviewerEffortLevels.length / 2)],
    });
  }

  const maxRoundsRaw = await input({
    message: "Maximum review rounds:",
    default: String(disk.max_rounds ?? 10),
    validate: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 50
        ? true
        : "Enter an integer between 1 and 50.";
    },
  });
  const plansDir = await input({
    message: "Plans directory:",
    default: disk.plans_dir ?? "docs/plans",
  });
  const plannerMode = (await select({
    message: "Planner mode:",
    choices: [
      { name: "inline (you act as the planner)", value: "inline" },
      { name: "external (route revisions through the planner provider)", value: "external" },
    ],
    default: disk.planner_mode ?? "inline",
  })) as "inline" | "external";
  const revisionMode = (await select({
    message: "Revision mode:",
    choices: [
      { name: "full (planner re-emits the entire plan each round — simple, slower)", value: "full" },
      { name: "edits (planner emits targeted text replacements — faster on mature plans)", value: "edits" },
    ],
    default: disk.revision_mode ?? "full",
  })) as "full" | "edits";
  const humanInLoop = (await select({
    message: "Pause between rounds for review?",
    choices: [
      { name: "yes (recommended — confirm or redirect after each round)", value: true },
      { name: "no (run autonomously to convergence or round limit)", value: false },
    ],
    default: disk.human_in_loop ?? true,
  })) as boolean;

  if (reviewerProvider === "gemini") {
    console.log("\n" + chalk.yellow(GEMINI_REVIEWER_INLINE_WARNING) + "\n");
  }

  const answers: WizardAnswers = {
    plannerProvider,
    plannerModel,
    plannerEffort,
    reviewerProvider,
    reviewerModel,
    reviewerEffort,
    maxRounds: Number(maxRoundsRaw),
    plansDir,
    plannerMode,
    revisionMode,
    humanInLoop,
  };

  const picks = answersToPicks(answers, disk);
  if (picks.length === 0) {
    console.log(chalk.dim("No changes — your planpong.yaml already matches these answers."));
    return;
  }

  console.log(chalk.bold("\nProposed changes:"));
  for (const p of picks) {
    console.log(`  ${p.key.padEnd(20)} → ${p.rawValue}`);
  }

  const proceed = await confirm({
    message: existsSync(join(cwd, "planpong.yaml"))
      ? "Update planpong.yaml with these changes?"
      : "Write planpong.yaml in this directory?",
    default: true,
  });
  if (!proceed) {
    console.log(chalk.dim("Cancelled, no changes written."));
    return;
  }

  const result = setConfigValuesBatch(cwd, picks);
  console.log(
    chalk.green(result.created ? "Created" : "Updated"),
    result.configPath,
  );
  console.log(formatPostWriteSummary(answers));
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Interactive setup wizard — produces a working planpong.yaml")
    .action(async () => {
      try {
        await runWizard(process.cwd());
      } catch (err) {
        const e = err as { name?: string; message?: string };
        if (e?.name === "ExitPromptError") {
          console.log(chalk.dim("\nAborted, no changes written."));
          return;
        }
        console.error(chalk.red("Error:"), e?.message ?? String(err));
        process.exitCode = 1;
      }
    });
}
