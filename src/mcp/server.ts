import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStartReview } from "./tools/start-review.js";
import { registerGetFeedback } from "./tools/get-feedback.js";
import { registerRevise } from "./tools/revise.js";
import { registerStatus } from "./tools/status.js";
import { registerListSessions } from "./tools/list-sessions.js";

export function createPlanpongServer(): McpServer {
  const server = new McpServer({
    name: "planpong",
    version: "0.1.0",
  });

  registerStartReview(server);
  registerGetFeedback(server);
  registerRevise(server);
  registerStatus(server);
  registerListSessions(server);

  return server;
}
