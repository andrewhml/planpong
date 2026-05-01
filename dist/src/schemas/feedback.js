import { z } from "zod";
export const FeedbackIssueSchema = z.object({
    id: z.string(),
    severity: z.enum(["P1", "P2", "P3"]),
    section: z.string(),
    title: z.string(),
    description: z.string(),
    suggestion: z.string(),
    // A verbatim ≤200-char snippet from the plan that the issue refers to.
    // Optional during phased rollout — issues without it are tagged
    // `verified: false` rather than rejected. No length constraint at the
    // Zod level: ZodValidationError is terminal in this system, so length
    // enforcement happens in src/core/verify-evidence.ts which marks
    // non-compliant quotes as unverified instead of throwing.
    quoted_text: z.string().optional(),
    // Set by planpong post-parse via the verifier. Always stripped from
    // model output before verification — the verifier is the sole authority.
    verified: z.boolean().optional(),
});
/**
 * Base feedback schema for the detail phase. Includes the `blocked` verdict
 * so fallback parsing can accept it from direction/risk phases when
 * phase-specific parsing fails.
 *
 * **Production callers must NOT use `.parse()` / `.safeParse()` directly.**
 * Always route through `parseFeedback` or `parseStructuredFeedbackForPhase`
 * in `src/core/convergence.ts`. Those functions apply post-parse semantic
 * coercions (e.g., `approved_with_notes` with non-P3 issues is downgraded
 * to `needs_revision` rather than throwing). Calling the schema directly
 * silently bypasses these coercions and reintroduces the terminal-Zod-error
 * failure mode that the parser-side coercion is specifically there to avoid.
 */
export const ReviewFeedbackSchema = z.object({
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
    // Evidence-verification observability — populated post-parse by the
    // verifier in verify-evidence.ts. `quote_compliance_warning` flips true
    // when >50% of issues lack `quoted_text`. `unverified_count` is the
    // total number of issues with `verified: false` after verification.
    quote_compliance_warning: z.boolean().optional(),
    unverified_count: z.number().int().nonnegative().optional(),
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
    quote_compliance_warning: z.boolean().optional(),
    unverified_count: z.number().int().nonnegative().optional(),
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
    quote_compliance_warning: z.boolean().optional(),
    unverified_count: z.number().int().nonnegative().optional(),
});
//# sourceMappingURL=feedback.js.map