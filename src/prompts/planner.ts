import type { ReviewFeedback } from "../schemas/feedback.js";
import type { ReviewPhase } from "./reviewer.js";

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
  phase: ReviewPhase = "detail",
  structuredOutput: boolean = false,
  revisionMode: "edits" | "full" = "full",
): string {
  // Direction phase always uses full-plan output (sweeping rewrites are
  // expected). Risk + detail phases honor `revisionMode`.
  const useEdits = revisionMode === "edits" && phase !== "direction";
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

  const roleInstructions =
    phase === "direction"
      ? directionInstructions
      : phase === "risk"
        ? riskInstructions
        : detailInstructions;

  const surgicalConstraint =
    phase === "direction"
      ? `- You may make structural changes (reorder sections, change approach, adjust scope) if accepted feedback warrants it.
- Preserve sections that aren't affected by the feedback.`
      : phase === "risk"
        ? `- Add mitigations, verification steps, or fallback procedures for accepted risks.
- You may add new sections (e.g., "Risks & Mitigations") if needed.
- Do not reorganize or rephrase parts of the plan unrelated to risk feedback.`
        : `- Only modify sections of the plan that are directly addressed by accepted feedback. Do not reorganize, rephrase, or "improve" parts of the plan that aren't related to any issue.
- Preserve the plan's existing structure, headings, and formatting. Your job is surgical revision, not rewriting.`;

  const fullSchemaBlock = `\`\`\`
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
\`\`\``;

  // Edits-mode schema for risk + detail phases: planner emits a structured
  // edit list instead of the full plan. Each edit is section-scoped — the
  // applier locates the section heading, then finds `before` within that
  // section's content. `before` MUST be unique within the section.
  const editsSchemaBlock = `\`\`\`
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
  "edits": [
    {
      "section": "Steps",
      "before": "verbatim text from the plan to replace (must appear EXACTLY ONCE within the named section)",
      "after": "replacement text (may be empty for deletion)"
    }
  ]
}
\`\`\``;

  const schemaBlock = useEdits ? editsSchemaBlock : fullSchemaBlock;

  // Edits-mode constraints. The applier is strict: section-scoped lookup,
  // unique-match-within-section enforcement, no plan-wide fallback. The
  // prompt has to make those constraints visible so the planner produces
  // edits that actually apply.
  const editsConstraints = `- Output edits, NOT the full plan. The plan is updated server-side by replaying your edits.
- Each edit's \`section\` is the nearest markdown heading label (e.g., "Steps", "Limitations & Future Work"). The applier searches ONLY within that section's content.
- Each edit's \`before\` must appear EXACTLY ONCE within the named section, character-for-character (whitespace tolerant). If the same text appears multiple times in the section, expand \`before\` with surrounding context until it is unique within the section.
- Use the SHORTEST \`before\` that is unambiguous. Do not quote large unchanged blocks.
- \`after\` is the replacement. Empty string deletes; non-empty replaces.
- For an addition, set \`before\` to a short stable anchor (e.g., the line before the insertion point) and \`after\` to that anchor plus the new content.
- Edits run sequentially: later edits see earlier edits' results. If you have multiple edits in the same section, order them so each one's \`before\` is unique against the running plan state.
- Keep the total number of edits small — only what is needed to address accepted issues. One issue typically maps to one edit.`;
  const fullModeConstraint = `- The \`updated_plan\` must be the complete plan markdown, not a diff.`;

  const commonBody = `${roleInstructions}
${contextBlock}${decisionsBlock}
## Current Plan

${currentPlan}

## Reviewer Feedback

**Summary:** ${feedback.summary}

${issuesList}

## Your Task`;

  const outputConstraint = useEdits ? editsConstraints : fullModeConstraint;

  if (structuredOutput) {
    // Structured-output mode. Some providers constrain output at the token
    // level; others only validate post-hoc. Emphatic JSON-only instructions
    // help advisory providers comply; constrained providers ignore them.
    return `${commonBody}

Output ONLY a single JSON object conforming to the schema below. The first character of your response must be \`{\` and the last must be \`}\`. No prose. No markdown. No code fences. No preamble or explanation. No trailing text.

Schema:

${schemaBlock}

Constraints embedded in your JSON response:
- Every issue MUST have an entry in \`responses\`. Do not skip any.
${outputConstraint}
${surgicalConstraint}
- Do NOT modify the \`**planpong:**\` status line — it is managed automatically.`;
  }

  return `${commonBody}

Respond with a JSON object wrapped in <planpong-revision> tags. The JSON must match this schema:

${schemaBlock}

IMPORTANT:
- Every issue MUST have a response. Do not skip any.
${outputConstraint}
${surgicalConstraint}
- Do NOT modify the \`**planpong:**\` status line — it is managed automatically.
- Wrap your JSON response in <planpong-revision>...</planpong-revision> tags.

<planpong-revision>
YOUR_JSON_HERE
</planpong-revision>`;
}

/**
 * Build a minimal revision prompt for resumed planner sessions.
 *
 * The planner is already in a persistent CLI conversation that has the
 * plan, the prior reviewer feedback, and the planner's own prior rationales
 * in context. We do NOT re-send "Current Plan", "Prior Decisions", or
 * "Key Decisions" — the model has all of that. Only the new feedback +
 * minimal phase reminder + output schema instructions.
 *
 * The output schema and surgical constraints stay because they're per-call
 * directives, not stable context. (We don't trust that the model won't
 * drift in format across many turns of a long session.)
 */
export function buildIncrementalRevisionPrompt(
  feedback: ReviewFeedback,
  phase: ReviewPhase,
  structuredOutput: boolean,
  revisionMode: "edits" | "full" = "full",
): string {
  const useEdits = revisionMode === "edits" && phase !== "direction";

  const issuesList = feedback.issues
    .map(
      (issue) =>
        `### ${issue.id} (${issue.severity}): ${issue.title}\n**Section:** ${issue.section}\n**Description:** ${issue.description}\n**Suggestion:** ${issue.suggestion}`,
    )
    .join("\n\n");

  const phaseLabel =
    phase === "direction"
      ? "DIRECTION"
      : phase === "risk"
        ? "RISK / PRE-MORTEM"
        : "DETAIL";

  const surgicalConstraint =
    phase === "direction"
      ? `- You may make structural changes (reorder sections, change approach, adjust scope) if accepted feedback warrants it.
- Preserve sections that aren't affected by the feedback.`
      : phase === "risk"
        ? `- Add mitigations, verification steps, or fallback procedures for accepted risks.
- You may add new sections (e.g., "Risks & Mitigations") if needed.
- Do not reorganize or rephrase parts of the plan unrelated to risk feedback.`
        : `- Only modify sections of the plan that are directly addressed by accepted feedback.
- Preserve the plan's existing structure, headings, and formatting. Surgical revision, not rewriting.`;

  const fullSchemaBlock = `\`\`\`
{
  "responses": [
    { "issue_id": "F1", "action": "accepted" | "rejected" | "deferred",
      "severity_dispute": { "original": "P1", "revised": "P2", "justification": "..." },  // optional
      "rationale": "Why this action" }
  ],
  "updated_plan": "The full updated plan in markdown"
}
\`\`\``;

  const editsSchemaBlock = `\`\`\`
{
  "responses": [
    { "issue_id": "F1", "action": "accepted" | "rejected" | "deferred",
      "severity_dispute": { "original": "P1", "revised": "P2", "justification": "..." },  // optional
      "rationale": "Why this action" }
  ],
  "edits": [
    { "section": "Steps", "before": "verbatim text from the plan (must appear EXACTLY ONCE within the named section)", "after": "replacement" }
  ]
}
\`\`\``;

  const schemaBlock = useEdits ? editsSchemaBlock : fullSchemaBlock;

  const editsConstraints = `- Output edits, NOT the full plan. The plan is updated server-side by replaying your edits.
- Each edit's \`section\` is the nearest markdown heading. \`before\` must appear EXACTLY ONCE within that section.
- Use the SHORTEST \`before\` that is unambiguous within the section.
- For an addition: \`before\` = a stable anchor; \`after\` = anchor + new content.
- Edits run sequentially: later edits see earlier edits' results.`;
  const fullModeConstraint = `- The \`updated_plan\` must be the complete plan markdown, not a diff.`;
  const outputConstraint = useEdits ? editsConstraints : fullModeConstraint;

  const body = `## ${phaseLabel} ROUND — Round ${"current round in your session memory"}: New Reviewer Feedback

You are continuing the same revision conversation. The plan, your prior rationales, and the prior rounds of reviewer feedback are already in your context — do not re-emit them.

The reviewer has produced new feedback for this round. Process it below.

**Summary:** ${feedback.summary}

${issuesList}

## Your Task`;

  if (structuredOutput) {
    return `${body}

Output ONLY a single JSON object conforming to the schema below. The first character of your response must be \`{\` and the last must be \`}\`. No prose. No markdown. No code fences. No preamble or explanation. No trailing text.

Schema:

${schemaBlock}

Constraints:
- Every issue MUST have an entry in \`responses\`. Do not skip any.
${outputConstraint}
${surgicalConstraint}
- Do NOT modify the \`**planpong:**\` status line — it is managed automatically.`;
  }

  return `${body}

Respond with a JSON object wrapped in <planpong-revision> tags conforming to:

${schemaBlock}

IMPORTANT:
- Every issue MUST have a response. Do not skip any.
${outputConstraint}
${surgicalConstraint}
- Do NOT modify the \`**planpong:**\` status line — it is managed automatically.
- Wrap your JSON response in <planpong-revision>...</planpong-revision> tags.

<planpong-revision>
YOUR_JSON_HERE
</planpong-revision>`;
}

/**
 * Build a targeted retry prompt for failed edits in edits-mode revisions.
 * Given the partially-edited plan and the list of edits that failed first
 * pass, asks the planner to re-express each failed edit with corrected
 * `section` and `before` values.
 *
 * The retry prompt is small — it does not re-include the full feedback or
 * key decisions, only the failed edits and the current state of the plan.
 */
export function buildEditsRetryPrompt(
  currentPlan: string,
  failures: Array<{
    edit: { section: string; before: string; after: string };
    reason: string;
    section_searched: string | null;
    diagnostic?: string;
  }>,
  structuredOutput: boolean,
): string {
  const failureBlock = failures
    .map((f, i) => {
      const reasonHelp =
        f.reason === "no-match"
          ? "Your `before` did not match any text in that section. Re-quote a verbatim string from the plan."
          : f.reason === "multi-match"
            ? "Your `before` matched multiple times in that section. Add surrounding context until it is unique within the section."
            : f.reason === "section-not-found"
              ? "The section heading does not exist in the plan. Pick a heading that does exist."
              : f.reason === "status-line"
                ? "Your edit modified the **planpong:** status line, which is reserved. Move the change elsewhere."
                : "Edit failed. Re-express it.";
      const diagnosticLine = f.diagnostic ? `\nDiagnostic: ${f.diagnostic}` : "";
      return `### Failed edit ${i + 1}
**Section:** ${f.edit.section}
**Reason:** ${f.reason}${diagnosticLine}
**Help:** ${reasonHelp}
**Original \`before\`:**
\`\`\`
${f.edit.before}
\`\`\`
**Original \`after\`:**
\`\`\`
${f.edit.after}
\`\`\``;
    })
    .join("\n\n");

  const schemaBlock = `\`\`\`
{
  "edits": [
    { "section": "Steps", "before": "verbatim", "after": "replacement" }
  ]
}
\`\`\``;

  const body = `You are correcting failed edits. The previous edit list partially applied; the edits below failed at the apply step.

For EACH failed edit, produce a corrected edit with the same intent but a working \`section\` and \`before\`. You may also revise \`after\` if the previous version assumed text that is no longer present.

## Current Plan (with previously-successful edits already applied)

${currentPlan}

## Failed Edits

${failureBlock}

## Your Task`;

  if (structuredOutput) {
    return `${body}

Output ONLY a single JSON object with an \`edits\` array. The first character of your response must be \`{\` and the last must be \`}\`. Do NOT include \`responses\` — those are already finalized.

Schema:

${schemaBlock}

- Output one corrected edit per failure (same count, same order).
- Each \`before\` must appear EXACTLY ONCE within the named section in the current plan above.
- Do NOT modify the \`**planpong:**\` status line.`;
  }

  return `${body}

Respond with a JSON object wrapped in <planpong-revision> tags. The JSON must match this schema:

${schemaBlock}

IMPORTANT:
- Output one corrected edit per failure (same count, same order). Do NOT include \`responses\`.
- Each \`before\` must appear EXACTLY ONCE within the named section in the current plan above.
- Do NOT modify the \`**planpong:**\` status line.
- Wrap your JSON response in <planpong-revision>...</planpong-revision> tags.

<planpong-revision>
YOUR_JSON_HERE
</planpong-revision>`;
}
