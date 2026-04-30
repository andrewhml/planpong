#!/usr/bin/env tsx
/**
 * Bench runner: drive planpong against a reference plan, collect every
 * round's metrics file from the scratch session directory, and write a
 * single summary JSON to bench/results/<iso>-<commit>/<plan>.json.
 *
 * Usage:
 *   tsx bench/run.ts bench/plans/small.md
 *   tsx bench/run.ts bench/plans/medium.md --out bench/results/custom-dir
 *
 * Not shipped with the npm package — bench/ is outside the `files` whitelist
 * in package.json.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig } from "../src/config/loader.js";
import {
  getProvider,
  getAvailableProviders,
} from "../src/providers/registry.js";
import { runReviewLoop, type LoopCallbacks } from "../src/core/loop.js";
import type { PlannerRevision } from "../src/schemas/revision.js";
import type { PhaseFeedback } from "../src/schemas/feedback.js";
import {
  RoundMetricsSchema,
  type RoundMetrics,
} from "../src/schemas/metrics.js";
import {
  formatProviderLabel,
  formatDuration,
} from "../src/core/operations.js";

interface Args {
  plan: string;
  outDir: string | null;
  revisionMode: "edits" | "full" | null;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let plan: string | null = null;
  let outDir: string | null = null;
  let revisionMode: "edits" | "full" | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      outDir = args[++i] ?? null;
    } else if (args[i] === "--revision-mode") {
      const v = args[++i];
      if (v !== "edits" && v !== "full") {
        process.stderr.write(
          `--revision-mode must be 'edits' or 'full', got '${v}'\n`,
        );
        process.exit(2);
      }
      revisionMode = v;
    } else if (!plan) {
      plan = args[i];
    }
  }
  if (!plan) {
    process.stderr.write(
      "Usage: tsx bench/run.ts <plan.md> [--out <dir>] [--revision-mode edits|full]\n",
    );
    process.exit(2);
  }
  return { plan, outDir, revisionMode };
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}

function isoStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main() {
  const args = parseArgs(process.argv);
  const { plan: planArg, outDir: outDirOverride } = args;
  const repoRoot = resolve(new URL("..", import.meta.url).pathname);
  const planPath = resolve(process.cwd(), planArg);
  if (!existsSync(planPath)) {
    process.stderr.write(`Plan not found: ${planPath}\n`);
    process.exit(2);
  }

  const planSlug = basename(planPath, extname(planPath));

  // Scratch dir so the session directory is isolated.
  const scratchRoot = mkdtempSync(join(tmpdir(), `planpong-bench-${planSlug}-`));
  mkdirSync(join(scratchRoot, "docs", "plans"), { recursive: true });
  const scratchPlanPath = join(scratchRoot, "docs", "plans", basename(planPath));
  copyFileSync(planPath, scratchPlanPath);

  // Codex CLI refuses to run outside a git repo ("Not inside a trusted
  // directory and --skip-git-repo-check was not specified"). Init the
  // scratch as a repo with a baseline commit so the bench can drive it.
  // `-c` flags suppress the commit hook and identity checks so this works
  // on any machine without prior git config.
  try {
    execSync("git init -q", { cwd: scratchRoot, stdio: "ignore" });
    execSync(
      'git -c user.email=bench@planpong.local -c user.name=bench -c commit.gpgsign=false add -A',
      { cwd: scratchRoot, stdio: "ignore" },
    );
    execSync(
      'git -c user.email=bench@planpong.local -c user.name=bench -c commit.gpgsign=false commit -q -m "bench baseline"',
      { cwd: scratchRoot, stdio: "ignore" },
    );
  } catch (err) {
    process.stderr.write(
      `[bench] warn: failed to init git repo in scratch dir — codex may refuse to run: ${err instanceof Error ? err.message : err}\n`,
    );
  }

  // Load config from the repo root — inherits planner/reviewer from the
  // repo's planpong.yaml so runs reflect the ambient config.
  const config = loadConfig({
    cwd: repoRoot,
    overrides: {
      autonomous: true,
      maxRounds: 10,
      ...(args.revisionMode ? { revisionMode: args.revisionMode } : {}),
    },
  });

  const plannerProvider = getProvider(config.planner.provider);
  const reviewerProvider = getProvider(config.reviewer.provider);
  if (!plannerProvider || !reviewerProvider) {
    process.stderr.write(
      `Provider not found: planner=${config.planner.provider} reviewer=${config.reviewer.provider}\n`,
    );
    process.exit(2);
  }

  const available = (await getAvailableProviders()).map((p) => p.name);
  for (const name of [config.planner.provider, config.reviewer.provider]) {
    if (!available.includes(name)) {
      process.stderr.write(
        `Provider CLI not available: ${name} (run \`${name} --version\` to verify install + auth)\n`,
      );
      process.exit(2);
    }
  }

  // Minimal callbacks — stdout progress only.
  const callbacks: LoopCallbacks = {
    async onPlanGenerated() {},
    onReviewStarting(round) {
      process.stdout.write(`R${round} review starting…\n`);
    },
    async onReviewComplete(round, feedback: PhaseFeedback) {
      process.stdout.write(
        `R${round} review done: ${feedback.verdict} (${feedback.issues.length} issues)\n`,
      );
    },
    onRevisionStarting(round) {
      process.stdout.write(`R${round} revision starting…\n`);
    },
    async onRevisionComplete(round, revision: PlannerRevision) {
      process.stdout.write(`R${round} revision done (${revision.responses.length} responses)\n`);
    },
    onConverged(round) {
      process.stdout.write(`Converged at R${round}.\n`);
    },
    onMaxRoundsReached(round) {
      process.stdout.write(`Max rounds (${round}) reached without convergence.\n`);
    },
    async onHashMismatch() {
      return "overwrite";
    },
    async confirmContinue() {
      return true;
    },
  };

  process.stdout.write(
    `Bench: plan=${planSlug} planner=${formatProviderLabel(config.planner)} reviewer=${formatProviderLabel(config.reviewer)} scratch=${scratchRoot}\n`,
  );
  const runStart = Date.now();
  let result: Awaited<ReturnType<typeof runReviewLoop>> | null = null;
  let runError: Error | null = null;
  try {
    result = await runReviewLoop({
      planPath: scratchPlanPath,
      cwd: scratchRoot,
      config,
      plannerProvider,
      reviewerProvider,
      callbacks,
    });
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }
  const runElapsed = Date.now() - runStart;

  // Locate the session directory (there should be exactly one).
  const sessionsDir = join(scratchRoot, ".planpong", "sessions");
  const sessionIds = existsSync(sessionsDir) ? readdirSync(sessionsDir) : [];
  const sessionId = sessionIds[0] ?? null;
  const sessionDir = sessionId ? join(sessionsDir, sessionId) : null;

  const metrics: RoundMetrics[] = [];
  if (sessionDir) {
    for (const file of readdirSync(sessionDir)) {
      if (!file.match(/^round-\d+-(review|revision)-metrics\.json$/)) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(sessionDir, file), "utf-8"));
        metrics.push(RoundMetricsSchema.parse(parsed));
      } catch (err) {
        process.stderr.write(
          `[bench] warn: could not parse ${file}: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }
    metrics.sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      // review always precedes revision within the same round number
      return a.role === "review" ? -1 : 1;
    });
  }

  const totalPromptChars = metrics.reduce(
    (sum, m) => sum + m.attempts.reduce((s, a) => s + a.prompt_chars, 0),
    0,
  );
  const totalOutputChars = metrics.reduce(
    (sum, m) =>
      sum +
      m.attempts.reduce((s, a) => s + (a.output_chars ?? 0), 0),
    0,
  );
  const totalAttempts = metrics.reduce((sum, m) => sum + m.attempts.length, 0);
  const downgrades = metrics.reduce(
    (sum, m) =>
      sum +
      (m.attempts.length > 1 && m.attempts[0].ok === false ? 1 : 0),
    0,
  );
  const sumOfRoundDurations = metrics.reduce(
    (sum, m) => sum + m.total_duration_ms,
    0,
  );

  const summary = {
    commit: gitSha(),
    timestamp: new Date().toISOString(),
    plan: planSlug,
    planPath: planArg,
    models: {
      planner: formatProviderLabel(config.planner),
      reviewer: formatProviderLabel(config.reviewer),
    },
    max_rounds: config.max_rounds,
    outcome: runError ? "error" : (result?.status ?? "unknown"),
    error: runError ? runError.message.slice(0, 1000) : null,
    rounds: result?.rounds ?? metrics.filter((m) => m.role === "review").length,
    total_wall_ms: runElapsed,
    sum_round_wall_ms: sumOfRoundDurations,
    total_prompt_chars: totalPromptChars,
    total_output_chars: totalOutputChars,
    total_attempts: totalAttempts,
    downgrades,
    accepted: result?.accepted ?? 0,
    rejected: result?.rejected ?? 0,
    deferred: result?.deferred ?? 0,
    by_round: metrics.map((m) => ({
      round: m.round,
      role: m.role,
      phase: m.phase,
      duration_ms: m.total_duration_ms,
      attempts: m.attempts.length,
      prompt_chars: m.attempts.reduce((s, a) => s + a.prompt_chars, 0),
      output_chars: m.attempts.reduce((s, a) => s + (a.output_chars ?? 0), 0),
      ok: m.attempts.every((a) => a.ok) ? true : m.attempts.some((a) => a.ok),
      first_attempt_error: m.attempts[0].error_kind ?? null,
    })),
  };

  const resultsDir =
    outDirOverride ??
    join(repoRoot, "bench", "results", `${isoStamp()}-${summary.commit}`);
  mkdirSync(resultsDir, { recursive: true });
  const outFile = join(resultsDir, `${planSlug}.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2));

  process.stdout.write(
    `\n=== Bench summary (${planSlug}) ===\n` +
      `commit        ${summary.commit}\n` +
      `outcome       ${summary.outcome}${summary.error ? " — " + summary.error.slice(0, 120) : ""}\n` +
      `rounds        ${summary.rounds}\n` +
      `wall clock    ${formatDuration(summary.total_wall_ms)} (sum of rounds: ${formatDuration(summary.sum_round_wall_ms)})\n` +
      `prompt chars  ${summary.total_prompt_chars.toLocaleString()}\n` +
      `output chars  ${summary.total_output_chars.toLocaleString()}\n` +
      `attempts      ${summary.total_attempts} (${summary.downgrades} downgraded)\n` +
      `written to    ${outFile}\n`,
  );

  if (runError) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[bench] fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
