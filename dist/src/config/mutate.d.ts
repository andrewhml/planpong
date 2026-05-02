declare const VALID_KEYS: readonly ["planner.provider", "planner.model", "planner.effort", "reviewer.provider", "reviewer.model", "reviewer.effort", "plans_dir", "max_rounds", "human_in_loop", "revision_mode", "planner_mode"];
export type ValidKey = (typeof VALID_KEYS)[number];
export interface SetConfigResult {
    configPath: string;
    key: string;
    before: unknown;
    after: unknown;
    created: boolean;
}
export declare function isValidKey(key: string): key is ValidKey;
export declare function getValidKeys(): readonly string[];
export declare function setConfigValue(cwd: string, key: string, rawValue: string, opts?: {
    dryRun?: boolean;
}): SetConfigResult;
export {};
