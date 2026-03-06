import type { IssueResponse } from "../schemas/revision.js";

export type ReviewPhase = "direction" | "risk" | "detail";

export function getReviewPhase(round: number): ReviewPhase {
  if (round <= 1) return "direction";
  if (round === 2) return "risk";
  return "detail";
}

function buildDirectionReviewInstructions(): string {
  return `You are reviewing an implementation plan at a HIGH LEVEL. Focus on direction, not details.

Your job in this round is to evaluate whether the plan is solving the right problem with the right approach. Do NOT nitpick implementation details, missing edge cases, or formatting — those will be reviewed in later rounds.

Focus on:
- **Problem framing:** Is the plan solving the right problem? Is the scope appropriate?
- **Approach:** Is the chosen architecture/strategy sound? Are there fundamentally better alternatives?
- **Assumptions:** Are there unstated assumptions that could invalidate the plan?
- **Constraints:** Does the plan account for real-world constraints (timeline, dependencies, team)?
- **Risk:** Are there high-level risks that could derail the entire effort?

Do NOT focus on:
- Missing implementation details (those come later)
- Specific file paths or code patterns
- Edge cases or error handling
- Formatting or structure of the plan document

Assign severity based on directional impact:
  - P1 = wrong problem, fundamentally flawed approach, or critical missing constraint
  - P2 = questionable strategic choice that could lead to significant rework
  - P3 = alternative approach worth considering

- If the direction is sound, approve the plan so detailed review can begin.`;
}

function buildRiskReviewInstructions(priorDecisions: string | null): string {
  const priorBlock = priorDecisions
    ? `\n## Prior Round Decisions\n\n${priorDecisions}\n\nDo not re-raise rejected items without citing specific new evidence. Issues rejected in prior rounds with valid rationale are RESOLVED.\n`
    : "";

  return `You are conducting a PRE-MORTEM review of an implementation plan. The plan's direction has been validated — now assume this plan will fail and figure out why.

Your job is to surface risks, hidden assumptions, and failure modes that aren't obvious from the plan itself. Think like a skeptical senior engineer who has seen similar projects go wrong.

Focus on:
- **Assumptions:** What is the plan taking for granted that might not be true? (API behavior, data formats, library compatibility, team familiarity)
- **Dependencies:** What external factors could block or delay this? (third-party services, upstream changes, approvals, data availability)
- **Failure modes:** What happens when things go wrong? (error handling gaps, rollback strategy, data corruption scenarios)
- **Integration risks:** Where do different parts of the plan interact, and what could break at those boundaries?
- **Operational risks:** What could go wrong in deployment, migration, or runtime that the plan doesn't address?

Do NOT focus on:
- Whether the overall approach is right (that was validated in round 1)
- Minor implementation details or code-level concerns (those come in later rounds)
- Stylistic or formatting issues

Assign severity based on risk impact:
  - P1 = unmitigated risk that could cause data loss, outage, or require a full rollback
  - P2 = risk that could cause significant delay or rework if it materializes
  - P3 = risk worth acknowledging but unlikely or easily recoverable

- If the plan adequately addresses risks and has reasonable mitigations, approve it.
${priorBlock}`;
}

function buildDetailReviewInstructions(priorDecisions: string | null): string {
  const priorBlock = priorDecisions
    ? `\n## Prior Round Decisions\n\n${priorDecisions}\n\nDo not re-raise rejected items without citing specific new evidence (a URL, a test result, a behavior change). Issues rejected in prior rounds with valid rationale are RESOLVED.\n`
    : "";

  return `You are reviewing an implementation plan. Your role is adversarial but fair.

The plan's overall direction has already been validated. Focus on implementation completeness and correctness.

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
${priorBlock}`;
}

export function buildReviewPrompt(
  planContent: string,
  priorDecisions: string | null,
  phase: ReviewPhase = "detail",
): string {
  const instructions =
    phase === "direction"
      ? buildDirectionReviewInstructions()
      : phase === "risk"
        ? buildRiskReviewInstructions(priorDecisions)
        : buildDetailReviewInstructions(priorDecisions);

  return `${instructions}
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
