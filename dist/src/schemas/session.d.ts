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
    status: z.ZodEnum<["planning", "in_review", "approved", "blocked", "aborted"]>;
    currentRound: z.ZodNumber;
    startedAt: z.ZodString;
    planHash: z.ZodString;
    initialLineCount: z.ZodOptional<z.ZodNumber>;
    reviewerSessionId: z.ZodOptional<z.ZodString>;
    reviewerSessionInitialized: z.ZodOptional<z.ZodBoolean>;
    plannerMode: z.ZodDefault<z.ZodEnum<["inline", "external"]>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "aborted" | "approved" | "blocked" | "planning" | "in_review";
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
    repoRoot: string;
    planPath: string;
    planPathAbsolute: string;
    currentRound: number;
    startedAt: string;
    planHash: string;
    plannerMode: "external" | "inline";
    initialLineCount?: number | undefined;
    reviewerSessionId?: string | undefined;
    reviewerSessionInitialized?: boolean | undefined;
}, {
    id: string;
    status: "aborted" | "approved" | "blocked" | "planning" | "in_review";
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
    repoRoot: string;
    planPath: string;
    planPathAbsolute: string;
    currentRound: number;
    startedAt: string;
    planHash: string;
    initialLineCount?: number | undefined;
    reviewerSessionId?: string | undefined;
    reviewerSessionInitialized?: boolean | undefined;
    plannerMode?: "external" | "inline" | undefined;
}>;
export type Session = z.infer<typeof SessionSchema>;
