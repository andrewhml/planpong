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
export declare function isValidKey(key: string): key is ValidKey;
export declare function getValidKeys(): readonly string[];
export declare function getKeyMetadata(): readonly KeyMeta[];
export declare function getKeyMeta(key: string): KeyMeta | undefined;
export declare function setConfigValue(cwd: string, key: string, rawValue: string, opts?: {
    dryRun?: boolean;
}): SetConfigResult;
