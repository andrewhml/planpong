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
    action: "accepted" | "deferred" | "rejected";
    severity_dispute?: {
        original: "P1" | "P2" | "P3";
        revised: "P1" | "P2" | "P3";
        justification: string;
    } | undefined;
    rationale: string;
}, {
    issue_id: string;
    action: "accepted" | "deferred" | "rejected";
    severity_dispute?: {
        original: "P1" | "P2" | "P3";
        revised: "P1" | "P2" | "P3";
        justification: string;
    } | undefined;
    rationale: string;
}>;
export declare const ReplaceEditSchema: z.ZodObject<{
    section: z.ZodString;
    before: z.ZodString;
    after: z.ZodString;
}, "strip", z.ZodTypeAny, {
    section: string;
    before: string;
    after: string;
}, {
    section: string;
    before: string;
    after: string;
}>;
export declare const DirectionRevisionSchema: z.ZodObject<{
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
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }, {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }>, "many">;
    updated_plan: z.ZodString;
}, "strict", z.ZodTypeAny, {
    responses: {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }[];
    updated_plan: string;
}, {
    responses: {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }[];
    updated_plan: string;
}>;
export declare const EditsRevisionSchema: z.ZodObject<{
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
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }, {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }>, "many">;
    edits: z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        before: z.ZodString;
        after: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        section: string;
        before: string;
        after: string;
    }, {
        section: string;
        before: string;
        after: string;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    responses: {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }[];
    edits: {
        section: string;
        before: string;
        after: string;
    }[];
}, {
    responses: {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }[];
    edits: {
        section: string;
        before: string;
        after: string;
    }[];
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
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }, {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }>, "many">;
    updated_plan: z.ZodString;
}, "strict", z.ZodTypeAny, {
    responses: {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }[];
    updated_plan: string;
}, {
    responses: {
        issue_id: string;
        action: "accepted" | "deferred" | "rejected";
        severity_dispute?: {
            original: "P1" | "P2" | "P3";
            revised: "P1" | "P2" | "P3";
            justification: string;
        } | undefined;
        rationale: string;
    }[];
    updated_plan: string;
}>;
export type SeverityDispute = z.infer<typeof SeverityDisputeSchema>;
export type IssueResponse = z.infer<typeof IssueResponseSchema>;
export type ReplaceEdit = z.infer<typeof ReplaceEditSchema>;
export type DirectionRevision = z.infer<typeof DirectionRevisionSchema>;
export type EditsRevision = z.infer<typeof EditsRevisionSchema>;
export type PlannerRevision = DirectionRevision | EditsRevision;
export declare function isEditsRevision(r: PlannerRevision): r is EditsRevision;
export declare function isDirectionRevision(r: PlannerRevision): r is DirectionRevision;
