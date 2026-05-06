import { resolve } from "node:path";
import { confirm } from "@inquirer/prompts";
import { loadConfig } from "../../config/loader.js";
import { getProvider, getAvailableProviders, } from "../../providers/registry.js";
import { runReviewLoop, } from "../../core/loop.js";
import { printBanner, printPlanGenerated, printFeedbackSummary, printRevisionSummary, printConverged, printMaxRounds, createSpinner, } from "../ui.js";
export function registerReviewCommand(program) {
    program
        .command("review")
        .description("Review an existing plan file through adversarial refinement")
        .argument("<plan-file>", "Path to the plan markdown file")
        .option("--planner-provider <provider>", "Planner provider (claude, codex, gemini)")
        .option("--planner-model <model>", "Planner model override (see 'planpong config providers')")
        .option("--planner-effort <effort>", "Planner effort level (see 'planpong config providers')")
        .option("--reviewer-provider <provider>", "Reviewer provider (claude, codex, gemini)")
        .option("--reviewer-model <model>", "Reviewer model override (see 'planpong config providers')")
        .option("--reviewer-effort <effort>", "Reviewer effort level (see 'planpong config providers')")
        .option("--max-rounds <n>", "Maximum review rounds (1-50)")
        .option("--autonomous", "Run without human-in-loop pauses (default for review)")
        .option("--json", "Output result as JSON (for programmatic use)")
        .action(async (planFileArg, opts) => {
        const cwd = process.cwd();
        const planPath = resolve(cwd, planFileArg);
        const jsonOutput = opts.json ?? false;
        // Default to autonomous for review command
        const autonomous = opts.autonomous ?? true;
        const config = loadConfig({
            cwd,
            overrides: {
                plannerProvider: opts.plannerProvider,
                plannerModel: opts.plannerModel,
                plannerEffort: opts.plannerEffort,
                reviewerProvider: opts.reviewerProvider,
                reviewerModel: opts.reviewerModel,
                reviewerEffort: opts.reviewerEffort,
                maxRounds: opts.maxRounds ? parseInt(opts.maxRounds, 10) : undefined,
                autonomous,
            },
        });
        // Check provider availability
        const available = await getAvailableProviders();
        const availableNames = available.map((p) => p.name);
        const plannerAvailable = availableNames.includes(config.planner.provider);
        const reviewerAvailable = availableNames.includes(config.reviewer.provider);
        if (!plannerAvailable || !reviewerAvailable) {
            const missing = [];
            if (!plannerAvailable)
                missing.push(`planner: ${config.planner.provider}`);
            if (!reviewerAvailable)
                missing.push(`reviewer: ${config.reviewer.provider}`);
            if (jsonOutput) {
                console.log(JSON.stringify({
                    error: `Providers not available: ${missing.join(", ")}`,
                }));
            }
            else {
                console.error(`Error: Provider(s) not available: ${missing.join(", ")}`);
                console.error(`Available: ${availableNames.join(", ") || "none detected"}`);
            }
            process.exit(1);
        }
        const plannerProvider = getProvider(config.planner.provider);
        const reviewerProvider = getProvider(config.reviewer.provider);
        if (!plannerProvider || !reviewerProvider) {
            if (jsonOutput) {
                console.log(JSON.stringify({ error: "Could not resolve provider instances" }));
            }
            else {
                console.error("Error: Could not resolve provider instances.");
            }
            process.exit(1);
        }
        if (!jsonOutput) {
            printBanner();
        }
        // Wire callbacks — quiet in JSON mode, verbose otherwise
        const callbacks = {
            async onPlanGenerated(path, _content) {
                if (!jsonOutput)
                    printPlanGenerated(path);
            },
            onReviewStarting(round) {
                if (!jsonOutput) {
                    const spinner = createSpinner(`Round ${round}: Sending to reviewer (${config.reviewer.provider})...`);
                    callbacks._reviewSpinner = spinner;
                }
            },
            async onReviewComplete(round, feedback) {
                if (!jsonOutput) {
                    callbacks._reviewSpinner?.stop();
                    printFeedbackSummary(round, feedback);
                }
            },
            onRevisionStarting(round) {
                if (!jsonOutput) {
                    const spinner = createSpinner(`Round ${round}: Planner revising (${config.planner.provider})...`);
                    callbacks._revisionSpinner = spinner;
                }
            },
            async onRevisionComplete(round, revision) {
                if (!jsonOutput) {
                    callbacks._revisionSpinner?.stop();
                    printRevisionSummary(round, revision);
                }
            },
            onConverged(round, _feedback) {
                if (!jsonOutput)
                    printConverged(round);
            },
            onMaxRoundsReached(_round) {
                if (!jsonOutput)
                    printMaxRounds(config.max_rounds);
            },
            async onHashMismatch(path, _autonomous) {
                if (autonomous)
                    return "overwrite";
                const overwrite = await confirm({
                    message: `Plan file was modified externally (${path}). Overwrite with revision?`,
                    default: true,
                });
                return overwrite ? "overwrite" : "abort";
            },
            async confirmContinue(message) {
                if (autonomous)
                    return true;
                return confirm({ message, default: true });
            },
        };
        let result;
        try {
            result = await runReviewLoop({
                planPath,
                cwd,
                config,
                plannerProvider,
                reviewerProvider,
                callbacks,
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (jsonOutput) {
                console.log(JSON.stringify({ error: msg }));
            }
            else {
                console.error(`\nError: ${msg}`);
            }
            process.exit(1);
        }
        if (jsonOutput) {
            console.log(JSON.stringify(result));
        }
        process.exit(result.status === "approved" ? 0 : 1);
    });
}
//# sourceMappingURL=review.js.map