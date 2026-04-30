/**
 * LLM-judge scoring for the quality benchmark.
 *
 * Replaces the keyword-matching scorer. Given a defect's ground truth and
 * the issues a reviewer raised, the judge model returns a strict yes/no on
 * whether any issue substantively flagged the defect, plus a one-line
 * reason. Cost: one judge invocation per defect per mode.
 *
 * The judge MUST be a different provider (or at minimum a different model)
 * than the one being judged — using the same model to grade itself is the
 * circular-validation trap explicitly flagged in the v0 limitations.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Provider } from "../../src/providers/types.js";
import {
  StructuredOutputParseError,
  extractJSON,
} from "../../src/core/convergence.js";
import type { Defect } from "./defects.js";
import type { FeedbackIssue } from "../../src/schemas/feedback.js";

export const JudgeVerdictSchema = z.object({
  caught: z.boolean(),
  matched_issue_id: z.string().nullable(),
  reasoning: z.string(),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

const JUDGE_JSON_SCHEMA: Record<string, unknown> = (() => {
  const raw = zodToJsonSchema(JudgeVerdictSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  });
  return strictify(raw) as Record<string, unknown>;
})();

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = strictify(v);
  if (out.type !== "object" || !out.properties) return out;
  const props = out.properties as Record<string, unknown>;
  out.required = Object.keys(props);
  if (out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

function buildJudgePrompt(defect: Defect, issues: FeedbackIssue[]): string {
  const issueLines =
    issues.length === 0
      ? "(no issues raised)"
      : issues
          .map(
            (i, idx) =>
              `[${i.id || `F${idx + 1}`}] (${i.severity}, section: ${i.section})\n  Title: ${i.title}\n  Description: ${i.description}\n  Suggestion: ${i.suggestion}`,
          )
          .join("\n\n");

  if (defect.isControl) {
    return `You are scoring an AI plan reviewer.

The plan being reviewed is the CONTROL — it has no injected defects. Any issues the reviewer raised here are real-but-unrelated stylistic or scope concerns, NOT catches of an injected defect.

Reviewer's issues:
${issueLines}

Respond with JSON in this exact shape:

{
  "caught": false,
  "matched_issue_id": null,
  "reasoning": "<one-line reason — for control runs, just confirm that no injected defect exists>"
}

\`caught\` must always be \`false\` for control runs.`;
  }

  return `You are scoring an AI plan reviewer.

A plan was deliberately corrupted with a single defect. You are checking whether the reviewer's feedback substantively identified that defect.

DEFECT GROUND TRUTH:
${defect.groundTruth}

REVIEWER'S ISSUES:
${issueLines}

SCORING RULES (be strict):
1. An issue counts as a catch ONLY IF it directly identifies the defect described above. It must name the specific corrupted aspect — not adjacent concerns.
2. If the reviewer raised many issues but none specifically address the defect, return \`caught: false\` even if some issues are individually valid.
3. If a single issue substantively flags the defect (with correct identification of what's wrong), return \`caught: true\` and set \`matched_issue_id\` to that issue's id.
4. Paraphrasing is fine — the reviewer doesn't have to use the exact words from the ground truth, but the meaning must match.
5. Generic concerns ("plan should be more detailed", "consider edge cases") do NOT count.

Respond with JSON in this exact shape:

{
  "caught": true | false,
  "matched_issue_id": "<id of the matching issue, or null>",
  "reasoning": "<one or two sentences: why this is or isn't a catch>"
}`;
}

export async function judgeDefect({
  judgeProvider,
  judgeModel,
  judgeEffort,
  judgeCwd,
  defect,
  issues,
  timeoutMs,
}: {
  judgeProvider: Provider;
  judgeModel?: string;
  judgeEffort?: string;
  judgeCwd: string;
  defect: Defect;
  issues: FeedbackIssue[];
  timeoutMs: number;
}): Promise<JudgeVerdict & { judgeDurationMs: number }> {
  const prompt = buildJudgePrompt(defect, issues);
  const supportsStructured = await judgeProvider
    .checkStructuredOutputSupport()
    .catch(() => false);

  const started = Date.now();
  const response = await judgeProvider.invoke(prompt, {
    cwd: judgeCwd,
    model: judgeModel,
    effort: judgeEffort,
    timeout: timeoutMs,
    jsonSchema: supportsStructured ? JUDGE_JSON_SCHEMA : undefined,
  });
  const judgeDurationMs = Date.now() - started;

  if (!response.ok) {
    throw new Error(
      `judge invocation failed (${response.error.kind}): ${response.error.message}`,
    );
  }

  const raw = response.output;
  const parsed = parseJudgeOutput(raw, supportsStructured);

  // Defense in depth: if a defect is the control, force caught=false even
  // if the judge said true (the prompt already constrains this, but
  // models occasionally lapse — see scoring rule 5 in the prompt). Clear
  // matched_issue_id too so the result stays self-consistent.
  if (defect.isControl) {
    return {
      ...parsed,
      caught: false,
      matched_issue_id: null,
      judgeDurationMs,
    };
  }
  return { ...parsed, judgeDurationMs };
}

function parseJudgeOutput(raw: string, structured: boolean): JudgeVerdict {
  if (structured) {
    try {
      const parsed = JSON.parse(raw);
      return JudgeVerdictSchema.parse(stripNulls(parsed));
    } catch (err) {
      if (err instanceof StructuredOutputParseError) {
        // fall through
      }
    }
  }

  const json = extractJSON(raw, "judge");
  if (!json) {
    throw new Error(
      `judge output contained no parseable JSON. First 200 chars: ${raw.slice(0, 200)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `judge JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // matched_issue_id may arrive as null in strict mode — preserve it.
  return JudgeVerdictSchema.parse(parsed);
}

function stripNulls(value: unknown): unknown {
  // Note: unlike baseline.ts, we DO NOT strip nulls from `matched_issue_id`
  // here — the judge schema treats `null` as a valid value (no match), so
  // dropping it would leave a missing required field. Strip nulls only
  // from object properties that aren't part of the judge schema.
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Preserve null for matched_issue_id; strip for any other null field.
      if (v === null && k !== "matched_issue_id") continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}
