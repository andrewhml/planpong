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
function generate(schema) {
    return zodToJsonSchema(schema, {
        target: "jsonSchema7",
        $refStrategy: "none",
    });
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