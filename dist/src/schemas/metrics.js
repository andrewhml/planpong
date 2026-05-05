import { z } from "zod";
// Schema-enforcement mode for a single provider invocation:
// - "structured": output shape was constrained at the API level via the
//   provider's schema flag (`--json-schema`, `--output-schema`).
// - "prompted": output shape was requested through prompt instructions
//   wrapped in `<planpong-feedback>` / `<planpong-revision>` tags, then
//   extracted and parsed. Used when the provider lacks a schema flag
//   (e.g., gemini) or after a structured-mode failure downgrades.
//
// Reads accept the historical name `"legacy"` and normalize it to
// `"prompted"` so metrics files written before the rename still parse.
const InvocationModeSchema = z.preprocess((value) => (value === "legacy" ? "prompted" : value), z.enum(["structured", "prompted"]));
export const InvocationAttemptSchema = z.object({
    mode: InvocationModeSchema,
    provider: z.string(),
    model: z.string().nullable(),
    effort: z.string().nullable(),
    prompt_chars: z.number().int().nonnegative(),
    prompt_lines: z.number().int().nonnegative(),
    output_chars: z.number().int().nonnegative().nullable(),
    output_lines: z.number().int().nonnegative().nullable(),
    duration_ms: z.number().int().nonnegative(),
    ok: z.boolean(),
    // `edit-retry` marks the targeted retry pass for failed edits in
    // edits-mode revisions. It is not a state-machine downgrade — the
    // structured/prompted mode is captured in `mode` independently.
    error_kind: z
        .enum(["capability", "fatal", "parse", "zod", "edit-retry"])
        .nullable(),
    error_exit_code: z.number().int().nullable(),
});
// Edits-mode revision telemetry. Null fields in full-mode revisions and in
// review rounds. `revision_mode` is the discriminator — when `"full"`, all
// `edits_*` and `retry_invoked` fields are null; when `"edits"`, they
// describe the round's edit-application pass.
export const RoundMetricsSchema = z.object({
    schema_version: z.literal(1),
    session_id: z.string(),
    round: z.number().int().positive(),
    phase: z.enum(["direction", "risk", "detail"]),
    role: z.enum(["review", "revision"]),
    started_at: z.string(),
    completed_at: z.string(),
    total_duration_ms: z.number().int().nonnegative(),
    attempts: z.array(InvocationAttemptSchema),
    revision_mode: z.enum(["full", "edits"]).nullable().optional(),
    edits_attempted: z.number().int().nonnegative().nullable().optional(),
    edits_applied: z.number().int().nonnegative().nullable().optional(),
    edits_failed: z.number().int().nonnegative().nullable().optional(),
    edits_retried: z.number().int().nonnegative().nullable().optional(),
    edits_recovered: z.number().int().nonnegative().nullable().optional(),
    retry_invoked: z.boolean().nullable().optional(),
    // Planner mode that produced this round's revision. `external` for
    // provider-driven revisions; `inline` for agent-driven revisions via
    // `planpong_record_revision`. Optional for back-compat with metrics
    // files written before this field existed. Unused for review-role
    // metrics.
    planner_mode: z.enum(["inline", "external"]).optional(),
});
export function summarizeTiming(metrics) {
    return {
        duration_ms: metrics.total_duration_ms,
        attempts: metrics.attempts.length,
    };
}
//# sourceMappingURL=metrics.js.map