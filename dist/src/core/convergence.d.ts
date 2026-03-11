import { type ReviewFeedback, type PhaseFeedback } from "../schemas/feedback.js";
import { type PlannerRevision } from "../schemas/revision.js";
import type { ReviewPhase } from "../prompts/reviewer.js";
/**
 * Extract JSON from between sentinel tags. Falls back to finding JSON in
 * code fences, then tries parsing the entire content as JSON.
 */
export declare function extractJSON(content: string, tag: string): string | null;
export declare function parseFeedback(content: string): ReviewFeedback;
/**
 * Phase-aware feedback parser. Tries the phase-specific parser first,
 * falls back to base parser, then applies verdict coercion and blocked
 * rationale validation.
 */
export declare function parseFeedbackForPhase(content: string, phase: ReviewPhase): PhaseFeedback;
export declare function parseRevision(content: string): PlannerRevision;
export declare function isConverged(feedback: PhaseFeedback): boolean;
