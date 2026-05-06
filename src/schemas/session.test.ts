import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSchema } from "./session.js";
import { readSessionState, withSessionLock } from "../core/session.js";

describe("SessionSchema backward compatibility for plannerMode", () => {
  it("defaults plannerMode to 'external' when absent (Zod schema test)", () => {
    const fixture = {
      id: "abc123",
      repoRoot: "/tmp/repo",
      planPath: "docs/plans/x.md",
      planPathAbsolute: "/tmp/repo/docs/plans/x.md",
      planner: { provider: "claude" },
      reviewer: { provider: "codex" },
      status: "in_review" as const,
      currentRound: 0,
      startedAt: "2026-04-30T00:00:00.000Z",
      planHash: "h",
      // intentionally no plannerMode — old session shape
    };

    const parsed = SessionSchema.parse(fixture);
    expect(parsed.plannerMode).toBe("external");
  });

  it("preserves plannerMode when present", () => {
    const fixture = {
      id: "abc123",
      repoRoot: "/tmp/repo",
      planPath: "docs/plans/x.md",
      planPathAbsolute: "/tmp/repo/docs/plans/x.md",
      planner: { provider: "claude" },
      reviewer: { provider: "codex" },
      status: "in_review" as const,
      currentRound: 0,
      startedAt: "2026-04-30T00:00:00.000Z",
      planHash: "h",
      plannerMode: "inline" as const,
    };

    const parsed = SessionSchema.parse(fixture);
    expect(parsed.plannerMode).toBe("inline");
  });
});

describe("readSessionState backward compatibility for plannerMode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "planpong-session-compat-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  // The authoritative test: readSessionState skips Zod and uses
  // `JSON.parse(...) as Session`, so the schema's .default() doesn't fire.
  // Without runtime normalization, old session files would surface
  // plannerMode === undefined and silently break the inline-mode gating
  // in revise.ts and record-revision.ts.
  it("normalizes missing plannerMode to 'external' on read", () => {
    const sessionId = "old123";
    const dir = join(tmpDir, ".planpong/sessions", sessionId);
    mkdirSync(dir, { recursive: true });
    const fixture = {
      id: sessionId,
      repoRoot: tmpDir,
      planPath: "docs/plans/x.md",
      planPathAbsolute: join(tmpDir, "docs/plans/x.md"),
      planner: { provider: "claude" },
      reviewer: { provider: "codex" },
      status: "in_review",
      currentRound: 1,
      startedAt: "2026-04-30T00:00:00.000Z",
      planHash: "h",
      // no plannerMode in the persisted file
    };
    writeFileSync(
      join(dir, "session.json"),
      JSON.stringify(fixture, null, 2),
    );

    const session = readSessionState(tmpDir, sessionId);
    expect(session).not.toBeNull();
    expect(session?.plannerMode).toBe("external");
  });

  it("preserves explicit plannerMode on read", () => {
    const sessionId = "new456";
    const dir = join(tmpDir, ".planpong/sessions", sessionId);
    mkdirSync(dir, { recursive: true });
    const fixture = {
      id: sessionId,
      repoRoot: tmpDir,
      planPath: "docs/plans/x.md",
      planPathAbsolute: join(tmpDir, "docs/plans/x.md"),
      planner: { provider: "claude" },
      reviewer: { provider: "codex" },
      status: "in_review",
      currentRound: 1,
      startedAt: "2026-04-30T00:00:00.000Z",
      planHash: "h",
      plannerMode: "inline",
    };
    writeFileSync(
      join(dir, "session.json"),
      JSON.stringify(fixture, null, 2),
    );

    const session = readSessionState(tmpDir, sessionId);
    expect(session?.plannerMode).toBe("inline");
  });

  it("serializes work with a per-session lock", async () => {
    const sessionId = "locked789";
    const order: string[] = [];

    const first = withSessionLock(tmpDir, sessionId, async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push("first:end");
    });
    const second = withSessionLock(tmpDir, sessionId, async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.all([first, second]);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});
