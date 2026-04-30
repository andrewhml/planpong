#!/usr/bin/env tsx
/**
 * Compare two bench runs (or a directory of runs). For a single arg, prints
 * the run's summary table. For two args, prints a delta table.
 *
 * Usage:
 *   tsx bench/summarize.ts bench/baseline.json
 *   tsx bench/summarize.ts bench/baseline.json bench/results/<stamp>/medium.json
 *
 * Accepts either a single-plan summary JSON or a directory containing multiple
 * plan JSONs — in the directory case, all .json files inside are treated as
 * separate plan summaries.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

interface RunSummary {
  commit: string;
  plan: string;
  timestamp: string;
  models: { planner: string; reviewer: string };
  outcome: string;
  rounds: number;
  total_wall_ms: number;
  sum_round_wall_ms: number;
  total_prompt_chars: number;
  total_output_chars: number;
  total_attempts: number;
  downgrades: number;
  accepted: number;
  rejected: number;
  deferred: number;
}

function loadOne(path: string): RunSummary {
  return JSON.parse(readFileSync(path, "utf-8")) as RunSummary;
}

function loadPath(path: string): RunSummary[] {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    process.stderr.write(`not found: ${abs}\n`);
    process.exit(2);
  }
  const st = statSync(abs);
  if (st.isFile()) return [loadOne(abs)];
  if (st.isDirectory()) {
    return readdirSync(abs)
      .filter((f) => extname(f) === ".json")
      .map((f) => loadOne(join(abs, f)));
  }
  process.stderr.write(`unsupported path: ${abs}\n`);
  process.exit(2);
}

function ms(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return m === 0 ? `${s}s` : `${m}m ${rs}s`;
}

function pct(base: number, now: number): string {
  if (base === 0) return now === 0 ? "—" : "+∞";
  const d = ((now - base) / base) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

function printOne(s: RunSummary) {
  process.stdout.write(
    `\nRun: ${s.plan}  (commit ${s.commit}, ${s.timestamp})\n` +
      `  models        ${s.models.planner} → ${s.models.reviewer}\n` +
      `  outcome       ${s.outcome}\n` +
      `  rounds        ${s.rounds}\n` +
      `  wall          ${ms(s.total_wall_ms)}\n` +
      `  prompt chars  ${s.total_prompt_chars.toLocaleString()}\n` +
      `  output chars  ${s.total_output_chars.toLocaleString()}\n` +
      `  attempts      ${s.total_attempts} (${s.downgrades} downgraded)\n` +
      `  accepted/rejected/deferred  ${s.accepted}/${s.rejected}/${s.deferred}\n`,
  );
}

function printDelta(a: RunSummary, b: RunSummary) {
  const row = (label: string, av: string, bv: string, delta: string) =>
    `  ${label.padEnd(16)} ${av.padStart(14)}    ${bv.padStart(14)}    ${delta.padStart(10)}\n`;
  process.stdout.write(
    `\nDelta: ${a.plan}\n` +
      `  baseline   ${a.commit} (${a.timestamp})\n` +
      `  latest     ${b.commit} (${b.timestamp})\n` +
      `  models     ${a.models.planner} → ${a.models.reviewer}  vs  ${b.models.planner} → ${b.models.reviewer}\n\n` +
      row("metric", "baseline", "latest", "Δ") +
      row("-".repeat(16), "-".repeat(14), "-".repeat(14), "-".repeat(10)) +
      row("outcome", a.outcome, b.outcome, a.outcome === b.outcome ? "=" : "≠") +
      row("rounds", String(a.rounds), String(b.rounds), String(b.rounds - a.rounds)) +
      row("wall", ms(a.total_wall_ms), ms(b.total_wall_ms), pct(a.total_wall_ms, b.total_wall_ms)) +
      row(
        "prompt chars",
        a.total_prompt_chars.toLocaleString(),
        b.total_prompt_chars.toLocaleString(),
        pct(a.total_prompt_chars, b.total_prompt_chars),
      ) +
      row(
        "output chars",
        a.total_output_chars.toLocaleString(),
        b.total_output_chars.toLocaleString(),
        pct(a.total_output_chars, b.total_output_chars),
      ) +
      row(
        "attempts",
        String(a.total_attempts),
        String(b.total_attempts),
        String(b.total_attempts - a.total_attempts),
      ) +
      row(
        "downgrades",
        String(a.downgrades),
        String(b.downgrades),
        String(b.downgrades - a.downgrades),
      ) +
      row(
        "accepted",
        String(a.accepted),
        String(b.accepted),
        String(b.accepted - a.accepted),
      ) +
      "\n",
  );
  const warnings: string[] = [];
  if (a.outcome !== b.outcome) {
    warnings.push(
      `outcome changed (${a.outcome} → ${b.outcome}) — results are not directly comparable`,
    );
  }
  if (a.rounds !== b.rounds) {
    warnings.push(
      `round count changed (${a.rounds} → ${b.rounds}) — review behavior differs; wall-clock deltas include that effect`,
    );
  }
  if (a.models.planner !== b.models.planner || a.models.reviewer !== b.models.reviewer) {
    warnings.push(
      "models changed between runs — any delta mixes code change with model change",
    );
  }
  if (b.downgrades > a.downgrades) {
    warnings.push(
      `downgrades increased (${a.downgrades} → ${b.downgrades}) — parsing may be regressing`,
    );
  }
  if (warnings.length > 0) {
    process.stdout.write("Caveats:\n");
    for (const w of warnings) process.stdout.write(`  - ${w}\n`);
    process.stdout.write("\n");
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length > 2) {
    process.stderr.write(
      "Usage:\n" +
        "  tsx bench/summarize.ts <file-or-dir>            # print run(s)\n" +
        "  tsx bench/summarize.ts <baseline> <latest>      # print delta(s)\n",
    );
    process.exit(2);
  }
  if (args.length === 1) {
    for (const s of loadPath(args[0])) printOne(s);
    return;
  }
  const baselines = loadPath(args[0]);
  const latests = loadPath(args[1]);
  // Match by plan name.
  for (const baseline of baselines) {
    const latest = latests.find((l) => l.plan === baseline.plan);
    if (!latest) {
      process.stderr.write(
        `no matching plan "${baseline.plan}" in latest (looked in ${args[1]})\n`,
      );
      continue;
    }
    printDelta(baseline, latest);
  }
}

main();
