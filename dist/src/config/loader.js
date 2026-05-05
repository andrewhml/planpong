import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { PlanpongConfigSchema, } from "../schemas/config.js";
import { DEFAULT_CONFIG } from "./defaults.js";
let geminiReviewerWarningFired = false;
/**
 * Reset the gemini-reviewer-warning gate. Test-only — the gate is a process-
 * lifetime singleton in production so the warning fires exactly once.
 */
export function __resetGeminiReviewerWarningForTesting() {
    geminiReviewerWarningFired = false;
}
function maybeEmitGeminiReviewerWarning(config) {
    if (geminiReviewerWarningFired)
        return;
    if (config.reviewer.provider !== "gemini")
        return;
    geminiReviewerWarningFired = true;
    process.stderr.write("warning: gemini reviewer rounds run without persistent session resumption.\n" +
        "         expect noticeably slower per-round wall time than claude/codex.\n" +
        "         tracked: see Future work in docs/plans/gemini-and-init-wizard.md\n");
}
const CONFIG_FILENAMES = [
    "planpong.yaml",
    "planpong.yml",
    ".planpong.yaml",
    ".planpong.yml",
];
/**
 * Search upward from `cwd` for a config file path.
 * Returns the absolute path or null if no file is found.
 */
export function findConfigPath(cwd) {
    let dir = cwd;
    const root = "/";
    while (true) {
        for (const filename of CONFIG_FILENAMES) {
            const candidate = join(dir, filename);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        const parent = join(dir, "..");
        if (parent === dir || dir === root)
            break;
        dir = parent;
    }
    return null;
}
function findConfigFile(cwd) {
    const path = findConfigPath(cwd);
    if (!path)
        return null;
    const raw = readFileSync(path, "utf-8");
    return parseYaml(raw);
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
        planner_mode: overrides.plannerMode ??
            fileConfig.planner_mode ??
            DEFAULT_CONFIG.planner_mode,
    };
    const parsed = PlanpongConfigSchema.parse(merged);
    maybeEmitGeminiReviewerWarning(parsed);
    return parsed;
}
//# sourceMappingURL=loader.js.map