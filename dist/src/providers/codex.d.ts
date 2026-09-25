import type { ModelCatalog, ModelInfo, Provider, InvokeOptions, ProviderResponse, ProviderError } from "./types.js";
/**
 * Efforts that work but change behavior enough to warn about. Kept in the
 * catalog so `config set` doesn't call them unknown; excluded from wizard
 * suggestions.
 */
export declare const EFFORT_ADVISORIES: Record<string, string>;
/**
 * Parse `codex debug models` stdout into visible models. Returns an error
 * string instead of throwing so the caller can fall back and say why.
 */
export declare function parseCodexCatalog(stdout: string): {
    ok: true;
    models: ModelInfo[];
} | {
    ok: false;
    reason: string;
};
/**
 * Classify a CLI invocation failure as `capability` (downgrade-eligible) or
 * `fatal` (terminal). Capability errors indicate the CLI doesn't support the
 * requested structured output flag; fatal errors are everything else.
 *
 * Patterns must be narrow — codex's normal session header includes flag
 * names like "output-schema:" in its info output, so substring matches on
 * the flag name alone produce false positives.
 */
export declare function extractCodexThreadId(stdout: string | undefined): string | undefined;
export interface CodexEventError {
    /** Terminal failure reported in the `--json` event stream, if any. */
    message?: string;
    /** Non-fatal diagnostics worth showing (e.g. unknown model metadata). */
    warnings: string[];
}
/**
 * Codex with `--json` reports failures as JSONL events on stdout
 * (`turn.failed`, top-level `error`), not on stderr. Extract the terminal
 * failure, preferring `turn.failed`, plus warnings such as
 * "Model metadata for `x` not found", codex's only hint that a model slug
 * is unknown.
 */
export declare function extractCodexError(stdout: string | undefined): CodexEventError;
/**
 * Recover the final agent message from the event stream. Used only when the
 * `-o` output file is missing or empty.
 */
export declare function extractCodexAgentMessage(stdout: string | undefined): string | undefined;
export type CodexResult = {
    ok: true;
    output: string;
    sessionId?: string;
} | {
    ok: false;
    error: ProviderError;
};
/**
 * Pure interpretation of one `codex exec --json` run. Order matters:
 * 1. A terminal failure in the event stream wins, whatever else exists.
 * 2. The `-o` file, if non-empty, is the output.
 * 3. Else the last `agent_message` event.
 * 4. Else failure. Raw stdout (JSONL events) is never returned as output.
 */
export declare function interpretCodexResult(run: {
    stdout: string | undefined;
    stderr: string | undefined;
    exitCode: number;
    fileContent: string | null;
}): CodexResult;
export declare function classifyError(evidence: string, exitCode: number, overrides?: {
    message?: string;
    stderr?: string;
}): ProviderError;
export declare class CodexProvider implements Provider {
    name: string;
    private capabilityCache;
    private catalogCache;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    checkStructuredOutputSupport(): Promise<boolean>;
    markNonCapable(): void;
    getModels(): string[];
    getModelCatalog(): Promise<ModelCatalog>;
    getEffortLevels(): string[];
}
