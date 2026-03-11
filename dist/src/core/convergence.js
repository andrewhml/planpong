import { ReviewFeedbackSchema, DirectionFeedbackSchema, RiskFeedbackSchema, } from "../schemas/feedback.js";
import { PlannerRevisionSchema, } from "../schemas/revision.js";
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
 * Phase-aware feedback parser. Tries the phase-specific parser first,
 * falls back to base parser, then applies verdict coercion and blocked
 * rationale validation.
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