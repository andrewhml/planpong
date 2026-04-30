import { z } from "zod";

export const InvocationAttemptSchema = z.object({
  mode: z.enum(["structured", "legacy"]),
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
  // structured/legacy mode is captured in `mode` independently.
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
});

export type InvocationAttempt = z.infer<typeof InvocationAttemptSchema>;
export type RoundMetrics = z.infer<typeof RoundMetricsSchema>;

export interface MetricsContext {
  sessionId: string;
  round: number;
  phase: "direction" | "risk" | "detail";
  role: "review" | "revision";
}

export interface TimingSummary {
  duration_ms: number;
  attempts: number;
}

export function summarizeTiming(metrics: RoundMetrics): TimingSummary {
  return {
    duration_ms: metrics.total_duration_ms,
    attempts: metrics.attempts.length,
  };
}
