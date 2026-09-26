import { z } from "zod";
export declare const SessionSchema: z.ZodObject<{
    id: z.ZodString;
    repoRoot: z.ZodString;
    planPath: z.ZodString;
    planPathAbsolute: z.ZodString;
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
    status: z.ZodEnum<{
        aborted: "aborted";
        approved: "approved";
        blocked: "blocked";
        in_review: "in_review";
        planning: "planning";
    }>;
    currentRound: z.ZodNumber;
    startedAt: z.ZodString;
    planHash: z.ZodString;
    initialLineCount: z.ZodOptional<z.ZodNumber>;
    reviewerSessionId: z.ZodOptional<z.ZodString>;
    reviewerSessionInitialized: z.ZodOptional<z.ZodBoolean>;
    plannerMode: z.ZodDefault<z.ZodEnum<{
        external: "external";
        inline: "inline";
    }>>;
    inlineClient: z.ZodOptional<z.ZodString>;
    maxRounds: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type Session = z.infer<typeof SessionSchema>;
