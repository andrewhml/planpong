import { type ReviewFeedback } from "../schemas/feedback.js";
import { type PlannerRevision } from "../schemas/revision.js";
/**
 * Extract JSON from between sentinel tags. Falls back to finding JSON in
 * code fences, then tries parsing the entire content as JSON.
 */
export declare function extractJSON(content: string, tag: string): string | null;
export declare function parseFeedback(content: string): ReviewFeedback;
export declare function parseRevision(content: string): PlannerRevision;
export declare function isConverged(feedback: ReviewFeedback, round: number): boolean;
