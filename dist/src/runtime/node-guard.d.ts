/**
 * Fallback when package.json can't be read. A test keeps this equal to the
 * `engines.node` floor in package.json.
 */
export declare const MIN_NODE_FALLBACK = "22.13.0";
/**
 * Walk up from `fromUrl` to the package.json whose name is "planpong".
 * Works for tsx dev (`bin/`), repo builds (`dist/bin/`), and installed
 * packages (`node_modules/planpong/dist/...`).
 */
export declare function findPlanpongPackageJson(fromUrl: string): {
    path: string;
    pkg: Record<string, unknown>;
} | null;
/** "22.13.0" from engines like ">=22.13.0"; null if not a plain >= range. */
export declare function parseEnginesFloor(engines: unknown): string | null;
/**
 * True when `current` satisfies `minimum`. A version that can't be parsed
 * passes, so an unusual runtime string never blocks a working install.
 */
export declare function meetsMinimum(current: string, minimum: string): boolean;
export declare function resolveMinimumNode(fromUrl: string): string;
export declare function nodeVersionError(minimum: string, current: string, execPath: string): string;
/** Exit with a clear message when the running Node is too old. */
export declare function assertSupportedNode(fromUrl: string): void;
