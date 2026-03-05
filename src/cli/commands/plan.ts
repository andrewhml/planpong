import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { confirm } from "@inquirer/prompts";
import type { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import {
  getProvider,
  getAvailableProviders,
} from "../../providers/registry.js";
import { runLoop, type LoopCallbacks } from "../../core/loop.js";
import {
  printBanner,
  printPlanGenerated,
  printFeedbackSummary,
  printRevisionSummary,
  printConverged,
  printMaxRounds,
  printAborted,
  createSpinner,
} from "../ui.js";

interface PlanOptions {
  name?: string;
  plannerProvider?: string;
  plannerModel?: string;
  plannerEffort?: string;
  reviewerProvider?: string;
  reviewerModel?: string;
  reviewerEffort?: string;
  plansDir?: string;
  maxRounds?: string;
  autonomous?: boolean;
}

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Generate and review a plan through adversarial refinement")
    .argument("<requirements>", "Requirements text or path to a .md/.txt file")
    .option("--name <name>", "Plan filename slug (auto-generated if omitted)")
    .option("--planner-provider <provider>", "Planner provider (claude, codex)")
    .option("--planner-model <model>", "Planner model override")
    .option("--planner-effort <effort>", "Planner effort level")
    .option(
      "--reviewer-provider <provider>",
      "Reviewer provider (claude, codex)",
    )
    .option("--reviewer-model <model>", "Reviewer model override")
    .option("--reviewer-effort <effort>", "Reviewer effort level")
    .option("--plans-dir <dir>", "Plans output directory")
    .option("--max-rounds <n>", "Maximum review rounds")
    .option("--autonomous", "Run without human-in-loop pauses")
    .action(async (requirementsArg: string, opts: PlanOptions) => {
      printBanner();

      const cwd = process.cwd();

      // Resolve requirements: file path or inline text
      let requirements: string;
      if (requirementsArg.endsWith(".md") || requirementsArg.endsWith(".txt")) {
        const filePath = resolve(cwd, requirementsArg);
        requirements = readFileSync(filePath, "utf-8");
      } else {
        requirements = requirementsArg;
      }

      // Load config with CLI overrides
      const config = loadConfig({
        cwd,
        overrides: {
          plannerProvider: opts.plannerProvider,
          plannerModel: opts.plannerModel,
          plannerEffort: opts.plannerEffort,
          reviewerProvider: opts.reviewerProvider,
          reviewerModel: opts.reviewerModel,
          reviewerEffort: opts.reviewerEffort,
          plansDir: opts.plansDir,
          maxRounds: opts.maxRounds ? parseInt(opts.maxRounds, 10) : undefined,
          autonomous: opts.autonomous,
        },
      });

      // Check provider availability
      const available = await getAvailableProviders();
      const availableNames = available.map((p) => p.name);
      const plannerAvailable = availableNames.includes(config.planner.provider);
      const reviewerAvailable = availableNames.includes(
        config.reviewer.provider,
      );

      if (!plannerAvailable || !reviewerAvailable) {
        const missing: string[] = [];
        if (!plannerAvailable)
          missing.push(`planner: ${config.planner.provider}`);
        if (!reviewerAvailable)
          missing.push(`reviewer: ${config.reviewer.provider}`);
        console.error(
          `Error: Provider(s) not available: ${missing.join(", ")}`,
        );
        console.error(
          `Available: ${availableNames.join(", ") || "none detected"}`,
        );
        process.exit(1);
      }

      const plannerProvider = getProvider(config.planner.provider);
      const reviewerProvider = getProvider(config.reviewer.provider);

      if (!plannerProvider || !reviewerProvider) {
        console.error("Error: Could not resolve provider instances.");
        process.exit(1);
      }

      // Wire callbacks
      const callbacks: LoopCallbacks = {
        async onPlanGenerated(planPath, _content) {
          printPlanGenerated(planPath);
        },

        onReviewStarting(round) {
          const spinner = createSpinner(
            `Round ${round}: Sending to reviewer (${config.reviewer.provider})...`,
          );
          // Store spinner so onReviewComplete can stop it
          (callbacks as any)._reviewSpinner = spinner;
        },

        async onReviewComplete(round, feedback) {
          (callbacks as any)._reviewSpinner?.stop();
          printFeedbackSummary(round, feedback);
        },

        onRevisionStarting(round) {
          const spinner = createSpinner(
            `Round ${round}: Planner revising (${config.planner.provider})...`,
          );
          (callbacks as any)._revisionSpinner = spinner;
        },

        async onRevisionComplete(round, revision) {
          (callbacks as any)._revisionSpinner?.stop();
          printRevisionSummary(round, revision);
        },

        onConverged(round, _feedback) {
          printConverged(round);
        },

        onMaxRoundsReached(_round) {
          printMaxRounds(config.max_rounds);
        },

        async onHashMismatch(planPath, _autonomous) {
          const overwrite = await confirm({
            message: `Plan file was modified externally (${planPath}). Overwrite with revision?`,
            default: true,
          });
          return overwrite ? "overwrite" : "abort";
        },

        async confirmContinue(message) {
          return confirm({ message, default: true });
        },
      };

      try {
        await runLoop({
          requirements,
          cwd,
          config,
          plannerProvider,
          reviewerProvider,
          planName: opts.name,
          callbacks,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${msg}`);
        process.exit(1);
      }
    });
}
