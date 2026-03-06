import { z } from "zod";
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
1. Call planpong_start_review with the plan path. Pass interactive: true if the user asks to review interactively, step by step, or wants to approve each round. Default is false (autonomous).
2. Call planpong_get_feedback to get reviewer critique
3. Show the user the feedback summary and issues
4. If is_converged is false, call planpong_revise to revise the plan
5. Show the user the revision summary (accepted/rejected/deferred)
6. Repeat steps 2-5 until converged or max rounds reached

Execution mode (check the "interactive" field in planpong_start_review response):
- interactive: false (default) — Run the full loop autonomously. Do NOT ask the user for confirmation between rounds. Only pause if an error occurs or the user explicitly interrupts. Present a brief summary after each round but keep going.
- interactive: true — After each round, present the results and ask the user if they want to continue, stop, or adjust before proceeding to the next step.`,
    },
  );

  registerStartReview(server);
  registerGetFeedback(server);
  registerRevise(server);
  registerStatus(server);
  registerListSessions(server);

  // MCP prompts — become slash commands in Claude Code
  server.registerPrompt(
    "review",
    {
      title: "Review a plan",
      description:
        "Run adversarial plan review — reviewer critiques, planner revises, repeat until approved",
      argsSchema: {
        plan_path: z
          .string()
          .describe("Path to the plan file (e.g. docs/plans/my-feature.md)"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review the plan at ${args.plan_path} using planpong. Run the full review loop autonomously (start_review → get_feedback → revise → repeat until converged). Print a brief summary after each round.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_interactive",
    {
      title: "Review a plan (interactive)",
      description:
        "Run adversarial plan review with pauses between rounds for user input",
      argsSchema: {
        plan_path: z
          .string()
          .describe("Path to the plan file (e.g. docs/plans/my-feature.md)"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review the plan at ${args.plan_path} using planpong in interactive mode. Start the review with interactive: true, then after each round present the full results and ask me before continuing.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "status",
    {
      title: "Check review status",
      description:
        "Show the current state and round history of a planpong session",
      argsSchema: {
        session_id: z.string().describe("Session ID to check"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Check the status of planpong session ${args.session_id}. Show the session state, round history, and issue trajectory.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "sessions",
    {
      title: "List review sessions",
      description: "List all planpong review sessions in the current project",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "List all planpong review sessions in this project.",
          },
        },
      ],
    }),
  );

  return server;
}
