import { z } from "zod";
export declare const SeverityDisputeSchema: z.ZodObject<{
    original: z.ZodEnum<["P1", "P2", "P3"]>;
    revised: z.ZodEnum<["P1", "P2", "P3"]>;
    justification: z.ZodString;
}, "strip", z.ZodTypeAny, {
    original: "P1" | "P2" | "P3";
    revised: "P1" | "P2" | "P3";
    justification: string;
}, {
    original: "P1" | "P2" | "P3";
    revised: "P1" | "P2" | "P3";
    justification: string;
}>;
export declare const IssueResponseSchema: z.ZodObject<{
    issue_id: z.ZodString;
    action: z.ZodEnum<["accepted", "rejected", "deferred"]>;
    severity_dispute: z.ZodOptional<z.ZodObject<{
        original: z.ZodEnum<["P1", "P2", "P3"]>;
        revised: z.ZodEnum<["P1", "P2", "P3"]>;
        justification: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        original: "P1" | "P2" | "P3";
        revised: "P1" | "P2" | "P3";
        justification: string;
    }, {
        original: "P1" | "P2" | "P3";
        revised: "P1" | "P2" | "P3";
        justification: string;
    }>>;
    rationale: z.ZodString;
}, "strip", z.ZodTypeAny, {
    issue_id: string;
    action: "accepted" | "rejected" | "deferred";
    rationale: string;
    severity_dispute?: {
        original: "P1" | "P2" | "P3";
        revised: "P1" | "P2" | "P3";
        justification: string;
    } | undefined;
}, {
    issue_id: string;
    action: "accepted" | "rejected" | "deferred";
    rationale: string;
    severity_dispute?: {
        original: "P1" | "P2" | "P3";
        revised: "P1" | "P2" | "P3";
        justification: string;
    } | undefined;
}>;
export declare const PlannerRevisionSchema: z.ZodObject<{
    responses: z.ZodArray<z.ZodObject<{
        issue_id: z.ZodString;
        action: z.ZodEnum<["accepted", "rejected", "deferred"]>;
        severity_dispute: z.ZodOptional<z.ZodObject<{
            original: z.ZodEnum<["P1", "P2", "P3"]>;
            revised: z.ZodEnum<["P1", "P2", "P3"]>;
            justification: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        }, {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        }>>;
        rationale: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        issue_id: string;
        action: "accepted" | "rejected" | "deferred";
        rationale: string;
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
    }, {
        issue_id: string;
        action: "accepted" | "rejected" | "deferred";
        rationale: string;
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
    }>, "many">;
    updated_plan: z.ZodString;
}, "strip", z.ZodTypeAny, {
    responses: {
        issue_id: string;
        action: "accepted" | "rejected" | "deferred";
        rationale: string;
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
    }[];
    updated_plan: string;
}, {
    responses: {
        issue_id: string;
        action: "accepted" | "rejected" | "deferred";
        rationale: string;
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
    }[];
    updated_plan: string;
}>;
export type SeverityDispute = z.infer<typeof SeverityDisputeSchema>;
export type IssueResponse = z.infer<typeof IssueResponseSchema>;
export type PlannerRevision = z.infer<typeof PlannerRevisionSchema>;
