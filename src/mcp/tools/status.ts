import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readSessionState,
  readRoundFeedback,
  readRoundResponse,
} from "../../core/session.js";
import {
  formatTrajectory,
  severityFromFeedback,
} from "../../core/operations.js";

const inputSchema = {
  session_id: z.string().describe("Session ID to check"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
};

export function registerStatus(server: McpServer): void {
  server.tool(
    "planpong_status",
    "Check session state and round history for a planpong review session.",
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

      const rounds: Array<{
        round: number;
        feedback_summary?: string;
        verdict?: string;
        severity_counts?: { P1: number; P2: number; P3: number };
        response_summary?: string;
        accepted?: number;
        rejected?: number;
        deferred?: number;
      }> = [];

      const severities: Array<{ P1: number; P2: number; P3: number }> = [];

      for (let r = 1; r <= session.currentRound; r++) {
        const fb = readRoundFeedback(cwd, session.id, r);
        const resp = readRoundResponse(cwd, session.id, r);

        const roundInfo: (typeof rounds)[0] = { round: r };

        if (fb) {
          roundInfo.feedback_summary = fb.summary;
          roundInfo.verdict = fb.verdict;
          const severity = severityFromFeedback(fb);
          roundInfo.severity_counts = severity;
          severities.push(severity);
        }

        if (resp) {
          let accepted = 0,
            rejected = 0,
            deferred = 0;
          for (const response of resp.responses) {
            if (response.action === "accepted") accepted++;
            else if (response.action === "rejected") rejected++;
            else if (response.action === "deferred") deferred++;
          }
          roundInfo.response_summary = `${accepted} accepted, ${rejected} rejected, ${deferred} deferred`;
          roundInfo.accepted = accepted;
          roundInfo.rejected = rejected;
          roundInfo.deferred = deferred;
        }

        rounds.push(roundInfo);
      }

      const trajectory =
        severities.length > 0
          ? formatTrajectory(severities)
          : "No rounds completed";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session: {
                id: session.id,
                plan_path: session.planPath,
                status: session.status,
                current_round: session.currentRound,
                started_at: session.startedAt,
                planner: session.planner,
                reviewer: session.reviewer,
              },
              rounds,
              trajectory,
            }),
          },
        ],
      };
    },
  );
}
