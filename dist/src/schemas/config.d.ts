import { z } from "zod";
export declare const ProviderConfigSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    effort: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PlanpongConfigSchema: z.ZodObject<{
    planner: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        effort: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    reviewer: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodOptional<z.ZodString>;
        effort: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    plans_dir: z.ZodDefault<z.ZodString>;
    max_rounds: z.ZodDefault<z.ZodNumber>;
    human_in_loop: z.ZodDefault<z.ZodBoolean>;
    revision_mode: z.ZodDefault<z.ZodEnum<{
        edits: "edits";
        full: "full";
    }>>;
    planner_mode: z.ZodDefault<z.ZodEnum<{
        external: "external";
        inline: "inline";
    }>>;
}, z.core.$strip>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type PlanpongConfig = z.infer<typeof PlanpongConfigSchema>;
