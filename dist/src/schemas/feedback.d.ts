import { z } from "zod";
export declare const FeedbackIssueSchema: z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<["P1", "P2", "P3"]>;
    section: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    suggestion: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    severity: "P1" | "P2" | "P3";
    section: string;
    title: string;
    description: string;
    suggestion: string;
}, {
    id: string;
    severity: "P1" | "P2" | "P3";
    section: string;
    title: string;
    description: string;
    suggestion: string;
}>;
export declare const ReviewFeedbackSchema: z.ZodEffects<z.ZodObject<{
    verdict: z.ZodEnum<["needs_revision", "approved", "approved_with_notes"]>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["P1", "P2", "P3"]>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
    }, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
    }[];
    verdict: "needs_revision" | "approved" | "approved_with_notes";
    summary: string;
}, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
    }[];
    verdict: "needs_revision" | "approved" | "approved_with_notes";
    summary: string;
}>, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
    }[];
    verdict: "needs_revision" | "approved" | "approved_with_notes";
    summary: string;
}, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
    }[];
    verdict: "needs_revision" | "approved" | "approved_with_notes";
    summary: string;
}>;
export type FeedbackIssue = z.infer<typeof FeedbackIssueSchema>;
export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>;
