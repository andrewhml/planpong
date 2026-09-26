/**
 * Replay real planpong round files through the parse entry points and
 * write a results file: one line per input with the parse outcome and a
 * hash of the parsed object. Used to compare parser behavior across a
 * dependency upgrade (zod 3 to 4): run before and after, then diff the two
 * results files. See docs/plans/node-22-and-dependency-majors.md, Step 5.
 *
 * The corpus lives in other projects' .planpong/sessions directories and
 * contains private plan text, so nothing from it is printed or written in
 * clear: inputs are identified by a hash of their path, outputs by a hash
 * of the parsed object. Write the results outside this repo.
 *
 * These files are post-parse objects (parser-added fields, applied plans),
 * so this is secondary evidence; src/schemas/zod-golden.test.ts is primary.
 *
 * Run with:
 *   npx tsx scripts/replay-parse-corpus.ts --out /tmp/replay-zod3.txt <sessions dir>...
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseStructuredFeedbackForPhase,
  parseStructuredRevision,
} from "../src/core/convergence.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Stable stringify so key order can't change a hash.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function* roundFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* roundFiles(path);
    else if (/^round-\d+-(feedback|response)\.json$/.test(entry)) yield path;
  }
}

function phaseFor(round: number): "direction" | "risk" | "detail" {
  return round === 1 ? "direction" : round === 2 ? "risk" : "detail";
}

function main(): void {
  const outIndex = process.argv.indexOf("--out");
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  const dirs = process.argv.slice(2).filter((a, i, all) => a !== "--out" && all[i - 1] !== "--out");
  if (!out || dirs.length === 0) {
    console.error("usage: replay-parse-corpus.ts --out <results file> <dir>...");
    process.exit(2);
  }
  // The evidence verifier logs per-file warnings; they'd bury the summary.
  const warn = console.warn;
  const stderrWrite = process.stderr.write.bind(process.stderr);
  console.warn = () => {};
  process.stderr.write = (() => true) as typeof process.stderr.write;

  const lines: string[] = [];
  const counts = { files: 0, ok: 0, rejected: 0 };
  for (const dir of dirs) {
    for (const path of roundFiles(dir)) {
      counts.files++;
      const [, roundStr, kind] = path.match(/round-(\d+)-(feedback|response)\.json$/)!;
      const raw = readFileSync(path, "utf-8");
      let result: string;
      try {
        let parsed: unknown;
        if (kind === "feedback") {
          parsed = parseStructuredFeedbackForPhase(raw, phaseFor(Number(roundStr)), "");
        } else {
          const obj = JSON.parse(raw) as Record<string, unknown>;
          parsed = parseStructuredRevision(raw, "edits" in obj ? "edits" : "full");
        }
        result = `ok ${sha(stable(parsed))}`;
        counts.ok++;
      } catch (err) {
        const zod = (err as { zodError?: { issues: Array<{ path: unknown[] }> } }).zodError;
        const paths = zod?.issues.map((i) => i.path.join(".")).sort().join(",") ?? "";
        result = `rejected ${(err as Error).constructor.name} ${paths}`;
        counts.rejected++;
      }
      lines.push(`${sha(path)} ${kind} r${roundStr} ${result}`);
    }
  }
  console.warn = warn;
  process.stderr.write = stderrWrite;
  lines.sort();
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`${counts.files} files: ${counts.ok} parsed, ${counts.rejected} rejected -> ${out}`);
}

main();
