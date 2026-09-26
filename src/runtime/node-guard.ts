// Runs before any dependency is loaded, so it must import only Node
// builtins and use syntax old Node versions can parse. The bin entrypoints
// import this statically, check the version, then dynamically import the
// real entry; ESM hoists static imports, so a check placed above the
// dependency imports in the same file would run too late.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fallback when package.json can't be read. A test keeps this equal to the
 * `engines.node` floor in package.json.
 */
export const MIN_NODE_FALLBACK = "22.13.0";

/**
 * Walk up from `fromUrl` to the package.json whose name is "planpong".
 * Works for tsx dev (`bin/`), repo builds (`dist/bin/`), and installed
 * packages (`node_modules/planpong/dist/...`).
 */
export function findPlanpongPackageJson(
  fromUrl: string,
): { path: string; pkg: Record<string, unknown> } | null {
  let here = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 6; i++) {
    const candidate = join(here, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as Record<string, unknown>;
      if (pkg.name === "planpong") return { path: candidate, pkg };
    } catch {
      // not here or unreadable; keep walking up
    }
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  return null;
}

/** "22.13.0" from engines like ">=22.13.0"; null if not a plain >= range. */
export function parseEnginesFloor(engines: unknown): string | null {
  if (typeof engines !== "string") return null;
  const m = engines.trim().match(/^>=\s*(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

function parseVersion(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * True when `current` satisfies `minimum`. A version that can't be parsed
 * passes, so an unusual runtime string never blocks a working install.
 */
export function meetsMinimum(current: string, minimum: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(minimum);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

export function resolveMinimumNode(fromUrl: string): string {
  const found = findPlanpongPackageJson(fromUrl);
  const engines = (found?.pkg.engines as { node?: unknown } | undefined)?.node;
  return parseEnginesFloor(engines) ?? MIN_NODE_FALLBACK;
}

export function nodeVersionError(minimum: string, current: string, execPath: string): string {
  return (
    `planpong requires Node >= ${minimum}; found ${current} at ${execPath}. ` +
    `Upgrade Node or point your MCP config at a newer node.`
  );
}

/** Exit with a clear message when the running Node is too old. */
export function assertSupportedNode(fromUrl: string): void {
  const minimum = resolveMinimumNode(fromUrl);
  const current = process.versions.node;
  if (!meetsMinimum(current, minimum)) {
    process.stderr.write(nodeVersionError(minimum, current, process.execPath) + "\n");
    process.exit(1);
  }
}
