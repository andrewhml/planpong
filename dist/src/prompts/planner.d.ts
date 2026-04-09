import type { ReviewFeedback } from "../schemas/feedback.js";
import type { ReviewPhase } from "./reviewer.js";
export declare function buildInitialPlanPrompt(requirements: string, plansDir: string): string;
export declare function buildRevisionPrompt(currentPlan: string, feedback: ReviewFeedback, keyDecisions: string | null, priorContext: string | null, phase?: ReviewPhase, structuredOutput?: boolean): string;
