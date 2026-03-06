import { z } from "zod";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../../config/loader.js";
import {
  getProvider,
  getAvailableProviders,
} from "../../providers/registry.js";
import { initReviewSession } from "../../core/operations.js";

const inputSchema = {
  plan_path: z
    .string()
    .describe("Path to the plan markdown file (absolute or relative to cwd)"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
  max_rounds: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum review rounds"),
  planner: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
    })
    .optional()
    .describe("Planner configuration overrides"),
  reviewer: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
    })
    .optional()
    .describe("Reviewer configuration overrides"),
  interactive: z
    .boolean()
    .optional()
    .describe(
      "If true, pause after each round for user confirmation. Default: false (autonomous)",
    ),
};

export function registerStartReview(server: McpServer): void {
  server.tool(
    "planpong_start_review",
    "Create a review session for an existing plan file. Validates the file, loads config, checks provider availability, and creates a session. Does NOT invoke any models.",
    inputSchema,
    async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const planPath = resolve(cwd, input.plan_path);

      const config = loadConfig({
        cwd,
        overrides: {
          plannerProvider: input.planner?.provider,
          plannerModel: input.planner?.model,
          plannerEffort: input.planner?.effort,
          reviewerProvider: input.reviewer?.provider,
          reviewerModel: input.reviewer?.model,
          reviewerEffort: input.reviewer?.effort,
          maxRounds: input.max_rounds,
          autonomous: true,
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
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Providers not available: ${missing.join(", ")}`,
                available: availableNames,
              }),
            },
          ],
          isError: true,
        };
      }

      const { session, planContent } = initReviewSession(planPath, cwd, config);
      const planSummary = planContent.split("\n").slice(0, 20).join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: session.id,
              plan_path: planPath,
              plan_summary: planSummary,
              interactive: input.interactive ?? false,
              config: {
                planner: config.planner,
                reviewer: config.reviewer,
                max_rounds: config.max_rounds,
              },
            }),
          },
        ],
      };
    },
  );
}
