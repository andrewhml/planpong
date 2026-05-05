import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { setConfigValuesBatch, } from "../../config/mutate.js";
import { getAllProviders, getInstallHint, } from "../../providers/registry.js";
const CONFIG_FILENAMES = [
    "planpong.yaml",
    "planpong.yml",
    ".planpong.yaml",
    ".planpong.yml",
];
const GEMINI_REVIEWER_INLINE_WARNING = "warning: gemini reviewer rounds run without persistent session resumption.\n" +
    "         expect noticeably slower per-round wall time than claude/codex.\n" +
    "         tracked: see Future work in docs/plans/gemini-and-init-wizard.md";
/**
 * Read planpong.yaml directly into a partial snapshot. Unlike loadConfig(),
 * this does NOT merge defaults — fields the user never wrote remain
 * undefined so the wizard can omit them from the batch write.
 */
export function readDiskSnapshot(cwd) {
    for (const filename of CONFIG_FILENAMES) {
        const candidate = join(cwd, filename);
        if (existsSync(candidate)) {
            const raw = readFileSync(candidate, "utf-8");
            return parseYaml(raw) ?? {};
        }
    }
    return {};
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
        if (answer === diskValue)
            return;
        picks.push({ key, rawValue: String(answer) });
    };
    add("planner.provider", answers.plannerProvider, disk.planner?.provider);
    add("planner.model", answers.plannerModel, disk.planner?.model);
    add("reviewer.provider", answers.reviewerProvider, disk.reviewer?.provider);
    add("reviewer.model", answers.reviewerModel, disk.reviewer?.model);
    add("max_rounds", answers.maxRounds, disk.max_rounds);
    add("plans_dir", answers.plansDir, disk.plans_dir);
    add("planner_mode", answers.plannerMode, disk.planner_mode);
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
    const disk = readDiskSnapshot(cwd);
    const installedChoices = installed.map((s) => ({
        name: s.provider.name,
        value: s.provider.name,
    }));
    const plannerProvider = await select({
        message: "Planner provider:",
        choices: installedChoices,
        default: disk.planner?.provider ?? installedChoices[0].value,
    });
    const plannerModelChoices = (statuses.find((s) => s.provider.name === plannerProvider)?.provider.getModels() ?? []).map((m) => ({ name: m, value: m }));
    const plannerModel = await select({
        message: "Planner model:",
        choices: plannerModelChoices,
        default: disk.planner?.model ?? plannerModelChoices[0]?.value,
    });
    const reviewerProvider = await select({
        message: "Reviewer provider:",
        choices: installedChoices,
        default: disk.reviewer?.provider ?? installedChoices[0].value,
    });
    if (reviewerProvider === plannerProvider) {
        console.log(chalk.yellow("  note: planner and reviewer use the same provider. Adversarial signal is reduced when both roles share a model lineage."));
    }
    const reviewerModelChoices = (statuses.find((s) => s.provider.name === reviewerProvider)?.provider.getModels() ?? []).map((m) => ({ name: m, value: m }));
    const reviewerModel = await select({
        message: "Reviewer model:",
        choices: reviewerModelChoices,
        default: disk.reviewer?.model ?? reviewerModelChoices[0]?.value,
    });
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
    if (reviewerProvider === "gemini") {
        console.log("\n" + chalk.yellow(GEMINI_REVIEWER_INLINE_WARNING) + "\n");
    }
    const answers = {
        plannerProvider,
        plannerModel,
        reviewerProvider,
        reviewerModel,
        maxRounds: Number(maxRoundsRaw),
        plansDir,
        plannerMode,
    };
    const picks = answersToPicks(answers, disk);
    if (picks.length === 0) {
        console.log(chalk.dim("No changes — your planpong.yaml already matches these answers."));
        return;
    }
    console.log(chalk.bold("\nProposed changes:"));
    for (const p of picks) {
        console.log(`  ${p.key.padEnd(20)} → ${p.rawValue}`);
    }
    const proceed = await confirm({
        message: existsSync(join(cwd, "planpong.yaml"))
            ? "Update planpong.yaml with these changes?"
            : "Write planpong.yaml in this directory?",
        default: true,
    });
    if (!proceed) {
        console.log(chalk.dim("Cancelled, no changes written."));
        return;
    }
    const result = setConfigValuesBatch(cwd, picks);
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