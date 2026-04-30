import type { ReviewFeedback } from "../schemas/feedback.js";
import type { ReviewPhase } from "./reviewer.js";
export declare function buildInitialPlanPrompt(requirements: string, plansDir: string): string;
export declare function buildRevisionPrompt(currentPlan: string, feedback: ReviewFeedback, keyDecisions: string | null, priorContext: string | null, phase?: ReviewPhase, structuredOutput?: boolean, revisionMode?: "edits" | "full"): string;
/**
 * Build a minimal revision prompt for resumed planner sessions.
 *
 * The planner is already in a persistent CLI conversation that has the
 * plan, the prior reviewer feedback, and the planner's own prior rationales
 * in context. We do NOT re-send "Current Plan", "Prior Decisions", or
 * "Key Decisions" — the model has all of that. Only the new feedback +
 * minimal phase reminder + output schema instructions.
 *
 * The output schema and surgical constraints stay because they're per-call
 * directives, not stable context. (We don't trust that the model won't
 * drift in format across many turns of a long session.)
 */
export declare function buildIncrementalRevisionPrompt(feedback: ReviewFeedback, phase: ReviewPhase, structuredOutput: boolean, revisionMode?: "edits" | "full"): string;
/**
 * Build a targeted retry prompt for failed edits in edits-mode revisions.
 * Given the partially-edited plan and the list of edits that failed first
 * pass, asks the planner to re-express each failed edit with corrected
 * `section` and `before` values.
 *
 * The retry prompt is small — it does not re-include the full feedback or
 * key decisions, only the failed edits and the current state of the plan.
 */
export declare function buildEditsRetryPrompt(currentPlan: string, failures: Array<{
    edit: {
        section: string;
        before: string;
        after: string;
    };
    reason: string;
    section_searched: string | null;
    diagnostic?: string;
}>, structuredOutput: boolean): string;
