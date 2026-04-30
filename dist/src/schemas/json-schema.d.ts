import type { ReviewPhase } from "../prompts/reviewer.js";
export declare const DirectionFeedbackJsonSchema: Record<string, unknown>;
export declare const RiskFeedbackJsonSchema: Record<string, unknown>;
export declare const ReviewFeedbackJsonSchema: Record<string, unknown>;
export declare const PlannerRevisionJsonSchema: Record<string, unknown>;
/**
 * Get the JSON Schema appropriate for a given review phase.
 */
export declare function getFeedbackJsonSchemaForPhase(phase: ReviewPhase): Record<string, unknown>;
/**
 * Get the JSON Schema for a planner revision response, selecting the
 * shape based on phase and the configured revision mode.
 *
 * - Direction phase always emits `updated_plan` (sweeping rewrites are
 *   allowed in round 1).
 * - Risk + detail phase with `revisionMode: "edits"` emits an `edits[]`
 *   array — the planner cannot fall back to full output.
 * - Risk + detail phase with `revisionMode: "full"` keeps the full-plan
 *   shape (kill switch).
 */
export declare function getRevisionJsonSchema(phase: ReviewPhase, revisionMode: "edits" | "full"): Record<string, unknown>;
