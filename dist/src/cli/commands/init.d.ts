import type { Command } from "commander";
import { type BatchPick } from "../../config/mutate.js";
import type { ModelCatalog } from "../../providers/types.js";
/**
 * Wizard answer meaning "don't pin this; let the provider CLI decide". A
 * symbol, never a string, so it can't collide with a model name or be
 * written to disk.
 */
export declare const CLI_DEFAULT: unique symbol;
export type WizardChoice = string | typeof CLI_DEFAULT;
export interface WizardAnswers {
    plannerProvider: string;
    plannerModel: WizardChoice;
    plannerEffort?: WizardChoice;
    reviewerProvider: string;
    reviewerModel: WizardChoice;
    reviewerEffort?: WizardChoice;
    maxRounds: number;
    plansDir: string;
    plannerMode: "inline" | "external";
    revisionMode: "full" | "edits";
    humanInLoop: boolean;
}
export interface DiskSnapshot {
    planner?: {
        provider?: string;
        model?: string;
        effort?: string;
    };
    reviewer?: {
        provider?: string;
        model?: string;
        effort?: string;
    };
    max_rounds?: number;
    plans_dir?: string;
    planner_mode?: "inline" | "external";
    revision_mode?: "full" | "edits";
    human_in_loop?: boolean;
}
/**
 * Map an effort level to a human-readable label for the wizard.
 * Falls through to the raw value for unknown levels (future-proofing
 * against new effort tiers).
 */
export declare function effortLabel(level: string): string;
interface Choice {
    name: string;
    value: WizardChoice;
}
/**
 * Model choices for one role. The old model is offered only when the
 * provider is unchanged: a pinned model outside the catalog stays
 * selectable (and preselected) so re-running the wizard never silently
 * drops a pin, while switching provider never carries a model across.
 */
export declare function buildModelChoices(providerName: string, catalog: ModelCatalog, providerChanged: boolean, diskModel: string | undefined): {
    choices: Choice[];
    default: WizardChoice;
};
/**
 * Effort choices for one role, or null when the provider has no effort
 * levels. With a pinned catalog model, offer that model's levels; with CLI
 * default, only levels every model accepts (the intersection); with an
 * unknown pinned model, the union. Advisory levels (codex `ultra`) are not
 * suggested, except a current pin that is kept visible.
 */
export declare function buildEffortChoices(catalog: ModelCatalog, model: WizardChoice, providerChanged: boolean, diskEffort: string | undefined): {
    choices: Choice[];
    default: WizardChoice;
    hint?: string;
} | null;
/**
 * Read the config file the writer will modify into a partial snapshot.
 * Resolves with findConfigPath (walks parent directories), the same lookup
 * setConfigValuesBatch uses, so the wizard's view and its write target are
 * the same file. Unlike loadConfig(), this does NOT merge defaults: fields
 * the user never wrote remain undefined so the wizard can omit them.
 */
export declare function readDiskSnapshot(cwd: string): {
    path: string | null;
    snapshot: DiskSnapshot;
};
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
export {};
