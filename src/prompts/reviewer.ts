import type { IssueResponse } from "../schemas/revision.js";

export type ReviewPhase = "direction" | "risk" | "detail";

export function getReviewPhase(round: number): ReviewPhase {
  if (round <= 1) return "direction";
  if (round === 2) return "risk";
  return "detail";
}

/**
 * Shared "cite evidence" instruction blocks. Every issue must include a
 * verbatim ≤200-char `quoted_text` snippet that planpong verifies by
 * grepping the plan markdown. Quotes that don't match are tagged
 * `verified: false` and deprioritized by the planner — they're treated
 * as likely hallucinations.
 *
 * Length and distinctiveness limits are enforced server-side; the prompt
 * communicates them so the model produces compliant quotes on the first
 * try.
 *
 * Two variants:
 * - `_FRESH` is appended by `buildReviewPrompt`. The full plan is in the
 *   prompt above the cite block, so "appear in the plan markdown above"
 *   is literally true.
 * - `_INCREMENTAL` is appended by `buildIncrementalReviewPrompt`. That
 *   prompt now sends both a diff (for change context) AND the full
 *   current plan text (for quoting). Quoting from a diff line would leak
 *   `+ ` / `- ` prefixes; quoting from session memory of an earlier round
 *   risks pulling deleted lines. The incremental cite block points the
 *   reviewer at the authoritative current-plan section.
 */
const CITE_EVIDENCE_BLOCK_FRESH = `
## Cite Evidence For Every Issue

Every issue you raise MUST include a \`quoted_text\` field — a verbatim snippet copied from the plan that the issue refers to. This is how planpong verifies the issue actually corresponds to something in the plan rather than a misread.

- Quote, do not paraphrase. The string must appear character-for-character (whitespace tolerant) somewhere in the plan markdown above.
- Keep \`quoted_text\` between 10 and 200 characters. Pick the shortest distinctive snippet that anchors the issue.
- If you cannot find a verbatim quote that supports the issue, the issue is probably a misread of the plan — drop it.`;

const CITE_EVIDENCE_BLOCK_INCREMENTAL = `
## Cite Evidence For Every Issue

Every issue you raise MUST include a \`quoted_text\` field — a verbatim snippet copied from the plan that the issue refers to. This is how planpong verifies the issue actually corresponds to something in the plan rather than a misread.

- Quote, do not paraphrase. The string must appear character-for-character (whitespace tolerant) in the **current plan text provided below** (the "Current Plan" section, not the diff).
- Do NOT quote diff prefix characters (\`+ \` / \`- \`). The diff is for change context only; quote from the Current Plan section.
- Keep \`quoted_text\` between 10 and 200 characters. Pick the shortest distinctive snippet that anchors the issue.
- If you cannot find a verbatim quote that supports the issue, the issue is probably a misread of the plan — drop it.`;

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

Verdict rules:
- Use "needs_revision" when there are issues to address (this is the normal case).
- Use "blocked" ONLY when the plan is fundamentally non-viable due to hard external constraints — e.g., depends on a deprecated/unavailable API, violates an organizational policy, or requires resources that don't exist. Do NOT use "blocked" for fixable design issues.
- You CANNOT approve in this round. Direction review always produces "needs_revision" or "blocked".`;
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

Produce a structured risk register in "risks" — this is the full set of risks you identified. Then promote the subset that needs plan changes to "issues". Not every risk needs to become an issue — low-likelihood/low-impact risks can stay in the register as informational.

Assign severity based on risk impact:
  - P1 = unmitigated risk that could cause data loss, outage, or require a full rollback
  - P2 = risk that could cause significant delay or rework if it materializes
  - P3 = risk worth acknowledging but unlikely or easily recoverable

Verdict rules:
- Use "needs_revision" when there are issues to address (this is the normal case).
- Use "blocked" ONLY when unmitigable risks make the plan non-viable — e.g., a hard dependency is unavailable, a critical external system is unreliable with no workaround. Do NOT use "blocked" for risks that can be mitigated with plan changes.
- You CANNOT approve in this round. Risk review always produces "needs_revision" or "blocked".
${priorBlock}`;
}

function buildDetailReviewInstructions(priorDecisions: string | null): string {
  const priorBlock = priorDecisions
    ? `\n## Prior Round Decisions\n\n${priorDecisions}\n\nDo not re-raise rejected items without citing specific new evidence (a URL, a test result, a behavior change). Issues rejected in prior rounds with valid rationale are RESOLVED.\n`
    : "";

  return `You are reviewing an implementation plan. Your role is adversarial but fair.

The plan's overall direction has already been validated. Focus on implementation completeness and correctness.

- When the plan references files, function names, exports, imports, configs, or APIs, VERIFY them against the codebase using your tools (Read, Grep, Glob, Bash). A plan that references \`src/foo/bar.ts\` should have a corresponding file; a plan that calls \`someLib.thing()\` should match the library's actual API. Flag verifiable mismatches as P1 (would break implementation) — these are the issues only an independent reviewer catches.
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

function buildDirectionJsonSchema(): string {
  return `\`\`\`
{
  "verdict": "needs_revision" | "blocked",
  "summary": "Overall assessment of the plan's direction",
  "confidence": "high" | "medium" | "low",
  "approach_assessment": "Why the chosen approach works or doesn't — be specific",
  "alternatives": [
    {
      "approach": "Name/description of an alternative approach",
      "tradeoff": "Why it was or wasn't chosen, pros/cons"
    }
  ],
  "assumptions": [
    "Unstated assumption the plan relies on"
  ],
  "issues": [
    {
      "id": "F1",
      "severity": "P1" | "P2" | "P3",
      "section": "Which part of the plan this relates to",
      "title": "One-line summary",
      "description": "Detailed explanation",
      "suggestion": "Recommended fix",
      "quoted_text": "Verbatim ≤200-char snippet from the plan above"
    }
  ]
}
\`\`\`

If the direction is sound with no issues:
\`\`\`
{ "verdict": "needs_revision", "summary": "...", "confidence": "high", "approach_assessment": "...", "alternatives": [], "assumptions": [], "issues": [] }
\`\`\``;
}

function buildRiskJsonSchema(): string {
  return `\`\`\`
{
  "verdict": "needs_revision" | "blocked",
  "summary": "Overall risk assessment",
  "risk_level": "high" | "medium" | "low",
  "risks": [
    {
      "id": "R1",
      "category": "dependency" | "integration" | "operational" | "assumption" | "external",
      "likelihood": "high" | "medium" | "low",
      "impact": "high" | "medium" | "low",
      "title": "Short risk title",
      "description": "Detailed risk description",
      "mitigation": "Suggested mitigation"
    }
  ],
  "issues": [
    {
      "id": "F1",
      "severity": "P1" | "P2" | "P3",
      "section": "Which part of the plan this relates to",
      "title": "One-line summary",
      "description": "Detailed explanation",
      "suggestion": "Recommended fix",
      "quoted_text": "Verbatim ≤200-char snippet from the plan above"
    }
  ]
}
\`\`\`

The "risks" array is your full risk register. The "issues" array is the subset of risks that need plan changes. Not every risk needs to be an issue.

If risks are present but adequately mitigated:
\`\`\`
{ "verdict": "needs_revision", "summary": "...", "risk_level": "low", "risks": [...], "issues": [] }
\`\`\``;
}

function buildDetailJsonSchema(): string {
  return `\`\`\`
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
      "suggestion": "Recommended fix",
      "quoted_text": "Verbatim ≤200-char snippet from the plan above"
    }
  ]
}
\`\`\`

If the plan is approved with no issues, use:
\`\`\`
{ "verdict": "approved", "summary": "...", "issues": [] }
\`\`\``;
}

/**
 * Incremental review prompt for resumed reviewer sessions.
 *
 * The reviewer has already seen the full plan (round 1) and produced its
 * own prior critique. Round 2+ prompts include both the diff (for change
 * context) AND the full current plan text (for unambiguous quoting).
 *
 * **Why ship the full plan even when the model has it in session memory:**
 * the cite-evidence block requires verbatim `quoted_text` matching against
 * the *current* plan. Without an authoritative current-plan section, the
 * reviewer must reconstruct from R1's full plan + every subsequent diff in
 * its memory. That's fragile (context loss, truncation, attention to old
 * lines). Sending the full plan eliminates the reconstruction job. Plans
 * are typically < 10KB — the cost is marginal next to a wasted round from
 * bad quotes.
 *
 * `planDiffOrContent` carries the diff (or, when the caller skips diffing,
 * the full plan as a fallback). `currentPlanContent` is always the
 * authoritative current plan.
 */
export function buildIncrementalReviewPrompt(
  planDiffOrContent: string,
  currentPlanContent: string,
  priorDecisions: string | null,
  phase: ReviewPhase = "detail",
  structuredOutput: boolean = false,
): string {
  const instructions =
    phase === "direction"
      ? buildDirectionReviewInstructions()
      : phase === "risk"
        ? buildRiskReviewInstructions(priorDecisions)
        : buildDetailReviewInstructions(priorDecisions);

  const jsonSchema =
    phase === "direction"
      ? buildDirectionJsonSchema()
      : phase === "risk"
        ? buildRiskJsonSchema()
        : buildDetailJsonSchema();

  const isDiff = planDiffOrContent.startsWith("```diff");
  // When the caller has a real diff: ship diff (for context) + current plan
  // (for quoting). When `planDiffOrContent` is already the full plan
  // (caller skipped diffing — e.g., R1 fallback path), don't duplicate.
  const planSection = isDiff
    ? `## Plan Changes Since Last Round

The plan has been revised in response to your prior feedback. Below is what changed.

${planDiffOrContent}

## Current Plan (full text — quote from this)

${currentPlanContent}`
    : `## Plan to Review

${planDiffOrContent}`;

  if (structuredOutput) {
    return `${instructions}
${planSection}

## Your Task

You are continuing the same review conversation. Your prior round's feedback is in your context — use it. The Current Plan section above is the authoritative source for quoting.

Output ONLY a single JSON object conforming to the schema below. The first character of your response must be \`{\` and the last must be \`}\`. No prose. No markdown. No code fences. No preamble or explanation. No trailing text.

Schema:

${jsonSchema}
${CITE_EVIDENCE_BLOCK_INCREMENTAL}`;
  }

  return `${instructions}
${planSection}

## Your Task

You are continuing the same review conversation. Your prior round's feedback is in your context — use it. The Current Plan section above is the authoritative source for quoting.

Respond with a JSON object wrapped in <planpong-feedback> tags conforming to:

${jsonSchema}
${CITE_EVIDENCE_BLOCK_INCREMENTAL}

IMPORTANT: Wrap your JSON response in <planpong-feedback>...</planpong-feedback> tags.

<planpong-feedback>
YOUR_JSON_HERE
</planpong-feedback>`;
}

export function buildReviewPrompt(
  planContent: string,
  priorDecisions: string | null,
  phase: ReviewPhase = "detail",
  structuredOutput: boolean = false,
): string {
  const instructions =
    phase === "direction"
      ? buildDirectionReviewInstructions()
      : phase === "risk"
        ? buildRiskReviewInstructions(priorDecisions)
        : buildDetailReviewInstructions(priorDecisions);

  const jsonSchema =
    phase === "direction"
      ? buildDirectionJsonSchema()
      : phase === "risk"
        ? buildRiskJsonSchema()
        : buildDetailJsonSchema();

  if (structuredOutput) {
    // Structured-output mode. Some providers (OpenAI/Codex) constrain output
    // at the token level; others (Claude) only validate post-hoc. Emphatic
    // JSON-only instructions help the advisory case comply; the constrained
    // case ignores them harmlessly.
    return `${instructions}
## Plan to Review

${planContent}

## Your Task

Output ONLY a single JSON object conforming to the schema below. The first character of your response must be \`{\` and the last must be \`}\`. No prose. No markdown. No code fences. No preamble or explanation. No trailing text.

Schema:

${jsonSchema}
${CITE_EVIDENCE_BLOCK_FRESH}`;
  }

  return `${instructions}
## Plan to Review

${planContent}

## Your Task

Respond with a JSON object wrapped in <planpong-feedback> tags. The JSON must match this schema:

${jsonSchema}
${CITE_EVIDENCE_BLOCK_FRESH}

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
