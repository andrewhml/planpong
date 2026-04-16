import { ZodError } from "zod";
import { type ReviewFeedback, type PhaseFeedback } from "../schemas/feedback.js";
import { type PlannerRevision } from "../schemas/revision.js";
import type { ReviewPhase } from "../prompts/reviewer.js";
/**
 * Thrown when structured output produces text that is not valid JSON.
 * The state machine treats this as a downgrade-eligible failure.
 */
export declare class StructuredOutputParseError extends Error {
    constructor(message: string);
}
/**
 * Thrown when structured output produces valid JSON that fails Zod
 * validation (e.g., a refinement violation). The state machine treats
 * this as terminal — the structured output mechanism worked, the model
 * just produced semantically invalid content. Retrying won't help.
 */
export declare class ZodValidationError extends Error {
    readonly zodError: ZodError;
    constructor(message: string, zodError: ZodError);
}
/**
 * Extract JSON from between sentinel tags. Falls back to finding JSON in
 * code fences, then tries parsing the entire content as JSON.
 */
export declare function extractJSON(content: string, tag: string): string | null;
export declare function parseFeedback(content: string): ReviewFeedback;
/**
 * Parse structured-output feedback. The model output is guaranteed to be
 * valid JSON conforming to the JSON Schema we passed to the CLI, so we
 * skip tag/fence extraction and parse directly. Throws:
 * - `StructuredOutputParseError` if JSON.parse fails (downgrade-eligible)
 * - `ZodValidationError` if Zod validation fails (terminal)
 */
export declare function parseStructuredFeedbackForPhase(content: string, phase: ReviewPhase): PhaseFeedback;
/**
 * Parse structured-output revision (planner response). Same contract as
 * `parseStructuredFeedbackForPhase`: throws `StructuredOutputParseError`
 * for JSON failures and `ZodValidationError` for Zod failures.
 */
export declare function parseStructuredRevision(content: string): PlannerRevision;
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
export declare function parseFeedbackForPhase(content: string, phase: ReviewPhase): PhaseFeedback;
export declare function parseRevision(content: string): PlannerRevision;
export declare function isConverged(feedback: PhaseFeedback): boolean;
