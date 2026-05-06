import type { Command } from "commander";
/**
 * Soft-validate a config value against the enumerated lists in the provider
 * registry. Returns a warning string if the value isn't recognized, or null
 * if it's known (or there's nothing to check against).
 *
 * Soft because providers accept newer model IDs that may not be in the
 * hardcoded MODELS array — we want to nudge typos without blocking power
 * users from setting valid-but-unenumerated values.
 */
export declare function getUnknownValueWarning(key: string, value: string, providerForRole: string | undefined): string | null;
export declare function registerConfigCommand(program: Command): void;
