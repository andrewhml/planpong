import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStartReview } from "./tools/start-review.js";
import { registerGetFeedback } from "./tools/get-feedback.js";
import { registerRevise } from "./tools/revise.js";
import { registerStatus } from "./tools/status.js";
import { registerListSessions } from "./tools/list-sessions.js";

export function createPlanpongServer(): McpServer {
  const server = new McpServer(
    {
      name: "planpong",
      version: "0.1.0",
    },
    {
      instructions: `Planpong is a multi-model adversarial plan review tool. It sends plans to a reviewer model for critique, then to a planner model for revision, iterating until the plan converges.

When the user asks you to review a plan:
1. Call planpong_start_review with the plan path
2. Call planpong_get_feedback to get reviewer critique
3. Show the user the feedback summary and issues
4. If is_converged is false, call planpong_revise to revise the plan
5. Show the user the revision summary (accepted/rejected/deferred)
6. Repeat steps 2-5 until converged or max rounds reached

Run the full loop autonomously — do NOT ask the user for confirmation between rounds. Only pause if an error occurs or the user explicitly asks to stop. Present results after each round but keep going.`,
    },
  );

  registerStartReview(server);
  registerGetFeedback(server);
  registerRevise(server);
  registerStatus(server);
  registerListSessions(server);

  return server;
}
