import type { ReviewPhase } from "../prompts/reviewer.js";
export declare const DirectionFeedbackJsonSchema: Record<string, unknown>;
export declare const RiskFeedbackJsonSchema: Record<string, unknown>;
export declare const ReviewFeedbackJsonSchema: Record<string, unknown>;
export declare const PlannerRevisionJsonSchema: Record<string, unknown>;
/**
 * Get the JSON Schema appropriate for a given review phase.
 */
export declare function getFeedbackJsonSchemaForPhase(phase: ReviewPhase): Record<string, unknown>;
