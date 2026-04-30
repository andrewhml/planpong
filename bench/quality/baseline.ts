/**
 * Single-pass baseline review.
 *
 * Calls the reviewer provider once with a minimal prompt — no phase
 * scaffolding, no state machine, no persistent sessions, no planpong
 * reviewer prompt. Same fixture access (same cwd), same structured output
 * shape so the LLM judge sees comparable input across modes.
 *
 * The point: isolate the value of planpong's scaffolding (multi-phase,
 * structured prompts, state-machine retry, prior-decisions context) from
 * the value of the underlying model. If the baseline catches the same
 * defects the planpong path catches, the scaffolding adds no signal.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Provider } from "../../src/providers/types.js";
import { FeedbackIssueSchema } from "../../src/schemas/feedback.js";
import {
  StructuredOutputParseError,
  extractJSON,
} from "../../src/core/convergence.js";

export const BaselineIssuesSchema = z.object({
  issues: z.array(FeedbackIssueSchema),
});

export type BaselineIssues = z.infer<typeof BaselineIssuesSchema>;

const BASELINE_JSON_SCHEMA: Record<string, unknown> = (() => {
  // Generate a JSON-schema-7 doc, then stamp it OpenAI-strict so codex's
  // --output-schema accepts it. (We cannot reuse src/schemas/json-schema.ts
  // because that file pre-bakes only the planpong feedback shapes.)
  const raw = zodToJsonSchema(BaselineIssuesSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  });
  return toStrict(raw);
})();

function toStrict(node: unknown): Record<string, unknown> {
  return strictTransform(node) as Record<string, unknown>;
}

function strictTransform(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictTransform);
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = strictTransform(v);
  if (out.type !== "object" || !out.properties) return out;
  const props = out.properties as Record<string, unknown>;
  out.required = Object.keys(props);
  if (out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

export interface BaselineResult {
  issues: BaselineIssues["issues"];
  durationMs: number;
  outputChars: number;
  rawOutput: string;
  /** True when the provider produced JSON via --output-schema; false on legacy fallback. */
  structured: boolean;
}

const BASELINE_PROMPT = `You are reviewing an implementation plan for an upcoming code change.

The current working directory contains the codebase the plan will be applied to. You have read access to all files in it via your tools (Read, Grep, Glob, Bash).

Your task: identify problems with the plan. Look for issues like:
- Wrong file paths or hallucinated files
- Hallucinated functions, methods, or imports
- Internal contradictions across plan sections
- Missing steps or unclear data flow
- Steps that conflict with the existing codebase config (e.g., tsconfig)
- Out-of-scope work bundled in
- Mismatches between Steps and Verification Criteria

Be specific. For each issue, name the section, what's wrong, and why.

Output JSON in this exact shape:

{
  "issues": [
    {
      "id": "F1",
      "severity": "P1" | "P2" | "P3",
      "section": "<plan section the issue applies to>",
      "title": "<one-line summary>",
      "description": "<2-4 sentences explaining the problem>",
      "suggestion": "<how to fix it>"
    },
    ...
  ]
}

Severity guide:
- P1: blocks the plan from working at all (broken reference, contradiction, missing required step)
- P2: significant gap or risk that should be fixed before implementation
- P3: minor / stylistic / nice-to-have

If the plan looks fine, return \`{"issues": []}\`.

The plan is below.

---

`;

export async function runBaselineReview({
  reviewerProvider,
  reviewerModel,
  reviewerEffort,
  cwd,
  planText,
  timeoutMs,
}: {
  reviewerProvider: Provider;
  reviewerModel?: string;
  reviewerEffort?: string;
  cwd: string;
  planText: string;
  timeoutMs: number;
}): Promise<BaselineResult> {
  const prompt = BASELINE_PROMPT + planText;

  const supportsStructured = await reviewerProvider
    .checkStructuredOutputSupport()
    .catch(() => false);

  const started = Date.now();
  const response = await reviewerProvider.invoke(prompt, {
    cwd,
    model: reviewerModel,
    effort: reviewerEffort,
    timeout: timeoutMs,
    jsonSchema: supportsStructured ? BASELINE_JSON_SCHEMA : undefined,
  });
  const durationMs = Date.now() - started;

  if (!response.ok) {
    throw new Error(
      `baseline reviewer invocation failed (${response.error.kind}): ${response.error.message}`,
    );
  }

  const raw = response.output;

  // Try strict parse first when structured was requested.
  if (supportsStructured) {
    try {
      const parsed = JSON.parse(raw);
      const validated = BaselineIssuesSchema.parse(stripNulls(parsed));
      return {
        issues: validated.issues,
        durationMs,
        outputChars: raw.length,
        rawOutput: raw,
        structured: true,
      };
    } catch (err) {
      // fall through to legacy extraction — some providers add stray prose
      // even with structured output (claude has done this on edge cases).
      if (err instanceof StructuredOutputParseError) {
        // continue
      }
    }
  }

  const json = extractJSON(raw, "issues");
  if (!json) {
    throw new Error(
      `baseline reviewer output contained no parseable JSON. First 200 chars: ${raw.slice(0, 200)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `baseline reviewer JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const validated = BaselineIssuesSchema.parse(stripNulls(parsed));
  return {
    issues: validated.issues,
    durationMs,
    outputChars: raw.length,
    rawOutput: raw,
    structured: false,
  };
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}
