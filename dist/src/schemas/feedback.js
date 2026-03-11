import { z } from "zod";
export const FeedbackIssueSchema = z.object({
    id: z.string(),
    severity: z.enum(["P1", "P2", "P3"]),
    section: z.string(),
    title: z.string(),
    description: z.string(),
    suggestion: z.string(),
});
// Base verdict enum includes `blocked` so fallback parsing can accept it
// from direction/risk phases when phase-specific parsing fails.
export const ReviewFeedbackSchema = z
    .object({
    verdict: z.enum([
        "needs_revision",
        "approved",
        "approved_with_notes",
        "blocked",
    ]),
    summary: z.string(),
    issues: z.array(FeedbackIssueSchema),
    // Fallback observability — set by parseFeedbackForPhase when fallback is used
    fallback_used: z.boolean().optional(),
    missing_phase_fields: z.array(z.string()).optional(),
})
    .refine((data) => {
    if (data.verdict === "approved_with_notes") {
        return data.issues.every((issue) => issue.severity === "P3");
    }
    return true;
}, {
    message: "approved_with_notes is only valid when all issues are P3. Either downgrade issues to P3 or change verdict to needs_revision.",
});
// --- Direction phase schema ---
export const AlternativeSchema = z.object({
    approach: z.string(),
    tradeoff: z.string(),
});
export const DirectionFeedbackSchema = z.object({
    verdict: z.enum(["needs_revision", "blocked"]),
    summary: z.string(),
    issues: z.array(FeedbackIssueSchema),
    confidence: z.enum(["high", "medium", "low"]),
    approach_assessment: z.string(),
    alternatives: z.array(AlternativeSchema),
    assumptions: z.array(z.string()),
    fallback_used: z.boolean().optional(),
    missing_phase_fields: z.array(z.string()).optional(),
});
// --- Risk phase schema ---
export const RiskEntrySchema = z.object({
    id: z.string(),
    category: z.enum([
        "dependency",
        "integration",
        "operational",
        "assumption",
        "external",
    ]),
    likelihood: z.enum(["high", "medium", "low"]),
    impact: z.enum(["high", "medium", "low"]),
    title: z.string(),
    description: z.string(),
    mitigation: z.string(),
});
export const RiskFeedbackSchema = z.object({
    verdict: z.enum(["needs_revision", "blocked"]),
    summary: z.string(),
    issues: z.array(FeedbackIssueSchema),
    risk_level: z.enum(["high", "medium", "low"]),
    risks: z.array(RiskEntrySchema),
    fallback_used: z.boolean().optional(),
    missing_phase_fields: z.array(z.string()).optional(),
});
//# sourceMappingURL=feedback.js.map