import { z } from "zod";
export declare const FeedbackIssueSchema: z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<{
        P1: "P1";
        P2: "P2";
        P3: "P3";
    }>;
    section: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    suggestion: z.ZodString;
    quoted_text: z.ZodOptional<z.ZodString>;
    verified: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
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
    verdict: z.ZodEnum<{
        approved: "approved";
        approved_with_notes: "approved_with_notes";
        blocked: "blocked";
        needs_revision: "needs_revision";
    }>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<{
            P1: "P1";
            P2: "P2";
            P3: "P3";
        }>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
        quoted_text: z.ZodOptional<z.ZodString>;
        verified: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    fallback_used: z.ZodOptional<z.ZodBoolean>;
    missing_phase_fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quote_compliance_warning: z.ZodOptional<z.ZodBoolean>;
    unverified_count: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const AlternativeSchema: z.ZodObject<{
    approach: z.ZodString;
    tradeoff: z.ZodString;
}, z.core.$strip>;
export declare const DirectionFeedbackSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        blocked: "blocked";
        needs_revision: "needs_revision";
    }>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<{
            P1: "P1";
            P2: "P2";
            P3: "P3";
        }>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
        quoted_text: z.ZodOptional<z.ZodString>;
        verified: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    confidence: z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>;
    approach_assessment: z.ZodString;
    alternatives: z.ZodArray<z.ZodObject<{
        approach: z.ZodString;
        tradeoff: z.ZodString;
    }, z.core.$strip>>;
    assumptions: z.ZodArray<z.ZodString>;
    fallback_used: z.ZodOptional<z.ZodBoolean>;
    missing_phase_fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quote_compliance_warning: z.ZodOptional<z.ZodBoolean>;
    unverified_count: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const RiskEntrySchema: z.ZodObject<{
    id: z.ZodString;
    category: z.ZodEnum<{
        assumption: "assumption";
        dependency: "dependency";
        external: "external";
        integration: "integration";
        operational: "operational";
    }>;
    likelihood: z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>;
    impact: z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>;
    title: z.ZodString;
    description: z.ZodString;
    mitigation: z.ZodString;
}, z.core.$strip>;
export declare const RiskFeedbackSchema: z.ZodObject<{
    verdict: z.ZodEnum<{
        blocked: "blocked";
        needs_revision: "needs_revision";
    }>;
    summary: z.ZodString;
    issues: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        severity: z.ZodEnum<{
            P1: "P1";
            P2: "P2";
            P3: "P3";
        }>;
        section: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        suggestion: z.ZodString;
        quoted_text: z.ZodOptional<z.ZodString>;
        verified: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    risk_level: z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
    }>;
    risks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        category: z.ZodEnum<{
            assumption: "assumption";
            dependency: "dependency";
            external: "external";
            integration: "integration";
            operational: "operational";
        }>;
        likelihood: z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
        }>;
        impact: z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
        }>;
        title: z.ZodString;
        description: z.ZodString;
        mitigation: z.ZodString;
    }, z.core.$strip>>;
    fallback_used: z.ZodOptional<z.ZodBoolean>;
    missing_phase_fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quote_compliance_warning: z.ZodOptional<z.ZodBoolean>;
    unverified_count: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type FeedbackIssue = z.infer<typeof FeedbackIssueSchema>;
export type ReviewFeedback = z.infer<typeof ReviewFeedbackSchema>;
export type DirectionFeedback = z.infer<typeof DirectionFeedbackSchema>;
export type RiskFeedback = z.infer<typeof RiskFeedbackSchema>;
export type RiskEntry = z.infer<typeof RiskEntrySchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type PhaseFeedback = DirectionFeedback | RiskFeedback | ReviewFeedback;
