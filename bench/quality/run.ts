#!/usr/bin/env tsx
/**
 * Quality benchmark: inject known defects into a plan, run a single
 * planpong review round, score whether the reviewer flagged each defect.
 *
 * Measures: does the reviewer catch known-bad things?
 *
 * Each defect plan is paired with `expectedKeywords` — strings the
 * reviewer's feedback (issue titles + descriptions) MUST contain to count
 * as a catch. Keywords are matched case-insensitively.
 *
 * Output: bench/quality/results/<iso>-<commit>/results.json
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import {
  runReviewRound,
  hashFile,
} from "../../src/core/operations.js";
import { readFileSync } from "node:fs";

interface Defect {
  id: string;
  planFile: string;
  description: string;
  // Keywords the reviewer feedback MUST contain to count as a catch.
  // At least one keyword from each group must match (AND across groups,
  // OR within each group).
  expectedKeywords: string[][];
  // Is this the no-defect control? Catch rate should be 0% on these
  // (any flagging is a false positive — though zero is unrealistic
  // since the reviewer always finds something).
  isControl?: boolean;
}

const DEFECTS: Defect[] = [
  {
    id: "D1-hallucinated-file",
    planFile: "bench/quality/defects/D1-hallucinated-file.md",
    description: "File path typo: idnex.ts instead of index.ts",
    expectedKeywords: [
      ["idnex", "typo", "misspell", "wrong file", "filename", "path", "non-existent", "incorrect file"],
    ],
  },
  {
    id: "D2-internal-contradiction",
    planFile: "bench/quality/defects/D2-internal-contradiction.md",
    description: "Step contradicts Key Decisions (custom handler vs commander built-in)",
    expectedKeywords: [
      ["contradict", "inconsist", "conflict", "mismatch", "disagree"],
    ],
  },
  {
    id: "D3-missing-step",
    planFile: "bench/quality/defects/D3-missing-step.md",
    description: "Missing step: how does program.version() receive the version string?",
    expectedKeywords: [
      ["package.json", "version", "missing", "how", "where", "read", "load", "import"],
    ],
  },
  {
    id: "control",
    planFile: "bench/plans/small.md",
    description: "Original plan, no defect",
    expectedKeywords: [],
    isControl: true,
  },
];

interface RunResult {
  defectId: string;
  description: string;
  isControl: boolean;
  caught: boolean;
  matchedKeywords: string[];
  issueCount: number;
  issues: Array<{ id: string; severity: string; title: string; description: string }>;
  reviewDurationMs: number;
  outputChars: number;
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

function scoreFeedback(
  feedback: { issues: Array<{ title: string; description: string; suggestion?: string; section?: string }> },
  expectedKeywords: string[][],
): { caught: boolean; matchedKeywords: string[] } {
  if (expectedKeywords.length === 0) {
    return { caught: false, matchedKeywords: [] };
  }
  const allText = feedback.issues
    .map((i) =>
      [i.title, i.description, i.suggestion ?? "", i.section ?? ""].join(" "),
    )
    .join(" ")
    .toLowerCase();

  const matchedKeywords: string[] = [];
  let allGroupsMatched = true;
  for (const group of expectedKeywords) {
    const matches = group.filter((kw) => allText.includes(kw.toLowerCase()));
    if (matches.length === 0) {
      allGroupsMatched = false;
    } else {
      matchedKeywords.push(...matches);
    }
  }
  return { caught: allGroupsMatched, matchedKeywords };
}

async function runSingleDefect(
  defect: Defect,
  repoRoot: string,
): Promise<RunResult> {
  // Each defect runs in its own scratch dir so sessions don't collide.
  const scratch = mkdtempSync(join(tmpdir(), `planpong-quality-${defect.id}-`));

  // Seed the scratch with the fixture repo (a small Node CLI codebase the
  // test plans reference). Without this the reviewer cannot verify file
  // paths or symbols against any real source — D1's filename typo
  // `src/cli/idnex.ts` is undetectable in an empty workspace.
  const fixtureRoot = resolve(repoRoot, "bench/quality/fixture-repo");
  copyDirRecursive(fixtureRoot, scratch);

  // Tiny git repo so codex's trusted-directory check passes
  try {
    execSync("git init -q && git add -A && git commit -q -m init", {
      cwd: scratch,
      stdio: "ignore",
    });
  } catch {
    // best effort
  }

  const planContent = readFileSync(resolve(repoRoot, defect.planFile), "utf-8");
  const planRelPath = `docs/plans/${basename(defect.planFile)}`;
  mkdirSync(dirname(resolve(scratch, planRelPath)), { recursive: true });
  writeFileSync(resolve(scratch, planRelPath), planContent);

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
  // Use detail phase (round 3+) — direction phase is explicitly told NOT to
  // focus on file paths or implementation specifics, which is exactly what
  // the defects test. Detail phase is the right venue for verifying file
  // existence, function names, contradictions in implementation steps.
  session.currentRound = 3;
  writeSessionState(scratch, session);
  writeInitialPlan(scratch, session.id, planContent);

  process.stdout.write(`[quality] ${defect.id} starting review…\n`);
  const start = Date.now();
  const result = await runReviewRound(session, scratch, config, reviewerProvider);
  const reviewDurationMs = Date.now() - start;

  const score = scoreFeedback(
    { issues: result.feedback.issues },
    defect.expectedKeywords,
  );

  return {
    defectId: defect.id,
    description: defect.description,
    isControl: defect.isControl ?? false,
    caught: score.caught,
    matchedKeywords: score.matchedKeywords,
    issueCount: result.feedback.issues.length,
    issues: result.feedback.issues.map((i) => ({
      id: i.id,
      severity: i.severity,
      title: i.title,
      description: i.description,
    })),
    reviewDurationMs,
    outputChars: 0,
  };
}

async function main(): Promise<void> {
  // ESM-friendly repo-root detection. The bench script lives in
  // bench/quality/, so resolve up two levels.
  const repoRoot = resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "..",
  );
  const stamp = isoStamp();
  const sha = gitSha();
  const outDir = resolve(repoRoot, `bench/quality/results/${stamp}-${sha}`);
  mkdirSync(outDir, { recursive: true });

  const results: RunResult[] = [];
  for (const defect of DEFECTS) {
    try {
      const result = await runSingleDefect(defect, repoRoot);
      results.push(result);
      process.stdout.write(
        `[quality] ${defect.id}: ${result.caught ? "CAUGHT" : "MISSED"} (${result.issueCount} issues, ${result.matchedKeywords.length} keyword hits)\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[quality] ${defect.id} ERROR: ${msg}\n`);
      results.push({
        defectId: defect.id,
        description: defect.description,
        isControl: defect.isControl ?? false,
        caught: false,
        matchedKeywords: [],
        issueCount: 0,
        issues: [],
        reviewDurationMs: 0,
        outputChars: 0,
      });
    }
  }

  const summary = {
    commit: sha,
    timestamp: new Date().toISOString(),
    models: {
      planner: "claude(claude-opus-4-6/high)",
      reviewer: "codex(gpt-5.3-codex/xhigh)",
    },
    catch_rate:
      results.filter((r) => !r.isControl && r.caught).length /
      Math.max(1, results.filter((r) => !r.isControl).length),
    control_false_positive: results.find((r) => r.isControl)?.caught ?? false,
    results,
  };

  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify(summary, null, 2),
  );

  process.stdout.write("\n=== Quality bench summary ===\n");
  process.stdout.write(
    `catch rate (defects only): ${(summary.catch_rate * 100).toFixed(0)}% (${results.filter((r) => !r.isControl && r.caught).length}/${results.filter((r) => !r.isControl).length})\n`,
  );
  for (const r of results) {
    const tag = r.isControl ? "[CTRL]" : r.caught ? "[CATCH]" : "[MISS] ";
    process.stdout.write(
      `${tag} ${r.defectId}: ${r.issueCount} issues, ${r.matchedKeywords.length} matched [${r.matchedKeywords.slice(0, 3).join(", ")}]\n`,
    );
  }
  process.stdout.write(`written to ${outDir}/results.json\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
