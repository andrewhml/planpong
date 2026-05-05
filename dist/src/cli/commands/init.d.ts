import type { Command } from "commander";
import { type BatchPick } from "../../config/mutate.js";
export interface WizardAnswers {
    plannerProvider: string;
    plannerModel: string;
    reviewerProvider: string;
    reviewerModel: string;
    maxRounds: number;
    plansDir: string;
    plannerMode: "inline" | "external";
}
export interface DiskSnapshot {
    planner?: {
        provider?: string;
        model?: string;
    };
    reviewer?: {
        provider?: string;
        model?: string;
    };
    max_rounds?: number;
    plans_dir?: string;
    planner_mode?: "inline" | "external";
}
/**
 * Read planpong.yaml directly into a partial snapshot. Unlike loadConfig(),
 * this does NOT merge defaults — fields the user never wrote remain
 * undefined so the wizard can omit them from the batch write.
 */
export declare function readDiskSnapshot(cwd: string): DiskSnapshot;
/**
 * Pure formatter for the post-write summary. The auth reminder appears
 * whenever gemini is picked for any role; it is intentionally a static
 * message rather than a probe of auth state.
 */
export declare function formatPostWriteSummary(answers: WizardAnswers): string;
/**
 * Convert the wizard's answer object plus the on-disk-file snapshot into
 * the batch picks list. Omits keys whose answer matches the on-disk value
 * so the wizard never writes a default into an existing yaml the user
 * didn't touch. Output order is stable to keep diff output predictable.
 */
export declare function answersToPicks(answers: WizardAnswers, disk: DiskSnapshot): BatchPick[];
/**
 * Detect whether stdin is a real TTY. Node sets `isTTY` to `true` for a TTY
 * and leaves it `undefined` (NOT `false`) for pipes/redirects, so a strict
 * `=== false` check would silently let the wizard fall through to inquirer
 * and hang on the first prompt.
 */
export declare function isInteractiveTty(stdin: {
    isTTY?: boolean;
}): boolean;
export declare function registerInitCommand(program: Command): void;
