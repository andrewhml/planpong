import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { setConfigValuesBatch, } from "../../config/mutate.js";
import { findConfigPath } from "../../config/loader.js";
import { DEFAULT_CONFIG } from "../../config/defaults.js";
import { getAllProviders, getInstallHint, } from "../../providers/registry.js";
/**
 * Wizard answer meaning "don't pin this; let the provider CLI decide". A
 * symbol, never a string, so it can't collide with a model name or be
 * written to disk.
 */
export const CLI_DEFAULT = Symbol("cli-default");
/**
 * Map an effort level to a human-readable label for the wizard.
 * Falls through to the raw value for unknown levels (future-proofing
 * against new effort tiers).
 */
export function effortLabel(level) {
    switch (level) {
        case "low":
            return "low (fastest, cheapest)";
        case "medium":
            return "medium";
        case "high":
            return "high (recommended)";
        case "xhigh":
            return "xhigh (more thorough, slower)";
        case "max":
            return "max (most thorough, slowest)";
        default:
            return level;
    }
}
/**
 * Model choices for one role. The old model is offered only when the
 * provider is unchanged: a pinned model outside the catalog stays
 * selectable (and preselected) so re-running the wizard never silently
 * drops a pin, while switching provider never carries a model across.
 */
export function buildModelChoices(providerName, catalog, providerChanged, diskModel) {
    const choices = [
        { name: `CLI default (follow ${providerName}'s own configured model)`, value: CLI_DEFAULT },
        ...catalog.models.map((m) => ({ name: m.id, value: m.id })),
    ];
    if (providerChanged || !diskModel)
        return { choices, default: CLI_DEFAULT };
    if (!catalog.models.some((m) => m.id === diskModel)) {
        choices.push({ name: `${diskModel} (current, not in catalog)`, value: diskModel });
    }
    return { choices, default: diskModel };
}
/**
 * Effort choices for one role, or null when the provider has no effort
 * levels. With a pinned catalog model, offer that model's levels; with CLI
 * default, only levels every model accepts (the intersection); with an
 * unknown pinned model, the union. Advisory levels (codex `ultra`) are not
 * suggested, except a current pin that is kept visible.
 */
export function buildEffortChoices(catalog, model, providerChanged, diskEffort) {
    if (catalog.allEfforts.length === 0)
        return null;
    const known = typeof model === "string" ? catalog.models.find((m) => m.id === model) : undefined;
    const available = model === CLI_DEFAULT ? catalog.efforts : known ? known.efforts : catalog.allEfforts;
    const suggested = available.filter((e) => !(e in catalog.advisories));
    const choices = [
        { name: "CLI default", value: CLI_DEFAULT },
        ...suggested.map((e) => ({ name: effortLabel(e), value: e })),
    ];
    const hint = model === CLI_DEFAULT && catalog.efforts.length < catalog.allEfforts.length
        ? "pin a model to see its full effort range"
        : undefined;
    if (providerChanged || !diskEffort || !available.includes(diskEffort)) {
        return { choices, default: CLI_DEFAULT, hint };
    }
    if (!suggested.includes(diskEffort)) {
        choices.push({ name: `${diskEffort} (current)`, value: diskEffort });
    }
    return { choices, default: diskEffort, hint };
}
const GEMINI_REVIEWER_INLINE_WARNING = "warning: gemini reviewer rounds run without persistent session resumption.\n" +
    "         expect noticeably slower per-round wall time than claude/codex.\n" +
    "         tracked: see Future work in docs/plans/gemini-and-init-wizard.md";
/**
 * Read the config file the writer will modify into a partial snapshot.
 * Resolves with findConfigPath (walks parent directories), the same lookup
 * setConfigValuesBatch uses, so the wizard's view and its write target are
 * the same file. Unlike loadConfig(), this does NOT merge defaults: fields
 * the user never wrote remain undefined so the wizard can omit them.
 */
export function readDiskSnapshot(cwd) {
    const path = findConfigPath(cwd);
    if (!path)
        return { path: null, snapshot: {} };
    const raw = readFileSync(path, "utf-8");
    return { path, snapshot: parseYaml(raw) ?? {} };
}
/**
 * Pure formatter for the post-write summary. The auth reminder appears
 * whenever gemini is picked for any role; it is intentionally a static
 * message rather than a probe of auth state.
 */
export function formatPostWriteSummary(answers) {
    const lines = [];
    lines.push("");
    lines.push("Run 'planpong review <plan-file>' to start a review, or", "    'planpong plan <requirements>' to generate a new plan.");
    if (answers.plannerProvider === "gemini" ||
        answers.reviewerProvider === "gemini") {
        lines.push("");
        lines.push("Note: gemini requires Google account auth. Run `gemini` once", "      before invoking planpong if you haven't already.");
    }
    return lines.join("\n");
}
/**
 * Convert the wizard's answer object plus the on-disk-file snapshot into
 * the batch picks list. Omits keys whose answer matches the on-disk value
 * so the wizard never writes a default into an existing yaml the user
 * didn't touch. Output order is stable to keep diff output predictable.
 */
export function answersToPicks(answers, disk) {
    const picks = [];
    const add = (key, answer, diskValue) => {
        if (answer === CLI_DEFAULT) {
            // "Let the CLI decide": remove a pin if there is one, else nothing.
            if (diskValue !== undefined)
                picks.push({ key, unset: true });
            return;
        }
        if (answer === diskValue)
            return;
        picks.push({ key, rawValue: String(answer) });
    };
    add("planner.provider", answers.plannerProvider, disk.planner?.provider);
    add("planner.model", answers.plannerModel, disk.planner?.model);
    if (answers.plannerEffort !== undefined) {
        add("planner.effort", answers.plannerEffort, disk.planner?.effort);
    }
    add("reviewer.provider", answers.reviewerProvider, disk.reviewer?.provider);
    add("reviewer.model", answers.reviewerModel, disk.reviewer?.model);
    if (answers.reviewerEffort !== undefined) {
        add("reviewer.effort", answers.reviewerEffort, disk.reviewer?.effort);
    }
    add("max_rounds", answers.maxRounds, disk.max_rounds);
    add("plans_dir", answers.plansDir, disk.plans_dir);
    add("planner_mode", answers.plannerMode, disk.planner_mode);
    add("revision_mode", answers.revisionMode, disk.revision_mode);
    add("human_in_loop", answers.humanInLoop, disk.human_in_loop);
    return picks;
}
async function probeProviders() {
    const all = getAllProviders();
    return Promise.all(all.map(async (p) => ({ provider: p, available: await p.isAvailable() })));
}
function printDetectionTable(statuses) {
    console.log(chalk.bold("\nDetected CLIs:"));
    for (const s of statuses) {
        const mark = s.available ? chalk.green("✓") : chalk.dim("✗");
        const name = s.provider.name.padEnd(8);
        if (s.available) {
            console.log(`  ${mark} ${name}available`);
        }
        else {
            console.log(`  ${mark} ${name}${chalk.dim("not installed — " + getInstallHint(s.provider.name))}`);
        }
    }
    console.log();
}
/**
 * Detect whether stdin is a real TTY. Node sets `isTTY` to `true` for a TTY
 * and leaves it `undefined` (NOT `false`) for pipes/redirects, so a strict
 * `=== false` check would silently let the wizard fall through to inquirer
 * and hang on the first prompt.
 */
export function isInteractiveTty(stdin) {
    return stdin.isTTY === true;
}
async function runWizard(cwd) {
    if (!isInteractiveTty(process.stdin)) {
        process.stderr.write("planpong init must run interactively. Use 'planpong config set <key> <value>' for scripted setup.\n");
        process.exitCode = 1;
        return;
    }
    console.log(chalk.bold("\nplanpong init") + chalk.dim(" — first-run setup\n"));
    const statuses = await probeProviders();
    printDetectionTable(statuses);
    const installed = statuses.filter((s) => s.available);
    if (installed.length === 0) {
        console.error(chalk.red("No supported AI CLIs are installed."), "Install at least one of:");
        for (const s of statuses) {
            console.error(`  - ${getInstallHint(s.provider.name)}`);
        }
        process.exitCode = 1;
        return;
    }
    const { path: diskPath, snapshot: disk } = readDiskSnapshot(cwd);
    console.log(chalk.dim(diskPath ? `Editing ${diskPath}\n` : "No planpong.yaml found; one will be created in this directory.\n"));
    const installedChoices = installed.map((s) => ({
        name: s.provider.name,
        value: s.provider.name,
    }));
    const printedNotes = new Set();
    const askRole = async (role, label, providerName) => {
        const provider = statuses.find((s) => s.provider.name === providerName)?.provider;
        if (!provider)
            return { model: CLI_DEFAULT, effort: CLI_DEFAULT };
        const catalog = await provider.getModelCatalog();
        if (catalog.note && !printedNotes.has(catalog.note)) {
            printedNotes.add(catalog.note);
            console.log(chalk.yellow(`  note: ${catalog.note}`));
        }
        const diskRole = disk[role];
        const providerChanged = providerName !== (diskRole?.provider ?? DEFAULT_CONFIG[role].provider);
        const modelChoices = buildModelChoices(providerName, catalog, providerChanged, diskRole?.model);
        const model = await select({
            message: `${label} model:`,
            choices: modelChoices.choices,
            default: modelChoices.default,
        });
        const effortChoices = buildEffortChoices(catalog, model, providerChanged, diskRole?.effort);
        // No effort levels for this provider: clear any stale pin.
        if (!effortChoices)
            return { model, effort: CLI_DEFAULT };
        if (effortChoices.hint)
            console.log(chalk.dim(`  ${effortChoices.hint}`));
        const effort = await select({
            message: `${label} effort level:`,
            choices: effortChoices.choices,
            default: effortChoices.default,
        });
        return { model, effort };
    };
    const plannerProvider = await select({
        message: "Planner provider:",
        choices: installedChoices,
        default: disk.planner?.provider ?? installedChoices[0].value,
    });
    const planner = await askRole("planner", "Planner", plannerProvider);
    const reviewerProvider = await select({
        message: "Reviewer provider:",
        choices: installedChoices,
        default: disk.reviewer?.provider ?? installedChoices[0].value,
    });
    if (reviewerProvider === plannerProvider) {
        console.log(chalk.yellow("  note: planner and reviewer use the same provider. Adversarial signal is reduced when both roles share a model lineage."));
    }
    const reviewer = await askRole("reviewer", "Reviewer", reviewerProvider);
    const maxRoundsRaw = await input({
        message: "Maximum review rounds:",
        default: String(disk.max_rounds ?? 10),
        validate: (v) => {
            const n = Number(v);
            return Number.isInteger(n) && n >= 1 && n <= 50
                ? true
                : "Enter an integer between 1 and 50.";
        },
    });
    const plansDir = await input({
        message: "Plans directory:",
        default: disk.plans_dir ?? "docs/plans",
    });
    const plannerMode = (await select({
        message: "Planner mode:",
        choices: [
            { name: "inline (you act as the planner)", value: "inline" },
            { name: "external (route revisions through the planner provider)", value: "external" },
        ],
        default: disk.planner_mode ?? "inline",
    }));
    const revisionMode = (await select({
        message: "Revision mode:",
        choices: [
            { name: "full (planner re-emits the entire plan each round — simple, slower)", value: "full" },
            { name: "edits (planner emits targeted text replacements — faster on mature plans)", value: "edits" },
        ],
        default: disk.revision_mode ?? "full",
    }));
    const humanInLoop = (await select({
        message: "Pause between rounds for review?",
        choices: [
            { name: "yes (recommended — confirm or redirect after each round)", value: true },
            { name: "no (run autonomously to convergence or round limit)", value: false },
        ],
        default: disk.human_in_loop ?? true,
    }));
    if (reviewerProvider === "gemini") {
        console.log("\n" + chalk.yellow(GEMINI_REVIEWER_INLINE_WARNING) + "\n");
    }
    const answers = {
        plannerProvider,
        plannerModel: planner.model,
        plannerEffort: planner.effort,
        reviewerProvider,
        reviewerModel: reviewer.model,
        reviewerEffort: reviewer.effort,
        maxRounds: Number(maxRoundsRaw),
        plansDir,
        plannerMode,
        revisionMode,
        humanInLoop,
    };
    const picks = answersToPicks(answers, disk);
    if (picks.length === 0) {
        console.log(chalk.dim("No changes — your planpong.yaml already matches these answers."));
        return;
    }
    console.log(chalk.bold("\nProposed changes:"));
    for (const p of picks) {
        const after = p.unset ? "(unset, CLI default)" : p.rawValue;
        console.log(`  ${p.key.padEnd(20)} → ${after}`);
    }
    const proceed = await confirm({
        message: diskPath
            ? `Update ${diskPath} with these changes?`
            : "Write planpong.yaml in this directory?",
        default: true,
    });
    if (!proceed) {
        console.log(chalk.dim("Cancelled, no changes written."));
        return;
    }
    const result = setConfigValuesBatch(cwd, picks, diskPath ? { configPath: diskPath } : undefined);
    console.log(chalk.green(result.created ? "Created" : "Updated"), result.configPath);
    console.log(formatPostWriteSummary(answers));
}
export function registerInitCommand(program) {
    program
        .command("init")
        .description("Interactive setup wizard — produces a working planpong.yaml")
        .action(async () => {
        try {
            await runWizard(process.cwd());
        }
        catch (err) {
            const e = err;
            if (e?.name === "ExitPromptError") {
                console.log(chalk.dim("\nAborted, no changes written."));
                return;
            }
            console.error(chalk.red("Error:"), e?.message ?? String(err));
            process.exitCode = 1;
        }
    });
}
//# sourceMappingURL=init.js.map