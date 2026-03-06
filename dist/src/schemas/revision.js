import { z } from "zod";
export const SeverityDisputeSchema = z.object({
    original: z.enum(["P1", "P2", "P3"]),
    revised: z.enum(["P1", "P2", "P3"]),
    justification: z.string(),
});
export const IssueResponseSchema = z.object({
    issue_id: z.string(),
    action: z.enum(["accepted", "rejected", "deferred"]),
    severity_dispute: SeverityDisputeSchema.optional(),
    rationale: z.string(),
});
export const PlannerRevisionSchema = z.object({
    responses: z.array(IssueResponseSchema),
    updated_plan: z.string(),
});
//# sourceMappingURL=revision.js.map