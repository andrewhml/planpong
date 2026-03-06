import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "../../schemas/session.js";

const SESSIONS_DIR = ".planpong/sessions";

const inputSchema = {
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
};

export function registerListSessions(server: McpServer): void {
  server.tool(
    "planpong_list_sessions",
    "List all planpong review sessions in the current project.",
    inputSchema,
    async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const sessionsDir = join(cwd, SESSIONS_DIR);

      if (!existsSync(sessionsDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ sessions: [] }),
            },
          ],
        };
      }

      const entries = readdirSync(sessionsDir, { withFileTypes: true });
      const sessions: Array<{
        id: string;
        plan_path: string;
        status: string;
        current_round: number;
        started_at: string;
        planner: string;
        reviewer: string;
      }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionFile = join(sessionsDir, entry.name, "session.json");
        if (!existsSync(sessionFile)) continue;

        try {
          const session = JSON.parse(
            readFileSync(sessionFile, "utf-8"),
          ) as Session;
          sessions.push({
            id: session.id,
            plan_path: session.planPath,
            status: session.status,
            current_round: session.currentRound,
            started_at: session.startedAt,
            planner: session.planner.provider,
            reviewer: session.reviewer.provider,
          });
        } catch {
          // Skip malformed session files
        }
      }

      // Sort by started_at descending
      sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ sessions }),
          },
        ],
      };
    },
  );
}
