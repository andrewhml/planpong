import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { PlanpongConfigSchema, } from "../schemas/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
const CONFIG_FILENAMES = [
    "planpong.yaml",
    "planpong.yml",
    ".planpong.yaml",
    ".planpong.yml",
];
/**
 * Search upward from `cwd` for a config file. Returns the parsed
 * contents or null if no file is found.
 */
function findConfigFile(cwd) {
    let dir = cwd;
    const root = "/";
    while (true) {
        for (const filename of CONFIG_FILENAMES) {
            const candidate = join(dir, filename);
            if (existsSync(candidate)) {
                const raw = readFileSync(candidate, "utf-8");
                return parseYaml(raw);
            }
        }
        const parent = join(dir, "..");
        if (parent === dir || dir === root)
            break;
        dir = parent;
    }
    return null;
}
export function loadConfig(options) {
    const fileConfig = findConfigFile(options.cwd) ?? {};
    const overrides = options.overrides ?? {};
    // Merge: defaults < file < CLI overrides
    const merged = {
        planner: {
            provider: overrides.plannerProvider ??
                fileConfig.planner?.provider ??
                DEFAULT_CONFIG.planner.provider,
            model: overrides.plannerModel ??
                fileConfig.planner?.model ??
                DEFAULT_CONFIG.planner.model,
            effort: overrides.plannerEffort ??
                fileConfig.planner?.effort ??
                DEFAULT_CONFIG.planner.effort,
        },
        reviewer: {
            provider: overrides.reviewerProvider ??
                fileConfig.reviewer?.provider ??
                DEFAULT_CONFIG.reviewer.provider,
            model: overrides.reviewerModel ??
                fileConfig.reviewer?.model ??
                DEFAULT_CONFIG.reviewer.model,
            effort: overrides.reviewerEffort ??
                fileConfig.reviewer?.effort ??
                DEFAULT_CONFIG.reviewer.effort,
        },
        plans_dir: overrides.plansDir ??
            fileConfig.plans_dir ??
            DEFAULT_CONFIG.plans_dir,
        max_rounds: overrides.maxRounds ??
            fileConfig.max_rounds ??
            DEFAULT_CONFIG.max_rounds,
        human_in_loop: overrides.autonomous !== undefined
            ? !overrides.autonomous
            : (fileConfig.human_in_loop ??
                DEFAULT_CONFIG.human_in_loop),
        revision_mode: overrides.revisionMode ??
            fileConfig.revision_mode ??
            DEFAULT_CONFIG.revision_mode,
    };
    return PlanpongConfigSchema.parse(merged);
}
//# sourceMappingURL=loader.js.map