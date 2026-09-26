import { z } from "zod";
export declare const InvocationAttemptSchema: z.ZodObject<{
    mode: z.ZodPreprocess<z.ZodEnum<{
        prompted: "prompted";
        structured: "structured";
    }>, unknown>;
    provider: z.ZodString;
    model: z.ZodNullable<z.ZodString>;
    effort: z.ZodNullable<z.ZodString>;
    prompt_chars: z.ZodNumber;
    prompt_lines: z.ZodNumber;
    output_chars: z.ZodNullable<z.ZodNumber>;
    output_lines: z.ZodNullable<z.ZodNumber>;
    duration_ms: z.ZodNumber;
    ok: z.ZodBoolean;
    error_kind: z.ZodNullable<z.ZodEnum<{
        capability: "capability";
        "edit-retry": "edit-retry";
        fatal: "fatal";
        parse: "parse";
        zod: "zod";
    }>>;
    error_exit_code: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export declare const RoundMetricsSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    session_id: z.ZodString;
    round: z.ZodNumber;
    phase: z.ZodEnum<{
        detail: "detail";
        direction: "direction";
        risk: "risk";
    }>;
    role: z.ZodEnum<{
        review: "review";
        revision: "revision";
    }>;
    started_at: z.ZodString;
    completed_at: z.ZodString;
    total_duration_ms: z.ZodNumber;
    attempts: z.ZodArray<z.ZodObject<{
        mode: z.ZodPreprocess<z.ZodEnum<{
            prompted: "prompted";
            structured: "structured";
        }>, unknown>;
        provider: z.ZodString;
        model: z.ZodNullable<z.ZodString>;
        effort: z.ZodNullable<z.ZodString>;
        prompt_chars: z.ZodNumber;
        prompt_lines: z.ZodNumber;
        output_chars: z.ZodNullable<z.ZodNumber>;
        output_lines: z.ZodNullable<z.ZodNumber>;
        duration_ms: z.ZodNumber;
        ok: z.ZodBoolean;
        error_kind: z.ZodNullable<z.ZodEnum<{
            capability: "capability";
            "edit-retry": "edit-retry";
            fatal: "fatal";
            parse: "parse";
            zod: "zod";
        }>>;
        error_exit_code: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    revision_mode: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        edits: "edits";
        full: "full";
    }>>>;
    edits_attempted: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    edits_applied: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    edits_failed: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    edits_retried: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    edits_recovered: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    retry_invoked: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    planner_mode: z.ZodOptional<z.ZodEnum<{
        external: "external";
        inline: "inline";
    }>>;
}, z.core.$strip>;
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
export declare function summarizeTiming(metrics: RoundMetrics): TimingSummary;
