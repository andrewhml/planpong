export interface KeyMeta {
    key: string;
    description: string;
    values: string;
    default: string;
}
type ValidKey = "planner.provider" | "planner.model" | "planner.effort" | "reviewer.provider" | "reviewer.model" | "reviewer.effort" | "plans_dir" | "max_rounds" | "human_in_loop" | "revision_mode" | "planner_mode";
export type { ValidKey };
export interface SetConfigResult {
    configPath: string;
    key: string;
    before: unknown;
    after: unknown;
    created: boolean;
}
export interface BatchPick {
    key: string;
    rawValue: string;
}
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
export declare function isValidKey(key: string): key is ValidKey;
export declare function getValidKeys(): readonly string[];
export declare function getKeyMetadata(): readonly KeyMeta[];
export declare function getKeyMeta(key: string): KeyMeta | undefined;
/**
 * Apply many key/value picks to the project's planpong.yaml in one atomic
 * write. Validates every pick (key allowlist, type coercion, merged-config
 * schema) before any disk mutation, so a failing pick aborts the entire
 * batch with the on-disk file byte-identical to its prior state.
 *
 * The single-key `setConfigValue` is a thin wrapper over this; the wizard
 * flow calls this directly with all picks accumulated in memory.
 */
export declare function setConfigValuesBatch(cwd: string, picks: BatchPick[], opts?: {
    dryRun?: boolean;
}): SetConfigValuesBatchResult;
export declare function setConfigValue(cwd: string, key: string, rawValue: string, opts?: {
    dryRun?: boolean;
}): SetConfigResult;
