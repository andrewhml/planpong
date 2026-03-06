import { z } from "zod";
export const FeedbackIssueSchema = z.object({
    id: z.string(),
    severity: z.enum(["P1", "P2", "P3"]),
    section: z.string(),
    title: z.string(),
    description: z.string(),
    suggestion: z.string(),
});
export const ReviewFeedbackSchema = z
    .object({
    verdict: z.enum(["needs_revision", "approved", "approved_with_notes"]),
    summary: z.string(),
    issues: z.array(FeedbackIssueSchema),
})
    .refine((data) => {
    if (data.verdict === "approved_with_notes") {
        return data.issues.every((issue) => issue.severity === "P3");
    }
    return true;
}, {
    message: "approved_with_notes is only valid when all issues are P3. Either downgrade issues to P3 or change verdict to needs_revision.",
});
//# sourceMappingURL=feedback.js.map