import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../../config/loader.js";
import { getProvider } from "../../providers/registry.js";
import { readSessionState } from "../../core/session.js";
import {
  runRevisionRound,
  writeStatusLineToPlan,
} from "../../core/operations.js";

const inputSchema = {
  session_id: z.string().describe("Session ID from planpong_start_review"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
};

export function registerRevise(server: McpServer): void {
  server.tool(
    "planpong_revise",
    "Send plan + latest feedback to the planner model for revision. Writes the updated plan to disk. Call after planpong_get_feedback returns is_converged: false.",
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

      const config = loadConfig({ cwd });
      const plannerProvider = getProvider(session.planner.provider);
      if (!plannerProvider) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Planner provider not found: ${session.planner.provider}`,
              }),
            },
          ],
          isError: true,
        };
      }

      const sessionConfig = {
        ...config,
        planner: session.planner,
        reviewer: session.reviewer,
      };

      const result = await runRevisionRound(
        session,
        cwd,
        sessionConfig,
        plannerProvider,
      );

      // Update status line in plan file (planner may have mangled it)
      const statusLine = writeStatusLineToPlan(
        session,
        cwd,
        sessionConfig,
        "Revision submitted",
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              round: result.round,
              responses: result.revision.responses,
              accepted: result.accepted,
              rejected: result.rejected,
              deferred: result.deferred,
              plan_updated: result.planUpdated,
              status_line: statusLine,
            }),
          },
        ],
      };
    },
  );
}
