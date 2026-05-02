import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { ZodError } from "zod";
import { PlanpongConfigSchema } from "../schemas/config.js";
import { findConfigPath } from "./loader.js";
import { loadConfig } from "./loader.js";

const VALID_KEYS = [
  "planner.provider",
  "planner.model",
  "planner.effort",
  "reviewer.provider",
  "reviewer.model",
  "reviewer.effort",
  "plans_dir",
  "max_rounds",
  "human_in_loop",
  "revision_mode",
  "planner_mode",
] as const;

export type ValidKey = (typeof VALID_KEYS)[number];

export interface SetConfigResult {
  configPath: string;
  key: string;
  before: unknown;
  after: unknown;
  created: boolean;
}

export function isValidKey(key: string): key is ValidKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

export function getValidKeys(): readonly string[] {
  return VALID_KEYS;
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

export function setConfigValue(
  cwd: string,
  key: string,
  rawValue: string,
  opts?: { dryRun?: boolean },
): SetConfigResult {
  if (!isValidKey(key)) {
    throw new Error(
      `Unknown config key: "${key}". Valid keys: ${VALID_KEYS.join(", ")}`,
    );
  }

  const value = coerceValue(key, rawValue);
  const existingPath = findConfigPath(cwd);
  const configPath = existingPath ?? join(cwd, "planpong.yaml");
  const created = !existingPath;

  const raw = existingPath ? readFileSync(existingPath, "utf-8") : "";
  const doc = parseDocument(raw);

  const parts = key.split(".");
  const before = getNestedValue(
    (doc.toJSON() as Record<string, unknown>) ?? {},
    key,
  );

  if (parts.length === 1) {
    doc.set(parts[0], value);
  } else {
    let node = doc.get(parts[0], true);
    if (node == null || typeof node !== "object" || !("set" in node)) {
      doc.set(parts[0], { [parts[1]]: value });
    } else {
      (node as { set(k: string, v: unknown): void }).set(parts[1], value);
    }
  }

  // Validate the full merged config would be valid
  const merged = doc.toJSON() as Record<string, unknown>;
  const testConfig = { ...loadConfig({ cwd }).valueOf() };
  if (parts.length === 1) {
    (testConfig as Record<string, unknown>)[parts[0]] = value;
  } else {
    const section = (testConfig as Record<string, Record<string, unknown>>)[parts[0]] ?? {};
    section[parts[1]] = value;
    (testConfig as Record<string, unknown>)[parts[0]] = section;
  }
  try {
    PlanpongConfigSchema.parse(testConfig);
  } catch (err) {
    if (err instanceof ZodError) {
      const msg = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid value for "${key}": ${msg}`);
    }
    throw err;
  }

  if (!opts?.dryRun) {
    const output = doc.toString();
    const tmpPath = configPath + ".tmp." + process.pid;
    writeFileSync(tmpPath, output, "utf-8");
    renameSync(tmpPath, configPath);
  }

  return {
    configPath,
    key,
    before,
    after: value,
    created,
  };
}
