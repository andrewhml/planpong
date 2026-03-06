import { z } from "zod";
export declare const ProviderConfigSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    effort: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    provider: string;
    model?: string | undefined;
    effort?: string | undefined;
}, {
    provider: string;
    model?: string | undefined;
    effort?: string | undefined;
}>;
export declare const PlanpongConfigSchema: z.ZodObject<{
    planner: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        effort: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    }, {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    }>;
    reviewer: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        effort: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    }, {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    }>;
    plans_dir: z.ZodDefault<z.ZodString>;
    max_rounds: z.ZodDefault<z.ZodNumber>;
    human_in_loop: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    planner: {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    };
    reviewer: {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    };
    plans_dir: string;
    max_rounds: number;
    human_in_loop: boolean;
}, {
    planner: {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    };
    reviewer: {
        provider: string;
        model?: string | undefined;
        effort?: string | undefined;
    };
    plans_dir?: string | undefined;
    max_rounds?: number | undefined;
    human_in_loop?: boolean | undefined;
}>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type PlanpongConfig = z.infer<typeof PlanpongConfigSchema>;
