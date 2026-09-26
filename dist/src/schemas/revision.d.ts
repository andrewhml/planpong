import { z } from "zod";
export declare const SeverityDisputeSchema: z.ZodObject<{
    original: z.ZodEnum<{
        P1: "P1";
        P2: "P2";
        P3: "P3";
    }>;
    revised: z.ZodEnum<{
        P1: "P1";
        P2: "P2";
        P3: "P3";
    }>;
    justification: z.ZodString;
}, z.core.$strip>;
export declare const IssueResponseSchema: z.ZodObject<{
    issue_id: z.ZodString;
    action: z.ZodEnum<{
        accepted: "accepted";
        deferred: "deferred";
        rejected: "rejected";
    }>;
    severity_dispute: z.ZodOptional<z.ZodObject<{
        original: z.ZodEnum<{
            P1: "P1";
            P2: "P2";
            P3: "P3";
        }>;
        revised: z.ZodEnum<{
            P1: "P1";
            P2: "P2";
            P3: "P3";
        }>;
        justification: z.ZodString;
    }, z.core.$strip>>;
    rationale: z.ZodString;
}, z.core.$strip>;
export declare const ReplaceEditSchema: z.ZodObject<{
    section: z.ZodString;
    before: z.ZodString;
    after: z.ZodString;
}, z.core.$strip>;
export declare const DirectionRevisionSchema: z.ZodObject<{
    responses: z.ZodArray<z.ZodObject<{
        issue_id: z.ZodString;
        action: z.ZodEnum<{
            accepted: "accepted";
            deferred: "deferred";
            rejected: "rejected";
        }>;
        severity_dispute: z.ZodOptional<z.ZodObject<{
            original: z.ZodEnum<{
                P1: "P1";
                P2: "P2";
                P3: "P3";
            }>;
            revised: z.ZodEnum<{
                P1: "P1";
                P2: "P2";
                P3: "P3";
            }>;
            justification: z.ZodString;
        }, z.core.$strip>>;
        rationale: z.ZodString;
    }, z.core.$strip>>;
    updated_plan: z.ZodString;
}, z.core.$strict>;
export declare const EditsRevisionSchema: z.ZodObject<{
    responses: z.ZodArray<z.ZodObject<{
        issue_id: z.ZodString;
        action: z.ZodEnum<{
            accepted: "accepted";
            deferred: "deferred";
            rejected: "rejected";
        }>;
        severity_dispute: z.ZodOptional<z.ZodObject<{
            original: z.ZodEnum<{
                P1: "P1";
                P2: "P2";
                P3: "P3";
            }>;
            revised: z.ZodEnum<{
                P1: "P1";
                P2: "P2";
                P3: "P3";
            }>;
            justification: z.ZodString;
        }, z.core.$strip>>;
        rationale: z.ZodString;
    }, z.core.$strip>>;
    edits: z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        before: z.ZodString;
        after: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strict>;
export declare const PlannerRevisionSchema: z.ZodObject<{
    responses: z.ZodArray<z.ZodObject<{
        issue_id: z.ZodString;
        action: z.ZodEnum<{
            accepted: "accepted";
            deferred: "deferred";
            rejected: "rejected";
        }>;
        severity_dispute: z.ZodOptional<z.ZodObject<{
            original: z.ZodEnum<{
                P1: "P1";
                P2: "P2";
                P3: "P3";
            }>;
            revised: z.ZodEnum<{
                P1: "P1";
                P2: "P2";
                P3: "P3";
            }>;
            justification: z.ZodString;
        }, z.core.$strip>>;
        rationale: z.ZodString;
    }, z.core.$strip>>;
    updated_plan: z.ZodString;
}, z.core.$strict>;
export type SeverityDispute = z.infer<typeof SeverityDisputeSchema>;
export type IssueResponse = z.infer<typeof IssueResponseSchema>;
export type ReplaceEdit = z.infer<typeof ReplaceEditSchema>;
export type DirectionRevision = z.infer<typeof DirectionRevisionSchema>;
export type EditsRevision = z.infer<typeof EditsRevisionSchema>;
export type PlannerRevision = DirectionRevision | EditsRevision;
export declare function isEditsRevision(r: PlannerRevision): r is EditsRevision;
export declare function isDirectionRevision(r: PlannerRevision): r is DirectionRevision;
