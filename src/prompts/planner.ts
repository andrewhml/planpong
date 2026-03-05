import type { ReviewFeedback } from "../schemas/feedback.js";

export function buildInitialPlanPrompt(
  requirements: string,
  plansDir: string,
): string {
  return `You are a software architect creating an implementation plan.

Given the following requirements, create a detailed implementation plan in markdown format.

The plan MUST include ALL of the following sections:
1. **Status line** as the first line after the title: \`**Status:** Draft\`
2. **Context** — why this work exists, in 2-3 sentences
3. **Steps as checkboxes** — use \`- [ ]\` format with clear descriptions
4. **File references** — table of files to create, modify, or delete
5. **Verification criteria** — what "done" looks like, specific and testable
6. **Key decisions** — alternatives considered and why one was chosen

Output ONLY the markdown plan. No preamble, no commentary.

## Requirements

${requirements}`;
}

export function buildRevisionPrompt(
  currentPlan: string,
  feedback: ReviewFeedback,
  keyDecisions: string | null,
  priorContext: string | null,
): string {
  const contextBlock = priorContext
    ? `\n## Prior Research & Constraints\n\n${priorContext}\n`
    : "";

  const decisionsBlock = keyDecisions
    ? `\n## Key Decisions From Plan\n\n${keyDecisions}\n`
    : "";

  const issuesList = feedback.issues
    .map(
      (issue) =>
        `### ${issue.id} (${issue.severity}): ${issue.title}\n**Section:** ${issue.section}\n**Description:** ${issue.description}\n**Suggestion:** ${issue.suggestion}`,
    )
    .join("\n\n");

  return `You are revising a plan based on reviewer feedback. You are the plan's ADVOCATE, not a compliance engine. Evaluate each issue on its merits:

REJECT when:
- The issue is based on a false premise or misunderstanding of the design
- The concern was already addressed by a decision documented in the plan
- The issue conflicts with validated constraints or prior research
- The reviewer is speculating (look for low-confidence hedging language)

DISPUTE SEVERITY when:
- The issue is valid but the impact is overstated (P1 claimed, P2 actual)
- The risk is theoretical, not practical (quantify if possible)
- The issue has a simple fix that doesn't warrant the flagged severity

ACCEPT when:
- The issue identifies a genuine gap not covered by existing decisions
- The concern is supported by evidence or concrete scenarios
- The fix improves the plan without contradicting its design principles

DEFER when:
- The issue is valid but out of scope for the current phase
- Addressing it would expand scope beyond what was agreed
- It's a good idea for v2 but not a blocker for v1

For each response, cite specific evidence: reference the plan section, the research that informed the decision, or the constraint that makes the suggestion inapplicable. Vague agreement ("good point, updated") is not acceptable — explain WHY you're accepting, with the same rigor you'd use for a rejection.
${contextBlock}${decisionsBlock}
## Current Plan

${currentPlan}

## Reviewer Feedback

**Summary:** ${feedback.summary}

${issuesList}

## Your Task

Respond with a JSON object wrapped in <planpong-revision> tags. The JSON must match this schema:

\`\`\`
{
  "responses": [
    {
      "issue_id": "F1",
      "action": "accepted" | "rejected" | "deferred",
      "severity_dispute": {                    // optional
        "original": "P1",
        "revised": "P2",
        "justification": "..."
      },
      "rationale": "Detailed explanation of why this action was taken"
    }
  ],
  "updated_plan": "The full updated plan in markdown (incorporate accepted changes)"
}
\`\`\`

IMPORTANT:
- Every issue MUST have a response. Do not skip any.
- The \`updated_plan\` must be the complete plan markdown, not a diff.
- Wrap your JSON response in <planpong-revision>...</planpong-revision> tags.

<planpong-revision>
YOUR_JSON_HERE
</planpong-revision>`;
}
