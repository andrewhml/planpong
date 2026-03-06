import type { ReviewFeedback } from "../schemas/feedback.js";
export declare function buildInitialPlanPrompt(requirements: string, plansDir: string): string;
export declare function buildRevisionPrompt(currentPlan: string, feedback: ReviewFeedback, keyDecisions: string | null, priorContext: string | null): string;
