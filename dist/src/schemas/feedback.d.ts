import { z } from "zod";
export declare const FeedbackIssueSchema: z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<["P1", "P2", "P3"]>;
    section: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    suggestion: z.ZodString;
    quoted_text: z.ZodOptional<z.ZodString>;
    verified: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: string;
    severity: "P1" | "P2" | "P3";
    section: string;
    title: string;
    description: string;
    suggestion: string;
    quoted_text?: string | undefined;
    verified?: boolean | undefined;
}, {
    id: string;
    severity: "P1" | "P2" | "P3";
    section: string;
    title: string;
    description: string;
    suggestion: string;
    quoted_text?: string | undefined;
    verified?: boolean | undefined;
}>;
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
export declare const ReviewFeedbackSchema: z.ZodObject<{
    verdict: z.ZodEnum<["needs_revision", "approved", "approved_with_notes", "blocked"]>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["P1", "P2", "P3"]>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
        quoted_text: z.ZodOptional<z.ZodString>;
        verified: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }>, "many">;
    fallback_used: z.ZodOptional<z.ZodBoolean>;
    missing_phase_fields: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    quote_compliance_warning: z.ZodOptional<z.ZodBoolean>;
    unverified_count: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }[];
    verdict: "needs_revision" | "approved" | "approved_with_notes" | "blocked";
    summary: string;
    fallback_used?: boolean | undefined;
    missing_phase_fields?: string[] | undefined;
    quote_compliance_warning?: boolean | undefined;
    unverified_count?: number | undefined;
}, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }[];
    verdict: "needs_revision" | "approved" | "approved_with_notes" | "blocked";
    summary: string;
    fallback_used?: boolean | undefined;
    missing_phase_fields?: string[] | undefined;
    quote_compliance_warning?: boolean | undefined;
    unverified_count?: number | undefined;
}>;
export declare const AlternativeSchema: z.ZodObject<{
    approach: z.ZodString;
    tradeoff: z.ZodString;
}, "strip", z.ZodTypeAny, {
    approach: string;
    tradeoff: string;
}, {
    approach: string;
    tradeoff: string;
}>;
export declare const DirectionFeedbackSchema: z.ZodObject<{
    verdict: z.ZodEnum<["needs_revision", "blocked"]>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["P1", "P2", "P3"]>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
        quoted_text: z.ZodOptional<z.ZodString>;
        verified: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }>, "many">;
    confidence: z.ZodEnum<["high", "medium", "low"]>;
    approach_assessment: z.ZodString;
    alternatives: z.ZodArray<z.ZodObject<{
        approach: z.ZodString;
        tradeoff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        approach: string;
        tradeoff: string;
    }, {
        approach: string;
        tradeoff: string;
    }>, "many">;
    assumptions: z.ZodArray<z.ZodString, "many">;
    fallback_used: z.ZodOptional<z.ZodBoolean>;
    missing_phase_fields: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    quote_compliance_warning: z.ZodOptional<z.ZodBoolean>;
    unverified_count: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }[];
    verdict: "needs_revision" | "blocked";
    summary: string;
    confidence: "high" | "medium" | "low";
    approach_assessment: string;
    alternatives: {
        approach: string;
        tradeoff: string;
    }[];
    assumptions: string[];
    fallback_used?: boolean | undefined;
    missing_phase_fields?: string[] | undefined;
    quote_compliance_warning?: boolean | undefined;
    unverified_count?: number | undefined;
}, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }[];
    verdict: "needs_revision" | "blocked";
    summary: string;
    confidence: "high" | "medium" | "low";
    approach_assessment: string;
    alternatives: {
        approach: string;
        tradeoff: string;
    }[];
    assumptions: string[];
    fallback_used?: boolean | undefined;
    missing_phase_fields?: string[] | undefined;
    quote_compliance_warning?: boolean | undefined;
    unverified_count?: number | undefined;
}>;
export declare const RiskEntrySchema: z.ZodObject<{
    id: z.ZodString;
    category: z.ZodEnum<["dependency", "integration", "operational", "assumption", "external"]>;
    likelihood: z.ZodEnum<["high", "medium", "low"]>;
    impact: z.ZodEnum<["high", "medium", "low"]>;
    title: z.ZodString;
    description: z.ZodString;
    mitigation: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    title: string;
    description: string;
    category: "dependency" | "integration" | "operational" | "assumption" | "external";
    likelihood: "high" | "medium" | "low";
    impact: "high" | "medium" | "low";
    mitigation: string;
}, {
    id: string;
    title: string;
    description: string;
    category: "dependency" | "integration" | "operational" | "assumption" | "external";
    likelihood: "high" | "medium" | "low";
    impact: "high" | "medium" | "low";
    mitigation: string;
}>;
export declare const RiskFeedbackSchema: z.ZodObject<{
    verdict: z.ZodEnum<["needs_revision", "blocked"]>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<["P1", "P2", "P3"]>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
        quoted_text: z.ZodOptional<z.ZodString>;
        verified: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }, {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }>, "many">;
    risk_level: z.ZodEnum<["high", "medium", "low"]>;
    risks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        category: z.ZodEnum<["dependency", "integration", "operational", "assumption", "external"]>;
        likelihood: z.ZodEnum<["high", "medium", "low"]>;
        impact: z.ZodEnum<["high", "medium", "low"]>;
        title: z.ZodString;
        description: z.ZodString;
        mitigation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        title: string;
        description: string;
        category: "dependency" | "integration" | "operational" | "assumption" | "external";
        likelihood: "high" | "medium" | "low";
        impact: "high" | "medium" | "low";
        mitigation: string;
    }, {
        id: string;
        title: string;
        description: string;
        category: "dependency" | "integration" | "operational" | "assumption" | "external";
        likelihood: "high" | "medium" | "low";
        impact: "high" | "medium" | "low";
        mitigation: string;
    }>, "many">;
    fallback_used: z.ZodOptional<z.ZodBoolean>;
    missing_phase_fields: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    quote_compliance_warning: z.ZodOptional<z.ZodBoolean>;
    unverified_count: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }[];
    verdict: "needs_revision" | "blocked";
    summary: string;
    risk_level: "high" | "medium" | "low";
    risks: {
        id: string;
        title: string;
        description: string;
        category: "dependency" | "integration" | "operational" | "assumption" | "external";
        likelihood: "high" | "medium" | "low";
        impact: "high" | "medium" | "low";
        mitigation: string;
    }[];
    fallback_used?: boolean | undefined;
    missing_phase_fields?: string[] | undefined;
    quote_compliance_warning?: boolean | undefined;
    unverified_count?: number | undefined;
}, {
    issues: {
        id: string;
        severity: "P1" | "P2" | "P3";
        section: string;
        title: string;
        description: string;
        suggestion: string;
        quoted_text?: string | undefined;
        verified?: boolean | undefined;
    }[];
    verdict: "needs_revision" | "blocked";
    summary: string;
    risk_level: "high" | "medium" | "low";
    risks: {
        id: string;
        title: string;
        description: string;
        category: "dependency" | "integration" | "operational" | "assumption" | "external";
        likelihood: "high" | "medium" | "low";
        impact: "high" | "medium" | "low";
        mitigation: string;
    }[];
    fallback_used?: boolean | undefined;
    missing_phase_fields?: string[] | undefined;
    quote_compliance_warning?: boolean | undefined;
    unverified_count?: number | undefined;
}>;
export type FeedbackIssue = z.infer<typeof FeedbackIssueSchema>;
export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>;
export type DirectionFeedback = z.infer<typeof DirectionFeedbackSchema>;
export type RiskFeedback = z.infer<typeof RiskFeedbackSchema>;
export type RiskEntry = z.infer<typeof RiskEntrySchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type PhaseFeedback = DirectionFeedback | RiskFeedback | ReviewFeedback;
