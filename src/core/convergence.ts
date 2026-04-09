import { ZodError } from "zod";
import {
  ReviewFeedbackSchema,
  DirectionFeedbackSchema,
  RiskFeedbackSchema,
  type ReviewFeedback,
  type DirectionFeedback,
  type RiskFeedback,
  type PhaseFeedback,
} from "../schemas/feedback.js";
import {
  PlannerRevisionSchema,
  type PlannerRevision,
} from "../schemas/revision.js";
import type { ReviewPhase } from "../prompts/reviewer.js";

/**
 * Thrown when structured output produces text that is not valid JSON.
 * The state machine treats this as a downgrade-eligible failure.
 */
export class StructuredOutputParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputParseError";
  }
}

/**
 * Thrown when structured output produces valid JSON that fails Zod
 * validation (e.g., a refinement violation). The state machine treats
 * this as terminal — the structured output mechanism worked, the model
 * just produced semantically invalid content. Retrying won't help.
 */
export class ZodValidationError extends Error {
  public readonly zodError: ZodError;
  constructor(message: string, zodError: ZodError) {
    super(message);
    this.name = "ZodValidationError";
    this.zodError = zodError;
  }
}

/**
 * Extract JSON from between sentinel tags. Falls back to finding JSON in
 * code fences, then tries parsing the entire content as JSON.
 */
export function extractJSON(content: string, tag: string): string | null {
  // Try sentinel tags first: <planpong-feedback>...</planpong-feedback>
  const tagPattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");
  const tagMatch = content.match(tagPattern);
  if (tagMatch?.[1]) return tagMatch[1].trim();

  // Try JSON code fence: ```json ... ```
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/;
  const fenceMatch = content.match(fencePattern);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Try to find a JSON object in the content
  const jsonPattern = /\{[\s\S]*\}/;
  const jsonMatch = content.match(jsonPattern);
  if (jsonMatch?.[0]) return jsonMatch[0].trim();

  return null;
}

export function parseFeedback(content: string): ReviewFeedback {
  const json = extractJSON(content, "planpong-feedback");
  if (!json) {
    throw new Error(
      "Could not extract feedback JSON from reviewer output. Expected <planpong-feedback> tags, JSON code fence, or raw JSON object.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON in reviewer output:\n${json.slice(0, 200)}`);
  }

  return ReviewFeedbackSchema.parse(parsed);
}

function parseDirectionFeedback(content: string): DirectionFeedback {
  const json = extractJSON(content, "planpong-feedback");
  if (!json) {
    throw new Error("Could not extract direction feedback JSON from reviewer output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON in reviewer output:\n${json.slice(0, 200)}`);
  }

  return DirectionFeedbackSchema.parse(parsed);
}

function parseRiskFeedback(content: string): RiskFeedback {
  const json = extractJSON(content, "planpong-feedback");
  if (!json) {
    throw new Error("Could not extract risk feedback JSON from reviewer output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON in reviewer output:\n${json.slice(0, 200)}`);
  }

  return RiskFeedbackSchema.parse(parsed);
}

/**
 * Extract a string field value from raw JSON content using the parsed JSON object.
 * Safer than regex — parses the full JSON once and reads the field.
 */
function extractFieldFromRaw(content: string, field: string): string | null {
  const json = extractJSON(content, "planpong-feedback");
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null && typeof parsed[field] === "string") {
      return parsed[field] as string;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Extract an array field from raw JSON content using the parsed JSON object.
 */
function extractArrayFromRaw(content: string, field: string): unknown[] | null {
  const json = extractJSON(content, "planpong-feedback");
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed[field])) {
      return parsed[field] as unknown[];
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Parse structured-output feedback. The model output is guaranteed to be
 * valid JSON conforming to the JSON Schema we passed to the CLI, so we
 * skip tag/fence extraction and parse directly. Throws:
 * - `StructuredOutputParseError` if JSON.parse fails (downgrade-eligible)
 * - `ZodValidationError` if Zod validation fails (terminal)
 */
export function parseStructuredFeedbackForPhase(
  content: string,
  phase: ReviewPhase,
): PhaseFeedback {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new StructuredOutputParseError(
      `Structured output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const schema =
    phase === "direction"
      ? DirectionFeedbackSchema
      : phase === "risk"
        ? RiskFeedbackSchema
        : ReviewFeedbackSchema;

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ZodValidationError(
      `Structured output failed Zod validation for ${phase} phase: ${result.error.message}`,
      result.error,
    );
  }

  // Apply blocked rationale validation (same rules as legacy path)
  const feedback = result.data as PhaseFeedback;
  if (phase === "direction" && feedback.verdict === "blocked") {
    const direction = feedback as DirectionFeedback;
    if (!direction.approach_assessment?.trim()) {
      console.warn(
        "[planpong] Blocked verdict without approach_assessment rationale — coercing to needs_revision",
      );
      return { ...direction, verdict: "needs_revision" as const };
    }
  }
  if (phase === "risk" && feedback.verdict === "blocked") {
    const risk = feedback as RiskFeedback;
    if (!risk.risks || risk.risks.length === 0) {
      console.warn(
        "[planpong] Blocked verdict without risks rationale — coercing to needs_revision",
      );
      return { ...risk, verdict: "needs_revision" as const };
    }
  }
  return feedback;
}

/**
 * Parse structured-output revision (planner response). Same contract as
 * `parseStructuredFeedbackForPhase`: throws `StructuredOutputParseError`
 * for JSON failures and `ZodValidationError` for Zod failures.
 */
export function parseStructuredRevision(content: string): PlannerRevision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new StructuredOutputParseError(
      `Structured output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = PlannerRevisionSchema.safeParse(parsed);
  if (!result.success) {
    throw new ZodValidationError(
      `Structured output failed Zod validation for revision: ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
}

/**
 * Phase-aware feedback parser (LEGACY/DEGRADATION MODE).
 *
 * TODO: deprecate when structured output is stable across all providers.
 *
 * Tries the phase-specific parser first, falls back to base parser, then
 * applies verdict coercion and blocked rationale validation. Used when a
 * provider does not support structured output, or as a fallback when
 * structured output fails.
 */
export function parseFeedbackForPhase(
  content: string,
  phase: ReviewPhase,
): PhaseFeedback {
  if (phase === "detail") {
    return parseFeedback(content);
  }

  // Try phase-specific parser first
  try {
    if (phase === "direction") {
      const feedback = parseDirectionFeedback(content);
      // Validate blocked rationale
      if (feedback.verdict === "blocked" && !feedback.approach_assessment?.trim()) {
        console.warn("[planpong] Blocked verdict without approach_assessment rationale — coercing to needs_revision");
        return { ...feedback, verdict: "needs_revision" as const };
      }
      return feedback;
    } else {
      const feedback = parseRiskFeedback(content);
      // Validate blocked rationale
      if (feedback.verdict === "blocked" && (!feedback.risks || feedback.risks.length === 0)) {
        console.warn("[planpong] Blocked verdict without risks rationale — coercing to needs_revision");
        return { ...feedback, verdict: "needs_revision" as const };
      }
      return feedback;
    }
  } catch {
    // Phase-specific parse failed — fall back to base schema
  }

  // Fallback: parse with base schema
  const feedback = parseFeedback(content);

  // Determine which phase-specific fields are missing
  const missingFields: string[] = [];
  if (phase === "direction") {
    for (const field of ["confidence", "approach_assessment", "alternatives", "assumptions"]) {
      if (!(field in feedback) || (feedback as Record<string, unknown>)[field] === undefined) {
        missingFields.push(field);
      }
    }
  } else {
    for (const field of ["risk_level", "risks"]) {
      if (!(field in feedback) || (feedback as Record<string, unknown>)[field] === undefined) {
        missingFields.push(field);
      }
    }
  }

  console.warn(`[planpong] Phase-specific parse failed for ${phase} phase, using fallback. Missing fields: ${missingFields.join(", ")}`);

  // Blocked rationale validation under fallback
  if (feedback.verdict === "blocked") {
    if (phase === "direction") {
      // Try to recover approach_assessment from raw content
      const assessment = extractFieldFromRaw(content, "approach_assessment");
      if (assessment?.trim()) {
        // Preserve blocked, attach recovered rationale
        const result: PhaseFeedback = {
          ...feedback,
          verdict: "blocked" as const,
          fallback_used: true,
          missing_phase_fields: missingFields,
        };
        (result as Record<string, unknown>).approach_assessment = assessment;
        return result;
      }
      console.warn("[planpong] Blocked verdict under fallback without recoverable rationale — coercing to needs_revision");
    } else {
      // Try to recover risks from raw content
      const risks = extractArrayFromRaw(content, "risks");
      if (risks && risks.length > 0) {
        const result: PhaseFeedback = {
          ...feedback,
          verdict: "blocked" as const,
          fallback_used: true,
          missing_phase_fields: missingFields,
        };
        (result as Record<string, unknown>).risks = risks;
        return result;
      }
      console.warn("[planpong] Blocked verdict under fallback without recoverable risks rationale — coercing to needs_revision");
    }
  }

  // Verdict coercion: direction/risk cannot approve, only needs_revision or blocked
  const coercedVerdict = feedback.verdict === "blocked" ? "needs_revision" as const : "needs_revision" as const;
  return {
    ...feedback,
    verdict: coercedVerdict,
    fallback_used: true,
    missing_phase_fields: missingFields,
  };
}

export function parseRevision(content: string): PlannerRevision {
  const json = extractJSON(content, "planpong-revision");
  if (!json) {
    throw new Error(
      "Could not extract revision JSON from planner output. Expected <planpong-revision> tags, JSON code fence, or raw JSON object.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid JSON in planner output:\n${json.slice(0, 200)}`);
  }

  return PlannerRevisionSchema.parse(parsed);
}

export function isConverged(feedback: PhaseFeedback): boolean {
  return feedback.verdict !== "needs_revision";
}
