import type { IssueResponse } from "../schemas/revision.js";

export function buildReviewPrompt(
  planContent: string,
  priorDecisions: string | null,
): string {
  const priorBlock = priorDecisions
    ? `\n## Prior Round Decisions\n\n${priorDecisions}\n\nDo not re-raise rejected items without citing specific new evidence (a URL, a test result, a behavior change). Issues rejected in prior rounds with valid rationale are RESOLVED.\n`
    : "";

  return `You are reviewing an implementation plan. Your role is adversarial but fair.

- Only flag issues you have concrete evidence for. Cite the plan section.
- Assign severity honestly:
  - P1 = blocks implementation or causes failure
  - P2 = significant quality/reliability concern
  - P3 = improvement opportunity
- If a prior round's issue was marked "rejected" with a valid rationale, do not re-raise it. You can escalate ONLY if you have new evidence.
- If all prior issues have been addressed or reasonably rejected, approve the plan. Do not invent new concerns to justify continued review.
- Deferred items from prior rounds are acknowledged and do not block approval.
- If the plan is solid with only minor informational notes, use "approved_with_notes" (all issues must be P3).
- If you approve with "approved_with_notes", do NOT include any P1 or P2 issues.
${priorBlock}
## Plan to Review

${planContent}

## Your Task

Respond with a JSON object wrapped in <planpong-feedback> tags. The JSON must match this schema:

\`\`\`
{
  "verdict": "needs_revision" | "approved" | "approved_with_notes",
  "summary": "Overall assessment of the plan",
  "issues": [
    {
      "id": "F1",
      "severity": "P1" | "P2" | "P3",
      "section": "Which part of the plan this relates to",
      "title": "One-line summary",
      "description": "Detailed explanation",
      "suggestion": "Recommended fix"
    }
  ]
}
\`\`\`

If the plan is approved with no issues, use:
\`\`\`
{ "verdict": "approved", "summary": "...", "issues": [] }
\`\`\`

IMPORTANT: Wrap your JSON response in <planpong-feedback>...</planpong-feedback> tags.

<planpong-feedback>
YOUR_JSON_HERE
</planpong-feedback>`;
}

export function formatPriorDecisions(
  rounds: Array<{
    round: number;
    responses: IssueResponse[];
    issues: Array<{ id: string; severity: string; title: string }>;
  }>,
): string {
  const lines: string[] = [];
  for (const round of rounds) {
    for (const response of round.responses) {
      const issue = round.issues.find((i) => i.id === response.issue_id);
      const severity = issue?.severity ?? "??";
      const title = issue?.title ?? response.issue_id;
      const action = response.action.toUpperCase();
      const rationale =
        response.rationale.length > 80
          ? response.rationale.slice(0, 80) + "..."
          : response.rationale;
      lines.push(
        `- R${round.round} ${response.issue_id} (${severity}): ${title} → ${action} (${rationale})`,
      );
    }
  }
  return lines.join("\n");
}
