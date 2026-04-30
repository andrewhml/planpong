import type { ReplaceEdit } from "../schemas/revision.js";
export type EditFailureReason = "no-match" | "multi-match" | "section-not-found" | "status-line";
export interface EditResult {
    edit: ReplaceEdit;
    match_offset: number;
}
export interface EditFailure {
    edit: ReplaceEdit;
    reason: EditFailureReason;
    section_searched: string | null;
    diagnostic?: string;
}
export interface ApplyEditsResult {
    plan: string;
    applied: EditResult[];
    failures: EditFailure[];
}
/**
 * Apply a list of section-scoped text-replacement edits to a markdown plan.
 *
 * Edits are processed sequentially against the running plan — later edits
 * see earlier edits' results. Each edit must locate its section heading and
 * its `before` string must appear exactly once within that section's
 * content. Failures are recorded but do NOT abort the run; surviving edits
 * are applied. The caller decides whether to retry the failed edits.
 *
 * Pure: no filesystem access, no logging side-effects. The caller surfaces
 * diagnostics via stderr or telemetry.
 */
export declare function applyEdits(plan: string, edits: ReplaceEdit[]): ApplyEditsResult;
/**
 * Build a stderr-friendly summary of edit application. Used by callers that
 * want a one-line log per round.
 */
export declare function summarizeApply(result: ApplyEditsResult): string;
/**
 * Emit per-failure stderr diagnostics. Caller invokes this once after first-
 * pass and once after retry pass.
 */
export declare function logFailures(prefix: string, failures: EditFailure[]): void;
