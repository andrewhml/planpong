import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readSessionState,
  readRoundFeedback,
  readRoundResponse,
} from "../../core/session.js";
import {
  severityFromFeedback,
  formatTrajectory,
} from "../../core/operations.js";
import { getReviewPhase } from "../../prompts/reviewer.js";
import type {
  PhaseFeedback,
  DirectionFeedback,
  RiskFeedback,
} from "../../schemas/feedback.js";
import type { PlannerRevision } from "../../schemas/revision.js";

const inputSchema = {
  session_id: z.string().describe("Session ID to generate report for"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
};

interface DirectionReport {
  confidence?: string;
  approach_assessment?: string;
  alternatives?: Array<{ approach: string; tradeoff: string }>;
  assumptions?: string[];
  issues: PhaseFeedback["issues"];
  revision_responses?: PlannerRevision["responses"];
  fallback_used: boolean;
}

interface RiskReport {
  risk_level?: string;
  risks?: Array<{
    id: string;
    category: string;
    likelihood: string;
    impact: string;
    title: string;
    description: string;
    mitigation: string;
  }>;
  issues: PhaseFeedback["issues"];
  revision_responses?: PlannerRevision["responses"];
  fallback_used: boolean;
}

interface DetailRoundReport {
  round: number;
  verdict: string;
  summary: string;
  issues: PhaseFeedback["issues"];
  revision_responses?: PlannerRevision["responses"];
  fallback_used: boolean;
}

export function registerGetReport(server: McpServer): void {
  server.tool(
    "planpong_get_report",
    "Get a detailed phase-specific report for a completed or in-progress review session. Shows direction assessment, risk register, and detail round history.",
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

      const isComplete =
        session.status === "approved" || session.status === "blocked";
      let fallbackCount = 0;

      // Build direction section (round 1)
      let direction: DirectionReport | "not_reached" = "not_reached";
      const r1Feedback = readRoundFeedback(cwd, session.id, 1);
      const r1Response = readRoundResponse(cwd, session.id, 1);

      if (r1Feedback) {
        const fb = r1Feedback as PhaseFeedback;
        const fallbackUsed = !!fb.fallback_used;
        if (fallbackUsed) fallbackCount++;

        const dirReport: DirectionReport = {
          issues: fb.issues,
          fallback_used: fallbackUsed,
        };

        // Extract direction-specific fields if present
        if ("confidence" in fb) {
          dirReport.confidence = (fb as DirectionFeedback).confidence;
        }
        if ("approach_assessment" in fb) {
          dirReport.approach_assessment = (fb as DirectionFeedback).approach_assessment;
        }
        if ("alternatives" in fb) {
          dirReport.alternatives = (fb as DirectionFeedback).alternatives;
        }
        if ("assumptions" in fb) {
          dirReport.assumptions = (fb as DirectionFeedback).assumptions;
        }

        if (r1Response) {
          dirReport.revision_responses = r1Response.responses;
        }

        direction = dirReport;
      }

      // Build risk section (round 2)
      let risk: RiskReport | "not_reached" = "not_reached";
      const r2Feedback = readRoundFeedback(cwd, session.id, 2);
      const r2Response = readRoundResponse(cwd, session.id, 2);

      if (r2Feedback) {
        const fb = r2Feedback as PhaseFeedback;
        const fallbackUsed = !!fb.fallback_used;
        if (fallbackUsed) fallbackCount++;

        const riskReport: RiskReport = {
          issues: fb.issues,
          fallback_used: fallbackUsed,
        };

        if ("risk_level" in fb) {
          riskReport.risk_level = (fb as RiskFeedback).risk_level;
        }
        if ("risks" in fb) {
          riskReport.risks = (fb as RiskFeedback).risks;
        }

        if (r2Response) {
          riskReport.revision_responses = r2Response.responses;
        }

        risk = riskReport;
      }

      // Build detail rounds (round 3+)
      const detailRounds: DetailRoundReport[] = [];
      for (let r = 3; r <= session.currentRound; r++) {
        const fb = readRoundFeedback(cwd, session.id, r);
        if (!fb) continue;

        const fallbackUsed = !!fb.fallback_used;
        if (fallbackUsed) fallbackCount++;

        const roundReport: DetailRoundReport = {
          round: r,
          verdict: fb.verdict,
          summary: fb.summary,
          issues: fb.issues,
          fallback_used: fallbackUsed,
        };

        const resp = readRoundResponse(cwd, session.id, r);
        if (resp) {
          roundReport.revision_responses = resp.responses;
        }

        detailRounds.push(roundReport);
      }

      // Build trajectory
      const severities = [];
      for (let r = 1; r <= session.currentRound; r++) {
        const fb = readRoundFeedback(cwd, session.id, r);
        if (fb) severities.push(severityFromFeedback(fb));
      }
      const trajectory =
        severities.length > 0 ? formatTrajectory(severities) : "";

      // Determine blocked info
      let blockedInfo: { phase: string; round: number } | undefined;
      if (session.status === "blocked") {
        // Find which round blocked
        for (let r = 1; r <= session.currentRound; r++) {
          const fb = readRoundFeedback(cwd, session.id, r);
          if (fb && fb.verdict === "blocked") {
            blockedInfo = { phase: getReviewPhase(r), round: r };
            break;
          }
        }
      }

      const report = {
        session: {
          id: session.id,
          status: session.status,
          rounds_completed: session.currentRound,
          complete: isComplete,
          fallback_count: fallbackCount,
          ...(blockedInfo && { blocked_in: blockedInfo }),
        },
        direction,
        risk,
        detail_rounds: detailRounds,
        trajectory,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(report),
          },
        ],
      };
    },
  );
}
