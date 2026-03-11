import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStartReview } from "./tools/start-review.js";
import { registerGetFeedback } from "./tools/get-feedback.js";
import { registerRevise } from "./tools/revise.js";
import { registerStatus } from "./tools/status.js";
import { registerListSessions } from "./tools/list-sessions.js";
import { registerGetReport } from "./tools/get-report.js";

export function createPlanpongServer(): McpServer {
  const server = new McpServer(
    {
      name: "planpong",
      version: "0.1.0",
    },
    {
      instructions: `Planpong is a multi-model adversarial plan review tool. It sends plans to a reviewer model for critique, then to a planner model for revision, iterating until the plan converges.

Planpong uses a three-phase review process:
- **Phase 1 (Round 1) — Direction:** The reviewer evaluates high-level direction — is this the right problem, approach, and scope? The planner can make sweeping changes if directional feedback warrants it.
- **Phase 2 (Round 2) — Risk / Pre-mortem:** The reviewer assumes the plan will fail and surfaces hidden assumptions, dependencies, and failure modes. The planner adds mitigations for accepted risks.
- **Phase 3 (Rounds 3+) — Detail:** The reviewer shifts to implementation completeness — missing steps, edge cases, gaps. The planner makes surgical, targeted fixes.

The "phase" field in tool responses tells you which phase is active. Mention the phase to the user so they understand why feedback character changes between rounds.

When the user asks you to review a plan:
1. Call planpong_start_review with the plan path. Pass interactive: true if the user asks to review interactively, step by step, or wants to approve each round. Default is false (autonomous).
2. Call planpong_get_feedback to get reviewer critique
3. Show the user the feedback summary and issues (note: round 1 is directional review)
4. If is_converged is false, call planpong_revise to revise the plan
5. Show the user the revision summary (accepted/rejected/deferred)
6. Repeat steps 2-5 until converged or max rounds reached

Execution mode (check the "interactive" field in planpong_start_review response):
- interactive: false (default) — Run the full loop autonomously. Do NOT ask the user for confirmation between rounds. Only pause if an error occurs or the user explicitly interrupts. Present a brief summary after each round but keep going.
- interactive: true — After each round, present the results and ask the user if they want to continue, stop, or adjust before proceeding to the next step.

When the review completes (converged OR max rounds reached):
1. Display the status_line from the final tool response — this is the canonical summary.
2. Generate a "Summary of what changed" table comparing the initial plan to the final plan. The final get_feedback response includes initial_plan and final_plan when converged. For max rounds, read the plan file yourself. The table should have columns: Area | Original | Final — showing the key decisions and approaches that changed during the review. Keep it to the most meaningful changes (5-10 rows max). Use a markdown table.
3. If the review hit max rounds without converging, note which reviewer concerns remain unresolved and whether they are substantive or deployment-level details.

Phase-specific feedback:
- Direction phase (R1) returns a confidence level. Risk phase (R2) returns a risk level and risk register summary.
- If is_blocked is true, the review has been terminated early because the plan is fundamentally non-viable. Do NOT call planpong_revise — instead show the blocking rationale and suggest the user fix the underlying issue.
- Use planpong_get_report after the review completes to get detailed phase-specific data (alternatives, assumptions, full risk register) on demand.`,
    },
  );

  registerStartReview(server);
  registerGetFeedback(server);
  registerRevise(server);
  registerStatus(server);
  registerListSessions(server);
  registerGetReport(server);

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
            text: `Review the plan at ${args.plan_path} using planpong. Run the full review loop autonomously (start_review → get_feedback → revise → repeat until converged). Print a brief summary after each round. When done, display the final status line and a summary table of what changed.`,
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

  server.registerPrompt(
    "report",
    {
      title: "Get review report",
      description:
        "Get a detailed phase-specific report for a completed or in-progress review session",
      argsSchema: {
        session_id: z.string().describe("Session ID to generate report for"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Get the detailed report for planpong session ${args.session_id}. Show the direction assessment (confidence, alternatives, assumptions), risk register (risks with likelihood/impact), and detail round history. Present the information in a readable format.`,
          },
        },
      ],
    }),
  );

  return server;
}
