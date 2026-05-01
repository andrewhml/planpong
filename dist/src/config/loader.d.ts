import { type PlanpongConfig } from "../schemas/config.js";
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
