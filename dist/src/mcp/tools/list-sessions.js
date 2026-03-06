import { z } from "zod";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const SESSIONS_DIR = ".planpong/sessions";
const inputSchema = {
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export function registerListSessions(server) {
    server.tool("planpong_list_sessions", "List all planpong review sessions in the current project.", inputSchema, async (input) => {
        const cwd = input.cwd ?? process.cwd();
        const sessionsDir = join(cwd, SESSIONS_DIR);
        if (!existsSync(sessionsDir)) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ sessions: [] }),
                    },
                ],
            };
        }
        const entries = readdirSync(sessionsDir, { withFileTypes: true });
        const sessions = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const sessionFile = join(sessionsDir, entry.name, "session.json");
            if (!existsSync(sessionFile))
                continue;
            try {
                const session = JSON.parse(readFileSync(sessionFile, "utf-8"));
                sessions.push({
                    id: session.id,
                    plan_path: session.planPath,
                    status: session.status,
                    current_round: session.currentRound,
                    started_at: session.startedAt,
                    planner: session.planner.provider,
                    reviewer: session.reviewer.provider,
                });
            }
            catch {
                // Skip malformed session files
            }
        }
        // Sort by started_at descending
        sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ sessions }),
                },
            ],
        };
    });
}
//# sourceMappingURL=list-sessions.js.map