import { type PlanpongConfig } from "../schemas/config.js";
/**
 * Reset the gemini-reviewer-warning gate. Test-only — the gate is a process-
 * lifetime singleton in production so the warning fires exactly once.
 */
export declare function __resetGeminiReviewerWarningForTesting(): void;
/**
 * Search upward from `cwd` for a config file path.
 * Returns the absolute path or null if no file is found.
 */
export declare function findConfigPath(cwd: string): string | null;
export interface LoadConfigOptions {
    cwd: string;
    /** CLI overrides — sparse, merged on top of file + defaults */
    overrides?: Partial<{
        plannerProvider: string;
        plannerModel: string;
        plannerEffort: string;
        reviewerProvider: string;
        reviewerModel: string;
        reviewerEffort: string;
        plansDir: string;
        maxRounds: number;
        autonomous: boolean;
        revisionMode: "edits" | "full";
        plannerMode: "inline" | "external";
    }>;
}
export declare function loadConfig(options: LoadConfigOptions): PlanpongConfig;
