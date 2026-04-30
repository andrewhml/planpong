/** Quotes shorter than this are not distinctive enough to anchor on. */
export const MIN_QUOTE_LENGTH = 10;
/** Quotes longer than this are quote-stuffing — discourage. */
export const MAX_QUOTE_LENGTH = 200;
/** When >50% of issues lack `quoted_text`, flag compliance warning. */
export const COMPLIANCE_WARNING_THRESHOLD = 0.5;
/** Collapse runs of whitespace (including newlines) to a single space. */
function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
}
/**
 * Verify a single issue's `quoted_text` against the plan.
 *
 * Returns `{ verified: false }` for any of:
 * - Missing or empty `quoted_text`
 * - Quote shorter than `MIN_QUOTE_LENGTH` chars (after trimming)
 * - Quote longer than `MAX_QUOTE_LENGTH` chars (after trimming)
 * - Quote not found in the plan after whitespace normalization
 * - Any unexpected exception during normalization (caller can detect via
 *   the verifier-level exception counter)
 */
export function verifyIssue(issue, planText) {
    const quote = issue.quoted_text;
    if (!quote)
        return { verified: false };
    const trimmed = quote.trim();
    if (trimmed.length === 0)
        return { verified: false };
    if (trimmed.length < MIN_QUOTE_LENGTH) {
        process.stderr.write(`[planpong] warn: issue ${issue.id} quoted_text below distinctiveness floor (${trimmed.length} < ${MIN_QUOTE_LENGTH}) — marked unverified\n`);
        return { verified: false };
    }
    if (trimmed.length > MAX_QUOTE_LENGTH) {
        process.stderr.write(`[planpong] warn: issue ${issue.id} quoted_text exceeds length cap (${trimmed.length} > ${MAX_QUOTE_LENGTH}) — marked unverified\n`);
        return { verified: false };
    }
    try {
        const normalizedQuote = normalize(quote);
        const normalizedPlan = normalize(planText);
        return { verified: normalizedPlan.includes(normalizedQuote) };
    }
    catch {
        // Re-thrown by the caller path so the exception counter fires; the
        // top-level verifyFeedback wraps this in another try/catch and only
        // ever returns `verified: false`.
        throw new Error(`normalize failed on issue ${issue.id}`);
    }
}
/**
 * Verify all issues on a feedback object, populating `verified` per issue
 * and `quote_compliance_warning` + `unverified_count` at the top level.
 *
 * Returns a NEW feedback object — does not mutate the input. The exception
 * count is for telemetry (see Risks & Mitigations R3 in the plan).
 *
 * Note: callers must strip any model-supplied `verified` from issues BEFORE
 * calling this function. This verifier is the sole authority on that field.
 */
export function verifyFeedback(feedback, planText) {
    let exceptionCount = 0;
    let missingQuoteCount = 0;
    const verifiedIssues = feedback.issues.map((issue) => {
        if (!issue.quoted_text)
            missingQuoteCount += 1;
        let verified = false;
        try {
            verified = verifyIssue(issue, planText).verified;
        }
        catch (err) {
            exceptionCount += 1;
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[planpong] warn: verifier exception on issue ${issue.id}: ${msg}\n`);
            verified = false;
        }
        return { ...issue, verified };
    });
    const total = verifiedIssues.length;
    const unverifiedCount = verifiedIssues.filter((i) => i.verified === false).length;
    const complianceRatio = total === 0 ? 0 : missingQuoteCount / total;
    const complianceWarning = complianceRatio > COMPLIANCE_WARNING_THRESHOLD;
    if (missingQuoteCount > 0) {
        process.stderr.write(`[planpong] warn: ${missingQuoteCount}/${total} issues missing quoted_text — marked unverified\n`);
    }
    // Spread preserves the discriminating phase-specific fields (confidence /
    // risk_level / etc.) from the original feedback object — without
    // narrowing the union, TypeScript would reject reassignment.
    const annotated = {
        ...feedback,
        issues: verifiedIssues,
        unverified_count: unverifiedCount,
        quote_compliance_warning: complianceWarning,
    };
    return { feedback: annotated, exceptionCount };
}
/**
 * Strip model-supplied `verified` from every issue. Called before
 * `verifyFeedback` so the model cannot self-assert verification status.
 *
 * Mutates and returns the same array element-wise (cheap; the caller has
 * just constructed these objects from a parse step).
 */
export function stripModelVerified(issues) {
    for (const issue of issues) {
        if ("verified" in issue) {
            delete issue.verified;
        }
    }
    return issues;
}
//# sourceMappingURL=verify-evidence.js.map