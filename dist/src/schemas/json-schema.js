import { zodToJsonSchema } from "zod-to-json-schema";
import { DirectionFeedbackSchema, RiskFeedbackSchema, ReviewFeedbackSchema, } from "./feedback.js";
import { PlannerRevisionSchema } from "./revision.js";
/**
 * JSON Schemas generated from Zod schemas, used for constrained model output
 * via `claude --json-schema` and `codex --output-schema`.
 *
 * KNOWN LIMITATION: Zod refinements (e.g., the `approved_with_notes` severity
 * constraint on ReviewFeedbackSchema) and transforms do NOT round-trip to
 * JSON Schema. The generated JSON Schema enforces structural validity only.
 * Semantic rules are validated post-parse by Zod in convergence.ts.
 *
 * Schemas are generated once at module load and cached as constants.
 */
/**
 * Internal observability fields on feedback schemas — set by the parser
 * after the model responds. These must NOT appear in the schema sent to
 * the model, since the model doesn't produce them.
 */
const OBSERVABILITY_FIELDS = new Set([
    "fallback_used",
    "missing_phase_fields",
]);
function stripObservabilityFields(node) {
    if (Array.isArray(node))
        return node.map(stripObservabilityFields);
    if (node && typeof node === "object") {
        const obj = node;
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key === "properties" && value && typeof value === "object") {
                const props = value;
                const filtered = {};
                for (const [propKey, propValue] of Object.entries(props)) {
                    if (!OBSERVABILITY_FIELDS.has(propKey)) {
                        filtered[propKey] = stripObservabilityFields(propValue);
                    }
                }
                result[key] = filtered;
            }
            else if (key === "required" && Array.isArray(value)) {
                result[key] = value.filter((k) => typeof k !== "string" || !OBSERVABILITY_FIELDS.has(k));
            }
            else {
                result[key] = stripObservabilityFields(value);
            }
        }
        return result;
    }
    return node;
}
/**
 * Transform a JSON Schema to the OpenAI-strict dialect required by Codex
 * (and most OpenAI-compatible providers) for structured output:
 *
 * - Every `object` node must have `additionalProperties: false`
 * - Every property must appear in `required`
 * - Optional properties are expressed as nullable (type union with "null")
 *
 * Input: a JSON Schema 7 document generated from Zod (with optional fields
 * missing from `required`).
 * Output: an OpenAI-strict JSON Schema that is accepted by strict mode and
 * still structurally compatible with the original Zod validation.
 *
 * Anthropic's validator accepts the stricter form, so we apply this
 * transformation universally rather than per-provider.
 */
function toOpenAIStrict(node) {
    if (Array.isArray(node))
        return node.map(toOpenAIStrict);
    if (!node || typeof node !== "object")
        return node;
    const obj = node;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = toOpenAIStrict(value);
    }
    // Only transform object nodes that have properties
    if (result.type !== "object" ||
        !result.properties ||
        typeof result.properties !== "object") {
        return result;
    }
    const properties = result.properties;
    const originalRequired = new Set(Array.isArray(result.required) ? result.required : []);
    const allKeys = Object.keys(properties);
    // Every property must be in `required`
    result.required = allKeys;
    // Previously optional fields → mark as nullable
    for (const propKey of allKeys) {
        if (!originalRequired.has(propKey)) {
            properties[propKey] = makeNullable(properties[propKey]);
        }
    }
    // Every object needs `additionalProperties: false`
    if (result.additionalProperties === undefined) {
        result.additionalProperties = false;
    }
    return result;
}
/**
 * Make a JSON Schema node accept null in addition to its existing type.
 * - Simple type: `{ type: "string" }` → `{ type: ["string", "null"] }`
 * - Enum: `{ type: "string", enum: [...] }` → `{ type: ["string", "null"], enum: [..., null] }`
 * - Union types: append "null" if not present
 * - Other constructs: wrap in `anyOf` with null
 */
function makeNullable(node) {
    if (!node || typeof node !== "object")
        return node;
    const obj = { ...node };
    const existingType = obj.type;
    if (typeof existingType === "string") {
        obj.type = [existingType, "null"];
    }
    else if (Array.isArray(existingType)) {
        if (!existingType.includes("null")) {
            obj.type = [...existingType, "null"];
        }
    }
    else {
        // No concrete type (e.g., anyOf/oneOf) — wrap in anyOf
        return { anyOf: [node, { type: "null" }] };
    }
    // If the node has an enum, also add null as a valid enum value
    if (Array.isArray(obj.enum) && !obj.enum.includes(null)) {
        obj.enum = [...obj.enum, null];
    }
    return obj;
}
function generate(schema) {
    const raw = zodToJsonSchema(schema, {
        target: "jsonSchema7",
        $refStrategy: "none",
    });
    const stripped = stripObservabilityFields(raw);
    return toOpenAIStrict(stripped);
}
export const DirectionFeedbackJsonSchema = generate(DirectionFeedbackSchema);
export const RiskFeedbackJsonSchema = generate(RiskFeedbackSchema);
export const ReviewFeedbackJsonSchema = generate(ReviewFeedbackSchema);
export const PlannerRevisionJsonSchema = generate(PlannerRevisionSchema);
/**
 * Get the JSON Schema appropriate for a given review phase.
 */
export function getFeedbackJsonSchemaForPhase(phase) {
    if (phase === "direction")
        return DirectionFeedbackJsonSchema;
    if (phase === "risk")
        return RiskFeedbackJsonSchema;
    return ReviewFeedbackJsonSchema;
}
//# sourceMappingURL=json-schema.js.map