import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../../config/loader.js";
import { getProvider } from "../../providers/registry.js";
import {
  readSessionState,
  writeSessionState,
  readInitialPlan,
} from "../../core/session.js";
import {
  runReviewRound,
  severityFromFeedback,
  writeStatusLineToPlan,
} from "../../core/operations.js";
import { getReviewPhase } from "../../prompts/reviewer.js";

const inputSchema = {
  session_id: z.string().describe("Session ID from planpong_start_review"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
};

export function registerGetFeedback(server: McpServer): void {
  server.tool(
    "planpong_get_feedback",
    "Send the current plan to the reviewer model for critique. Returns structured feedback with issues, severity counts, and convergence status.",
    inputSchema,
    async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const session = readSessionState(cwd, input.session_id);

      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Session not found: ${input.session_id}`,
              }),
            },
          ],
          isError: true,
        };
      }

      if (session.status !== "in_review") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Session status is '${session.status}', expected 'in_review'`,
              }),
            },
          ],
          isError: true,
        };
      }

      // Advance round
      session.currentRound++;
      writeSessionState(cwd, session);

      const config = loadConfig({ cwd });
      // Use session-stored provider config
      const reviewerProvider = getProvider(session.reviewer.provider);
      if (!reviewerProvider) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Reviewer provider not found: ${session.reviewer.provider}`,
              }),
            },
          ],
          isError: true,
        };
      }

      // Build config with session overrides
      const sessionConfig = {
        ...config,
        reviewer: session.reviewer,
        planner: session.planner,
      };

      const result = await runReviewRound(
        session,
        cwd,
        sessionConfig,
        reviewerProvider,
      );

      // Update status line with review results
      const suffix = result.converged
        ? `Approved after ${result.round} rounds`
        : `Reviewed — ${result.feedback.issues.length} issues`;
      const statusLine = writeStatusLineToPlan(
        session,
        cwd,
        sessionConfig,
        suffix,
      );

      const phase = getReviewPhase(result.round);
      const response: Record<string, unknown> = {
        round: result.round,
        phase,
        verdict: result.feedback.verdict,
        summary: result.feedback.summary,
        issues: result.feedback.issues,
        severity_counts: result.severity,
        is_converged: result.converged,
        status_line: statusLine,
      };

      if (result.converged) {
        session.status = "approved";
        const planPath = resolve(cwd, session.planPath);
        let planContent = readFileSync(planPath, "utf-8");
        planContent = planContent.replace(
          /\*\*Status:\*\* .*/,
          "**Status:** Approved",
        );
        writeFileSync(planPath, planContent);
        writeSessionState(cwd, session);

        // Include initial plan for change summary
        const initialPlan = readInitialPlan(cwd, session.id);
        if (initialPlan) {
          response.initial_plan = initialPlan;
          response.final_plan = readFileSync(planPath, "utf-8");
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: statusLine,
          },
          {
            type: "text" as const,
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );
}
