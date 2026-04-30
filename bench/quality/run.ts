#!/usr/bin/env tsx
/**
 * Quality benchmark v1: defect-injection harness with two scoring modes
 * (planpong vs single-pass baseline) and an LLM-judge scorer.
 *
 * For each defect:
 * 1. Seed a tmpdir with the fixture-repo + the defect plan.
 * 2. PLANPONG mode: run a single planpong detail-phase review round.
 * 3. BASELINE mode: run a single naive provider invocation with no
 *    planpong scaffolding, but the same fixture access + structured output.
 * 4. JUDGE: a third (different) model reads the defect's ground truth and
 *    the issues raised by each mode, returns caught/not-caught with reason.
 *
 * Output: bench/quality/results/<iso>-<commit>/results.json
 *
 * CLI flags:
 *   --mode planpong | baseline | both        (default: both)
 *   --judge claude | codex                   (default: claude)
 *   --defect <id>                            (default: all defects)
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig } from "../../src/config/loader.js";
import { getProvider } from "../../src/providers/registry.js";
import {
  createSession,
  writeSessionState,
  writeInitialPlan,
} from "../../src/core/session.js";
import { runReviewRound, hashFile } from "../../src/core/operations.js";
import { DEFECTS, type Defect } from "./defects.js";
import { runBaselineReview } from "./baseline.js";
import { judgeDefect, type JudgeVerdict } from "./judge.js";
import type { FeedbackIssue } from "../../src/schemas/feedback.js";

type Mode = "planpong" | "baseline";

interface CliArgs {
  modes: Mode[];
  judgeProvider: "claude" | "codex";
  defectFilter: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let modes: Mode[] = ["planpong", "baseline"];
  let judgeProvider: "claude" | "codex" = "claude";
  let defectFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode") {
      const v = args[++i];
      if (v === "both") modes = ["planpong", "baseline"];
      else if (v === "planpong") modes = ["planpong"];
      else if (v === "baseline") modes = ["baseline"];
      else die(`--mode must be planpong | baseline | both, got '${v}'`);
    } else if (arg === "--judge") {
      const v = args[++i];
      if (v !== "claude" && v !== "codex") {
        die(`--judge must be claude | codex, got '${v}'`);
      }
      judgeProvider = v;
    } else if (arg === "--defect") {
      defectFilter = args[++i] ?? null;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: tsx bench/quality/run.ts [--mode planpong|baseline|both] [--judge claude|codex] [--defect <id>]\n",
      );
      process.exit(0);
    } else {
      die(`Unknown argument: ${arg}`);
    }
  }
  return { modes, judgeProvider, defectFilter };
}

function die(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

function copyDirRecursive(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else if (stat.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function seedScratch(repoRoot: string, defect: Defect): {
  scratch: string;
  planRelPath: string;
  planText: string;
} {
  const scratch = mkdtempSync(
    join(tmpdir(), `planpong-quality-${defect.id}-`),
  );

  // Seed fixture so the reviewer can verify file references against real
  // source. Without this, defects like D1/D5/D10 are undetectable.
  const fixtureRoot = resolve(repoRoot, "bench/quality/fixture-repo");
  copyDirRecursive(fixtureRoot, scratch);

  // Codex requires a git repo for its trusted-directory check.
  try {
    execSync("git init -q && git add -A && git commit -q -m init", {
      cwd: scratch,
      stdio: "ignore",
    });
  } catch {
    // best effort
  }

  const planText = readFileSync(resolve(repoRoot, defect.planFile), "utf-8");
  const planRelPath = `docs/plans/${basename(defect.planFile)}`;
  mkdirSync(dirname(resolve(scratch, planRelPath)), { recursive: true });
  writeFileSync(resolve(scratch, planRelPath), planText);
  return { scratch, planRelPath, planText };
}

interface ModeResult {
  issues: Array<Pick<FeedbackIssue, "id" | "severity" | "section" | "title" | "description" | "suggestion">>;
  durationMs: number;
  outputChars: number;
  error?: string;
}

interface DefectRunResult {
  defectId: string;
  description: string;
  isControl: boolean;
  modes: Partial<Record<Mode, ModeResult>>;
  judges: Partial<Record<Mode, JudgeVerdict & { judgeDurationMs: number; error?: string }>>;
}

async function runPlanpongMode(
  defect: Defect,
  repoRoot: string,
): Promise<ModeResult> {
  const { scratch, planRelPath, planText } = seedScratch(repoRoot, defect);
  const config = loadConfig({
    cwd: repoRoot,
    overrides: { autonomous: true, maxRounds: 1 },
  });
  const reviewerProvider = getProvider(config.reviewer.provider);
  if (!reviewerProvider) {
    throw new Error(`reviewer provider not found: ${config.reviewer.provider}`);
  }
  const planHash = hashFile(resolve(scratch, planRelPath));
  const session = createSession(
    scratch,
    planRelPath,
    config.planner,
    config.reviewer,
    planHash,
  );
  session.status = "in_review";
  // Detail phase — direction phase is told NOT to focus on file paths,
  // and risk phase is pre-mortem. Detail is where path/symbol verification
  // belongs, which is what most of these defects test.
  session.currentRound = 3;
  writeSessionState(scratch, session);
  writeInitialPlan(scratch, session.id, planText);

  const start = Date.now();
  const result = await runReviewRound(
    session,
    scratch,
    config,
    reviewerProvider,
  );
  const durationMs = Date.now() - start;

  return {
    issues: result.feedback.issues.map((i) => ({
      id: i.id,
      severity: i.severity,
      section: i.section,
      title: i.title,
      description: i.description,
      suggestion: i.suggestion,
    })),
    durationMs,
    outputChars: 0, // structured output goes through, not surfaced here
  };
}

async function runBaselineMode(
  defect: Defect,
  repoRoot: string,
): Promise<ModeResult> {
  const { scratch, planText } = seedScratch(repoRoot, defect);
  const config = loadConfig({
    cwd: repoRoot,
    overrides: { autonomous: true, maxRounds: 1 },
  });
  const reviewerProvider = getProvider(config.reviewer.provider);
  if (!reviewerProvider) {
    throw new Error(`reviewer provider not found: ${config.reviewer.provider}`);
  }
  const result = await runBaselineReview({
    reviewerProvider,
    reviewerModel: config.reviewer.model,
    reviewerEffort: config.reviewer.effort,
    cwd: scratch,
    planText,
    timeoutMs: 600_000,
  });
  return {
    issues: result.issues.map((i) => ({
      id: i.id,
      severity: i.severity,
      section: i.section,
      title: i.title,
      description: i.description,
      suggestion: i.suggestion,
    })),
    durationMs: result.durationMs,
    outputChars: result.outputChars,
  };
}

async function judgeMode(
  defect: Defect,
  modeResult: ModeResult,
  judgeProviderName: "claude" | "codex",
  judgeCwd: string,
): Promise<JudgeVerdict & { judgeDurationMs: number; error?: string }> {
  const provider = getProvider(judgeProviderName);
  if (!provider) {
    return {
      caught: false,
      matched_issue_id: null,
      reasoning: `judge provider '${judgeProviderName}' not registered`,
      judgeDurationMs: 0,
      error: "judge provider missing",
    };
  }
  try {
    const verdict = await judgeDefect({
      judgeProvider: provider,
      judgeCwd,
      defect,
      issues: modeResult.issues as FeedbackIssue[],
      timeoutMs: 300_000,
    });
    return verdict;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      caught: false,
      matched_issue_id: null,
      reasoning: `judge failed: ${msg}`,
      judgeDurationMs: 0,
      error: msg,
    };
  }
}

function makeJudgeCwd(repoRoot: string): string {
  // Judge needs a cwd that is a git repo (codex won't run otherwise) but
  // does NOT need the fixture — the judge sees only text. Use a tiny
  // throwaway dir.
  const dir = mkdtempSync(join(tmpdir(), "planpong-judge-"));
  try {
    execSync("git init -q && git commit --allow-empty -q -m init", {
      cwd: dir,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "judge",
        GIT_AUTHOR_EMAIL: "judge@bench.local",
        GIT_COMMITTER_NAME: "judge",
        GIT_COMMITTER_EMAIL: "judge@bench.local",
      },
    });
  } catch {
    // best effort
  }
  return dir;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const repoRoot = resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "..",
  );
  const stamp = isoStamp();
  const sha = gitSha();
  const outDir = resolve(repoRoot, `bench/quality/results/${stamp}-${sha}`);
  mkdirSync(outDir, { recursive: true });

  const defects = args.defectFilter
    ? DEFECTS.filter((d) => d.id === args.defectFilter)
    : DEFECTS;
  if (defects.length === 0) {
    die(`No defects matched filter '${args.defectFilter ?? ""}'.`);
  }

  const config = loadConfig({ cwd: repoRoot, overrides: { autonomous: true } });

  const judgeCwd = makeJudgeCwd(repoRoot);

  process.stdout.write(
    `Bench: defects=${defects.length} modes=[${args.modes.join(", ")}] judge=${args.judgeProvider}\n`,
  );

  const allResults: DefectRunResult[] = [];

  for (const defect of defects) {
    process.stdout.write(`\n[${defect.id}] ${defect.description}\n`);
    const result: DefectRunResult = {
      defectId: defect.id,
      description: defect.description,
      isControl: defect.isControl ?? false,
      modes: {},
      judges: {},
    };

    for (const mode of args.modes) {
      process.stdout.write(`  ${mode} review starting…\n`);
      try {
        const modeResult =
          mode === "planpong"
            ? await runPlanpongMode(defect, repoRoot)
            : await runBaselineMode(defect, repoRoot);
        result.modes[mode] = modeResult;
        process.stdout.write(
          `  ${mode} done: ${modeResult.issues.length} issues, ${(modeResult.durationMs / 1000).toFixed(1)}s\n`,
        );

        process.stdout.write(`  ${mode} judging…\n`);
        const verdict = await judgeMode(
          defect,
          modeResult,
          args.judgeProvider,
          judgeCwd,
        );
        result.judges[mode] = verdict;
        process.stdout.write(
          `  ${mode} judge: ${verdict.caught ? "CAUGHT" : "MISSED"} — ${verdict.reasoning.slice(0, 120)}\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.modes[mode] = {
          issues: [],
          durationMs: 0,
          outputChars: 0,
          error: msg,
        };
        process.stderr.write(`  ${mode} ERROR: ${msg}\n`);
      }
    }

    allResults.push(result);
    // Write incrementally so partial runs are recoverable if a later
    // defect crashes. Each write fully overwrites the file with the
    // accumulated state.
    writeFileSync(
      join(outDir, "results.json"),
      JSON.stringify(buildSummary(args, config, allResults), null, 2),
    );
  }

  const summary = buildSummary(args, config, allResults);
  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify(summary, null, 2),
  );

  process.stdout.write("\n=== Quality bench v1 summary ===\n");
  for (const mode of args.modes) {
    const summaryForMode = summary.summaries[mode];
    if (!summaryForMode) continue;
    process.stdout.write(
      `${mode.padEnd(9)}: catch=${(summaryForMode.catch_rate * 100).toFixed(0)}% (${summaryForMode.caught}/${summaryForMode.total_defects})  fp=${summaryForMode.control_false_positive ? "yes" : "no"}\n`,
    );
  }
  process.stdout.write("\nPer-defect:\n");
  for (const r of allResults) {
    const cells = args.modes
      .map((m) => {
        const j = r.judges[m];
        if (!j) return `${m}=ERR`;
        return `${m}=${j.caught ? "✓" : "✗"}`;
      })
      .join("  ");
    process.stdout.write(
      `  ${r.isControl ? "[CTRL]" : "      "} ${r.defectId.padEnd(28)} ${cells}\n`,
    );
  }
  process.stdout.write(`\nwritten to ${outDir}/results.json\n`);
}

function buildSummary(
  args: CliArgs,
  config: ReturnType<typeof loadConfig>,
  results: DefectRunResult[],
) {
  const summaries: Partial<
    Record<
      Mode,
      {
        total_defects: number;
        caught: number;
        catch_rate: number;
        control_false_positive: boolean;
      }
    >
  > = {};
  for (const mode of args.modes) {
    const defectResults = results.filter((r) => !r.isControl);
    const caught = defectResults.filter((r) => r.judges[mode]?.caught).length;
    const total = defectResults.length;
    const control = results.find((r) => r.isControl);
    summaries[mode] = {
      total_defects: total,
      caught,
      catch_rate: total === 0 ? 0 : caught / total,
      control_false_positive: control?.judges[mode]?.caught ?? false,
    };
  }

  return {
    schema_version: 1,
    commit: gitSha(),
    timestamp: new Date().toISOString(),
    models: {
      reviewer: `${config.reviewer.provider}(${config.reviewer.model ?? "default"}/${config.reviewer.effort ?? "default"})`,
      planner: `${config.planner.provider}(${config.planner.model ?? "default"}/${config.planner.effort ?? "default"})`,
      judge: args.judgeProvider,
    },
    modes: args.modes,
    summaries,
    results,
  };
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
