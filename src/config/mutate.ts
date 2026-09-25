import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { ZodError } from "zod";
import { PlanpongConfigSchema } from "../schemas/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { findConfigPath } from "./loader.js";
import { loadConfig } from "./loader.js";

export interface KeyMeta {
  key: string;
  description: string;
  values: string;
  default: string;
}

const KEY_METADATA: KeyMeta[] = [
  { key: "planner.provider", description: "AI provider for plan revisions", values: "claude | codex | gemini", default: "claude" },
  { key: "planner.model", description: "Model name for the planner", values: "string (provider-specific)", default: "(provider default)" },
  { key: "planner.effort", description: "Effort/quality level for the planner", values: "string (provider-specific)", default: "(provider default)" },
  { key: "reviewer.provider", description: "AI provider for plan review", values: "claude | codex | gemini", default: "codex" },
  { key: "reviewer.model", description: "Model name for the reviewer", values: "string (provider-specific)", default: "(provider default)" },
  { key: "reviewer.effort", description: "Effort/quality level for the reviewer", values: "string (provider-specific)", default: "(provider default)" },
  { key: "plans_dir", description: "Directory for plan files", values: "path", default: "docs/plans" },
  { key: "max_rounds", description: "Maximum review rounds before stopping", values: "1–50", default: "10" },
  { key: "human_in_loop", description: "Pause for user confirmation between rounds", values: "true | false", default: "true" },
  { key: "revision_mode", description: "How revisions are applied", values: "full | edits", default: "full" },
  { key: "planner_mode", description: "Who revises the plan", values: "inline | external", default: "inline" },
];

const VALID_KEYS = KEY_METADATA.map((m) => m.key) as unknown as readonly ValidKey[];

type ValidKey =
  | "planner.provider" | "planner.model" | "planner.effort"
  | "reviewer.provider" | "reviewer.model" | "reviewer.effort"
  | "plans_dir" | "max_rounds" | "human_in_loop"
  | "revision_mode" | "planner_mode";

export type { ValidKey };

export interface SetConfigResult {
  configPath: string;
  key: string;
  before: unknown;
  after: unknown;
  created: boolean;
}

/** Set a key to a value, or remove it so the default (or CLI default) applies. */
export type BatchPick =
  | { key: string; rawValue: string; unset?: never }
  | { key: string; unset: true; rawValue?: never };

export interface BatchPickResult {
  key: string;
  before: unknown;
  after: unknown;
}

export interface SetConfigValuesBatchResult {
  configPath: string;
  created: boolean;
  results: BatchPickResult[];
}

export function isValidKey(key: string): key is ValidKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

export function getValidKeys(): readonly string[] {
  return VALID_KEYS;
}

export function getKeyMetadata(): readonly KeyMeta[] {
  return KEY_METADATA;
}

export function getKeyMeta(key: string): KeyMeta | undefined {
  return KEY_METADATA.find((m) => m.key === key);
}

function coerceValue(key: string, raw: string): unknown {
  if (key === "max_rounds") {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${key}: ${raw}`);
    return n;
  }
  if (key === "human_in_loop") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Invalid boolean for ${key}: ${raw} (expected "true" or "false")`);
  }
  return raw;
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Apply many key/value picks to the project's planpong.yaml in one atomic
 * write. Validates every pick (key allowlist, type coercion, merged-config
 * schema) before any disk mutation, so a failing pick aborts the entire
 * batch with the on-disk file byte-identical to its prior state.
 *
 * The single-key `setConfigValue` is a thin wrapper over this; the wizard
 * flow calls this directly with all picks accumulated in memory.
 */
export function setConfigValuesBatch(
  cwd: string,
  picks: BatchPick[],
  opts?: {
    dryRun?: boolean;
    /**
     * Write to this file instead of re-resolving. The wizard passes the
     * path it read its snapshot from so both target the same file.
     */
    configPath?: string;
  },
): SetConfigValuesBatchResult {
  for (const p of picks) {
    if (!isValidKey(p.key)) {
      throw new Error(
        `Unknown config key: "${p.key}". Valid keys: ${VALID_KEYS.join(", ")}`,
      );
    }
  }

  const existingPath = opts?.configPath
    ? existsSync(opts.configPath)
      ? opts.configPath
      : null
    : findConfigPath(cwd);
  const configPath = opts?.configPath ?? existingPath ?? join(cwd, "planpong.yaml");
  const created = !existingPath;

  // Nothing to write, or only unsets against a file that doesn't exist:
  // don't create an empty planpong.yaml.
  if (picks.length === 0 || (!existingPath && picks.every((p) => p.unset))) {
    return { configPath, created: false, results: [] };
  }

  const raw = existingPath ? readFileSync(existingPath, "utf-8") : "";
  const doc = parseDocument(raw);

  const beforeJson = (doc.toJSON() as Record<string, unknown>) ?? {};
  const testConfig = { ...loadConfig({ cwd }).valueOf() } as Record<
    string,
    unknown
  >;
  const results: BatchPickResult[] = [];
  let changed = false;

  for (const p of picks) {
    const before = getNestedValue(beforeJson, p.key);
    const parts = p.key.split(".");

    if (p.unset) {
      results.push({ key: p.key, before, after: undefined });
      if (before === undefined) continue; // already unset in this file
      changed = true;
      doc.deleteIn(parts);
      // Drop a role map left empty; never touch its other keys.
      if (parts.length > 1) {
        const section = doc.getIn([parts[0]]) as { items?: unknown[] } | undefined;
        if (section && Array.isArray(section.items) && section.items.length === 0) {
          doc.deleteIn([parts[0]]);
        }
      }
      // Validate against what loading will produce: the built-in default
      // when one exists, else absent.
      const fallback = getNestedValue(
        DEFAULT_CONFIG as unknown as Record<string, unknown>,
        p.key,
      );
      if (parts.length === 1) {
        if (fallback === undefined) delete testConfig[parts[0]];
        else testConfig[parts[0]] = fallback;
      } else {
        const section = {
          ...((testConfig[parts[0]] as Record<string, unknown> | undefined) ?? {}),
        };
        if (fallback === undefined) delete section[parts[1]];
        else section[parts[1]] = fallback;
        testConfig[parts[0]] = section;
      }
      continue;
    }

    const value = coerceValue(p.key, p.rawValue);
    results.push({ key: p.key, before, after: value });
    changed = true;
    doc.setIn(parts, value);
    if (parts.length === 1) {
      testConfig[parts[0]] = value;
    } else {
      const section =
        (testConfig[parts[0]] as Record<string, unknown> | undefined) ?? {};
      section[parts[1]] = value;
      testConfig[parts[0]] = section;
    }
  }

  try {
    PlanpongConfigSchema.parse(testConfig);
  } catch (err) {
    if (err instanceof ZodError) {
      const msg = err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid value for batch: ${msg}`);
    }
    throw err;
  }

  if (!opts?.dryRun && changed) {
    const output = doc.toString();
    const tmpPath = configPath + ".tmp." + process.pid;
    writeFileSync(tmpPath, output, "utf-8");
    renameSync(tmpPath, configPath);
  }

  return { configPath, created, results };
}

/** Remove one key so its default (or the provider CLI's default) applies. */
export function unsetConfigValue(
  cwd: string,
  key: string,
  opts?: { dryRun?: boolean },
): SetConfigResult {
  const batch = setConfigValuesBatch(cwd, [{ key, unset: true }], opts);
  const r = batch.results[0] ?? { key, before: undefined, after: undefined };
  return {
    configPath: batch.configPath,
    key: r.key,
    before: r.before,
    after: r.after,
    created: batch.created,
  };
}

export function setConfigValue(
  cwd: string,
  key: string,
  rawValue: string,
  opts?: { dryRun?: boolean },
): SetConfigResult {
  const batch = setConfigValuesBatch(cwd, [{ key, rawValue }], opts);
  const r = batch.results[0];
  return {
    configPath: batch.configPath,
    key: r.key,
    before: r.before,
    after: r.after,
    created: batch.created,
  };
}
