import {
  ReviewFeedbackSchema,
  type ReviewFeedback,
} from "../schemas/feedback.js";
import {
  PlannerRevisionSchema,
  type PlannerRevision,
} from "../schemas/revision.js";

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

export function isConverged(feedback: ReviewFeedback): boolean {
  return feedback.verdict !== "needs_revision";
}
