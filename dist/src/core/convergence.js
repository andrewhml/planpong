import { ReviewFeedbackSchema, DirectionFeedbackSchema, RiskFeedbackSchema, } from "../schemas/feedback.js";
import { PlannerRevisionSchema, } from "../schemas/revision.js";
/**
 * Thrown when structured output produces text that is not valid JSON.
 * The state machine treats this as a downgrade-eligible failure.
 */
export class StructuredOutputParseError extends Error {
    constructor(message) {
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
    zodError;
    constructor(message, zodError) {
        super(message);
        this.name = "ZodValidationError";
        this.zodError = zodError;
    }
}
/**
 * Extract JSON from between sentinel tags. Falls back to finding JSON in
 * code fences, then tries parsing the entire content as JSON.
 */
export function extractJSON(content, tag) {
    // Try sentinel tags first: <planpong-feedback>...</planpong-feedback>
    const tagPattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");
    const tagMatch = content.match(tagPattern);
    if (tagMatch?.[1])
        return tagMatch[1].trim();
    // Try JSON code fence: ```json ... ```
    const fencePattern = /```(?:json)?\s*([\s\S]*?)```/;
    const fenceMatch = content.match(fencePattern);
    if (fenceMatch?.[1])
        return fenceMatch[1].trim();
    // Try to find a JSON object in the content
    const jsonPattern = /\{[\s\S]*\}/;
    const jsonMatch = content.match(jsonPattern);
    if (jsonMatch?.[0])
        return jsonMatch[0].trim();
    return null;
}
export function parseFeedback(content) {
    const json = extractJSON(content, "planpong-feedback");
    if (!json) {
        throw new Error("Could not extract feedback JSON from reviewer output. Expected <planpong-feedback> tags, JSON code fence, or raw JSON object.");
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error(`Invalid JSON in reviewer output:\n${json.slice(0, 200)}`);
    }
    return ReviewFeedbackSchema.parse(parsed);
}
function parseDirectionFeedback(content) {
    const json = extractJSON(content, "planpong-feedback");
    if (!json) {
        throw new Error("Could not extract direction feedback JSON from reviewer output.");
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error(`Invalid JSON in reviewer output:\n${json.slice(0, 200)}`);
    }
    return DirectionFeedbackSchema.parse(parsed);
}
function parseRiskFeedback(content) {
    const json = extractJSON(content, "planpong-feedback");
    if (!json) {
        throw new Error("Could not extract risk feedback JSON from reviewer output.");
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error(`Invalid JSON in reviewer output:\n${json.slice(0, 200)}`);
    }
    return RiskFeedbackSchema.parse(parsed);
}
/**
 * Extract a string field value from raw JSON content using the parsed JSON object.
 * Safer than regex — parses the full JSON once and reads the field.
 */
function extractFieldFromRaw(content, field) {
    const json = extractJSON(content, "planpong-feedback");
    if (!json)
        return null;
    try {
        const parsed = JSON.parse(json);
        if (typeof parsed === "object" && parsed !== null && typeof parsed[field] === "string") {
            return parsed[field];
        }
    }
    catch {
        // fall through
    }
    return null;
}
/**
 * Extract an array field from raw JSON content using the parsed JSON object.
 */
function extractArrayFromRaw(content, field) {
    const json = extractJSON(content, "planpong-feedback");
    if (!json)
        return null;
    try {
        const parsed = JSON.parse(json);
        if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed[field])) {
            return parsed[field];
        }
    }
    catch {
        // fall through
    }
    return null;
}
/**
 * Recursively strip `null` property values from an object. OpenAI-strict
 * structured output requires every optional property to be present as
 * `null`, but our Zod schemas use `.optional()` which expects missing keys
 * (not nulls). This adapter removes nulls so Zod validation succeeds.
 *
 * Only strips top-level and nested object properties that are `null`;
 * array elements and primitive values are preserved.
 */
function stripNullProperties(value) {
    if (Array.isArray(value))
        return value.map(stripNullProperties);
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, v] of Object.entries(value)) {
            if (v === null)
                continue;
            result[key] = stripNullProperties(v);
        }
        return result;
    }
    return value;
}
/**
 * Parse structured-output feedback. The model output is guaranteed to be
 * valid JSON conforming to the JSON Schema we passed to the CLI, so we
 * skip tag/fence extraction and parse directly. Throws:
 * - `StructuredOutputParseError` if JSON.parse fails (downgrade-eligible)
 * - `ZodValidationError` if Zod validation fails (terminal)
 */
export function parseStructuredFeedbackForPhase(content, phase) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        throw new StructuredOutputParseError(`Structured output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    // OpenAI-strict output includes optional fields as null; Zod expects them missing.
    parsed = stripNullProperties(parsed);
    const schema = phase === "direction"
        ? DirectionFeedbackSchema
        : phase === "risk"
            ? RiskFeedbackSchema
            : ReviewFeedbackSchema;
    const result = schema.safeParse(parsed);
    if (!result.success) {
        throw new ZodValidationError(`Structured output failed Zod validation for ${phase} phase: ${result.error.message}`, result.error);
    }
    // Apply blocked rationale validation (same rules as legacy path)
    const feedback = result.data;
    if (phase === "direction" && feedback.verdict === "blocked") {
        const direction = feedback;
        if (!direction.approach_assessment?.trim()) {
            console.warn("[planpong] Blocked verdict without approach_assessment rationale — coercing to needs_revision");
            return { ...direction, verdict: "needs_revision" };
        }
    }
    if (phase === "risk" && feedback.verdict === "blocked") {
        const risk = feedback;
        if (!risk.risks || risk.risks.length === 0) {
            console.warn("[planpong] Blocked verdict without risks rationale — coercing to needs_revision");
            return { ...risk, verdict: "needs_revision" };
        }
    }
    return feedback;
}
/**
 * Parse structured-output revision (planner response). Same contract as
 * `parseStructuredFeedbackForPhase`: throws `StructuredOutputParseError`
 * for JSON failures and `ZodValidationError` for Zod failures.
 */
export function parseStructuredRevision(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        throw new StructuredOutputParseError(`Structured output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    parsed = stripNullProperties(parsed);
    const result = PlannerRevisionSchema.safeParse(parsed);
    if (!result.success) {
        throw new ZodValidationError(`Structured output failed Zod validation for revision: ${result.error.message}`, result.error);
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
export function parseFeedbackForPhase(content, phase) {
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
                return { ...feedback, verdict: "needs_revision" };
            }
            return feedback;
        }
        else {
            const feedback = parseRiskFeedback(content);
            // Validate blocked rationale
            if (feedback.verdict === "blocked" && (!feedback.risks || feedback.risks.length === 0)) {
                console.warn("[planpong] Blocked verdict without risks rationale — coercing to needs_revision");
                return { ...feedback, verdict: "needs_revision" };
            }
            return feedback;
        }
    }
    catch {
        // Phase-specific parse failed — fall back to base schema
    }
    // Fallback: parse with base schema
    const feedback = parseFeedback(content);
    // Determine which phase-specific fields are missing
    const missingFields = [];
    if (phase === "direction") {
        for (const field of ["confidence", "approach_assessment", "alternatives", "assumptions"]) {
            if (!(field in feedback) || feedback[field] === undefined) {
                missingFields.push(field);
            }
        }
    }
    else {
        for (const field of ["risk_level", "risks"]) {
            if (!(field in feedback) || feedback[field] === undefined) {
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
                const result = {
                    ...feedback,
                    verdict: "blocked",
                    fallback_used: true,
                    missing_phase_fields: missingFields,
                };
                result.approach_assessment = assessment;
                return result;
            }
            console.warn("[planpong] Blocked verdict under fallback without recoverable rationale — coercing to needs_revision");
        }
        else {
            // Try to recover risks from raw content
            const risks = extractArrayFromRaw(content, "risks");
            if (risks && risks.length > 0) {
                const result = {
                    ...feedback,
                    verdict: "blocked",
                    fallback_used: true,
                    missing_phase_fields: missingFields,
                };
                result.risks = risks;
                return result;
            }
            console.warn("[planpong] Blocked verdict under fallback without recoverable risks rationale — coercing to needs_revision");
        }
    }
    // Verdict coercion: direction/risk cannot approve, only needs_revision or blocked
    const coercedVerdict = feedback.verdict === "blocked" ? "needs_revision" : "needs_revision";
    return {
        ...feedback,
        verdict: coercedVerdict,
        fallback_used: true,
        missing_phase_fields: missingFields,
    };
}
export function parseRevision(content) {
    const json = extractJSON(content, "planpong-revision");
    if (!json) {
        throw new Error("Could not extract revision JSON from planner output. Expected <planpong-revision> tags, JSON code fence, or raw JSON object.");
    }
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        throw new Error(`Invalid JSON in planner output:\n${json.slice(0, 200)}`);
    }
    return PlannerRevisionSchema.parse(parsed);
}
export function isConverged(feedback) {
    return feedback.verdict !== "needs_revision";
}
//# sourceMappingURL=convergence.js.map