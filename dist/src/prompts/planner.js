export function buildInitialPlanPrompt(requirements, plansDir) {
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
export function buildRevisionPrompt(currentPlan, feedback, keyDecisions, priorContext, phase = "detail") {
    const contextBlock = priorContext
        ? `\n## Prior Research & Constraints\n\n${priorContext}\n`
        : "";
    const decisionsBlock = keyDecisions
        ? `\n## Key Decisions From Plan\n\n${keyDecisions}\n`
        : "";
    const issuesList = feedback.issues
        .map((issue) => `### ${issue.id} (${issue.severity}): ${issue.title}\n**Section:** ${issue.section}\n**Description:** ${issue.description}\n**Suggestion:** ${issue.suggestion}`)
        .join("\n\n");
    const directionInstructions = `You are revising a plan based on HIGH-LEVEL directional feedback. This is the first review pass — the reviewer evaluated whether the plan is solving the right problem with the right approach.

You are the plan's ADVOCATE, but be open to directional changes. If the reviewer identifies a fundamentally better approach or a critical missing constraint, this is the round to make sweeping changes — restructure sections, change the approach, adjust scope. Don't be precious about the current draft.

ACCEPT when:
- The feedback identifies a better approach or architecture
- The concern reveals a critical assumption or constraint you missed
- The suggestion would prevent significant rework later

REJECT when:
- The feedback misunderstands the problem domain or constraints
- The alternative approach has drawbacks the reviewer didn't consider
- The concern was already addressed by a documented decision

DEFER when:
- The feedback is valid but would expand scope beyond the current effort
- It's a good strategic point for a future iteration

For each response, explain your reasoning with specifics. If you accept a directional change, make the necessary structural updates to the plan — don't just acknowledge the point.`;
    const riskInstructions = `You are revising a plan based on a PRE-MORTEM risk review. The reviewer assumed this plan would fail and identified potential risks, hidden assumptions, and failure modes.

You are the plan's ADVOCATE. Not every risk needs a mitigation — some are acceptable, some are already covered, and some are too unlikely to warrant action. Evaluate each risk on its merits:

ACCEPT when:
- The risk is real and unmitigated in the current plan
- Adding a mitigation (fallback, validation, rollback step) is low-cost and high-value
- The assumption is genuinely unchecked and could cause real problems

REJECT when:
- The risk is already mitigated by existing plan steps (cite them)
- The scenario is extremely unlikely and the impact is recoverable
- The mitigation would add significant complexity for marginal safety
- The reviewer is catastrophizing — the risk is theoretical, not practical

DEFER when:
- The risk is real but out of scope for this phase of work
- Addressing it requires infrastructure or decisions beyond this plan's scope

When accepting risks, add concrete mitigations to the plan — verification steps, fallback procedures, or explicit assumptions to validate. Don't just acknowledge the risk.`;
    const detailInstructions = `You are revising a plan based on reviewer feedback. You are the plan's ADVOCATE, not a compliance engine. Evaluate each issue on its merits:

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

For each response, cite specific evidence: reference the plan section, the research that informed the decision, or the constraint that makes the suggestion inapplicable. Vague agreement ("good point, updated") is not acceptable — explain WHY you're accepting, with the same rigor you'd use for a rejection.`;
    const roleInstructions = phase === "direction"
        ? directionInstructions
        : phase === "risk"
            ? riskInstructions
            : detailInstructions;
    const surgicalConstraint = phase === "direction"
        ? `- You may make structural changes (reorder sections, change approach, adjust scope) if accepted feedback warrants it.
- Preserve sections that aren't affected by the feedback.`
        : phase === "risk"
            ? `- Add mitigations, verification steps, or fallback procedures for accepted risks.
- You may add new sections (e.g., "Risks & Mitigations") if needed.
- Do not reorganize or rephrase parts of the plan unrelated to risk feedback.`
            : `- Only modify sections of the plan that are directly addressed by accepted feedback. Do not reorganize, rephrase, or "improve" parts of the plan that aren't related to any issue.
- Preserve the plan's existing structure, headings, and formatting. Your job is surgical revision, not rewriting.`;
    return `${roleInstructions}
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
${surgicalConstraint}
- Do NOT modify the \`**planpong:**\` status line — it is managed automatically.
- Wrap your JSON response in <planpong-revision>...</planpong-revision> tags.

<planpong-revision>
YOUR_JSON_HERE
</planpong-revision>`;
}
//# sourceMappingURL=planner.js.map