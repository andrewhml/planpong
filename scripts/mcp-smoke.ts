/**
 * Smoke test: drive a specific build's MCP server over stdio, the way an
 * MCP client does. Used to verify a branch build without touching the
 * machine's registered planpong server (which runs whatever build the
 * registration points at). See docs/plans/node-22-and-dependency-majors.md.
 *
 * Run with:
 *   npx tsx scripts/mcp-smoke.ts --server ../planpong-node22/dist \
 *     --reviewer claude [--model claude-opus-5-5] [--effort low]
 *
 * It prints the absolute server path it launched, then:
 * 1. Lists tools
 * 2. Starts a review of a scratch plan in a temp git repo
 * 3. Runs one planpong_get_feedback round with the real reviewer
 * 4. Reports the attempt mode from the round's metrics file
 * 5. Sends a malformed call and prints the validation error
 * Exits non-zero if any step fails.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

const EXPECTED_TOOLS = [
  "planpong_start_review",
  "planpong_get_feedback",
  "planpong_revise",
  "planpong_record_revision",
  "planpong_status",
  "planpong_list_sessions",
  "planpong_get_report",
  "planpong_get_config",
  "planpong_set_config",
];

async function main(): Promise<void> {
  const distDir = arg("server");
  const reviewer = arg("reviewer", "claude")!;
  const model = arg("model");
  const effort = arg("effort");
  if (!distDir) {
    console.error("usage: mcp-smoke.ts --server <dist dir> --reviewer <claude|codex> [--model m] [--effort e]");
    process.exit(2);
  }
  const serverPath = resolve(distDir, "bin", "planpong-mcp.js");
  if (!existsSync(serverPath)) throw new Error(`No server at ${serverPath}`);
  console.log(`server: ${serverPath}`);
  console.log(`node:   ${process.execPath} (${process.version})`);

  // Scratch repo: codex refuses to run outside a git repo.
  const work = mkdtempSync(join(tmpdir(), "planpong-mcp-smoke-"));
  mkdirSync(join(work, "docs", "plans"), { recursive: true });
  const planPath = join(work, "docs", "plans", "smoke.md");
  writeFileSync(
    planPath,
    "# Smoke Plan\n\n**Status:** Draft\n\n## Goal\nAdd a --version flag to a small CLI.\n\n## Steps\n- [ ] Read the version from package.json\n- [ ] Print it and exit 0\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: work });
  console.log(`work:   ${work}`);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: work,
    stderr: "pipe",
  });
  const client = new Client({ name: "planpong-mcp-smoke", version: "0" });
  await client.connect(transport);

  let failed = false;
  const check = (ok: boolean, label: string, detail = ""): void => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
    if (!ok) failed = true;
  };

  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
    check(missing.length === 0, "tools listed", missing.length ? `missing ${missing.join(", ")}` : `${tools.length} tools`);

    const start = await client.callTool({
      name: "planpong_start_review",
      arguments: {
        plan_path: planPath,
        cwd: work,
        max_rounds: 1,
        reviewer: { provider: reviewer, ...(model ? { model } : {}), ...(effort ? { effort } : {}) },
      },
    });
    const started = JSON.parse(textOf(start)) as { session_id?: string; error?: string };
    check(!start.isError && !!started.session_id, "start_review", started.session_id ?? started.error ?? "");
    if (!started.session_id) throw new Error("no session");

    const t0 = Date.now();
    const feedback = await client.callTool(
      { name: "planpong_get_feedback", arguments: { session_id: started.session_id, cwd: work } },
      undefined,
      { timeout: 15 * 60_000 },
    );
    const text = textOf(feedback);
    const firstLine = text.split("\n")[0];
    check(!feedback.isError, "get_feedback round 1", `${Math.round((Date.now() - t0) / 1000)}s ${firstLine.slice(0, 160)}`);

    const sessionDir = join(work, ".planpong", "sessions", started.session_id);
    const metricsFile = readdirSync(sessionDir).find((f) => f === "round-1-review-metrics.json");
    if (metricsFile) {
      const metrics = JSON.parse(readFileSync(join(sessionDir, metricsFile), "utf-8")) as {
        attempts: Array<{ mode: string; provider: string; model: string | null; ok: boolean }>;
      };
      const modes = metrics.attempts.map((a) => `${a.provider}/${a.model ?? "default"}:${a.mode}:${a.ok ? "ok" : "fail"}`);
      check(
        metrics.attempts.length === 1 && metrics.attempts[0].mode === "structured" && metrics.attempts[0].ok,
        "structured mode, no fallback",
        modes.join(", "),
      );
    } else {
      check(false, "round metrics written");
    }

    const bad = await client.callTool({
      name: "planpong_get_feedback",
      arguments: { session_id: 123 as unknown as string },
    });
    const badText = textOf(bad);
    check(!!bad.isError && badText.length > 0, "malformed call returns a readable error", badText.replace(/\s+/g, " ").slice(0, 160));
  } finally {
    await client.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
