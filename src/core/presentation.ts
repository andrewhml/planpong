import type { PhaseFeedback, FeedbackIssue } from "../schemas/feedback.js";
import type { PlannerRevision, IssueResponse } from "../schemas/revision.js";
import type { RoundSeverity } from "./operations.js";

export type PlannerDecision =
  | "pending"
  | "accepted"
  | "rejected"
  | "deferred"
  | "missing";

export interface IssueDecisionRow {
  issue_id: string;
  severity: "P1" | "P2" | "P3";
  section: string;
  title: string;
  decision: PlannerDecision;
  rationale?: string;
  verified?: boolean;
}

export interface DecisionRowsResult {
  rows: IssueDecisionRow[];
  warnings: string[];
}

const MAX_CELL_LENGTH = 140;

function titleCaseToken(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeCell(value: string | undefined): string {
  const normalized = (value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
  if (normalized.length <= MAX_CELL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_CELL_LENGTH - 3)}...`;
}

function decisionLabel(decision: PlannerDecision): string {
  return titleCaseToken(decision);
}

function feedbackToRows(feedback: PhaseFeedback): IssueDecisionRow[] {
  return feedback.issues.map((issue) => ({
    issue_id: issue.id,
    severity: issue.severity,
    section: issue.section,
    title: issue.title,
    decision: "pending",
    verified: issue.verified,
  }));
}

export function buildDecisionRows(
  feedback: PhaseFeedback,
  revision: PlannerRevision,
): DecisionRowsResult {
  const responsesByIssue = new Map<string, IssueResponse>();
  const warnings: string[] = [];

  for (const response of revision.responses) {
    responsesByIssue.set(response.issue_id, response);
  }

  const issueIds = new Set(feedback.issues.map((issue) => issue.id));
  const unmatched = revision.responses
    .map((response) => response.issue_id)
    .filter((issueId) => !issueIds.has(issueId));
  if (unmatched.length > 0) {
    warnings.push(`Unmatched response issue IDs: ${unmatched.join(", ")}`);
  }

  const rows = feedback.issues.map((issue) => {
    const response = responsesByIssue.get(issue.id);
    if (!response) {
      warnings.push(`Missing response for issue ${issue.id}`);
      return {
        issue_id: issue.id,
        severity: issue.severity,
        section: issue.section,
        title: issue.title,
        decision: "missing" as const,
        verified: issue.verified,
      };
    }
    return {
      issue_id: issue.id,
      severity: issue.severity,
      section: issue.section,
      title: issue.title,
      decision: response.action,
      rationale: response.rationale,
      verified: issue.verified,
    };
  });

  return { rows, warnings };
}

function formatSeverityCounts(severity: RoundSeverity): string {
  const parts: string[] = [];
  if (severity.P1 > 0) parts.push(`${severity.P1} P1`);
  if (severity.P2 > 0) parts.push(`${severity.P2} P2`);
  if (severity.P3 > 0) parts.push(`${severity.P3} P3`);
  return parts.length > 0 ? parts.join(", ") : "0 issues";
}

function formatFeedbackTable(rows: IssueDecisionRow[]): string {
  const lines = [
    "| ID | Sev | Section | Reviewer issue | Planner decision |",
    "|---|---:|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${normalizeCell(row.issue_id)} | ${row.severity} | ${normalizeCell(row.section)} | ${normalizeCell(row.title)} | ${decisionLabel(row.decision)} |`,
    );
  }
  return lines.join("\n");
}

function formatDecisionTable(rows: IssueDecisionRow[]): string {
  const lines = [
    "| ID | Sev | Reviewer issue | Decision | Rationale |",
    "|---|---:|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${normalizeCell(row.issue_id)} | ${row.severity} | ${normalizeCell(row.title)} | ${decisionLabel(row.decision)} | ${normalizeCell(row.rationale)} |`,
    );
  }
  return lines.join("\n");
}

export function formatFeedbackDisplay(args: {
  round: number;
  phase: string;
  verdict: string;
  severity: RoundSeverity;
  feedback: PhaseFeedback;
  phaseSignal?: string;
}): { markdown: string; rows: IssueDecisionRow[] } {
  const rows = feedbackToRows(args.feedback);
  const title = `Round ${args.round} - ${titleCaseToken(args.phase)} - ${titleCaseToken(args.verdict)}`;
  const summaryParts = [formatSeverityCounts(args.severity)];
  if (args.phaseSignal) summaryParts.push(args.phaseSignal);
  if (args.feedback.summary) summaryParts.push(args.feedback.summary);
  const body = rows.length > 0 ? formatFeedbackTable(rows) : "No reviewer issues.";
  return {
    rows,
    markdown: [title, summaryParts.join(" | "), body].join("\n\n"),
  };
}

export function formatDecisionDisplay(args: {
  round: number;
  feedback: PhaseFeedback;
  revision: PlannerRevision;
  warning?: string;
}): { markdown: string; rows: IssueDecisionRow[]; warnings: string[] } {
  const { rows, warnings } = buildDecisionRows(args.feedback, args.revision);
  const lines = [
    `Round ${args.round} - Planner decisions`,
    "",
    rows.length > 0 ? formatDecisionTable(rows) : "No reviewer issues.",
  ];
  const allWarnings = [...warnings];
  if (args.warning) allWarnings.push(args.warning);
  if (allWarnings.length > 0) {
    lines.push("", ...allWarnings.map((warning) => `Warning: ${warning}`));
  }
  return {
    rows,
    warnings: allWarnings,
    markdown: lines.join("\n"),
  };
}
