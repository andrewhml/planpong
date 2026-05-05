import type { Provider, InvokeOptions, ProviderResponse, ProviderError } from "./types.js";
/**
 * Build argv for `gemini -p`. Pure function — no I/O.
 *
 * The `gemini` CLI's `-p/--prompt` flag requires a string value (the help text
 * is misleading on this point). Per the CLI source, stdin content is appended
 * to the `-p` argument, so passing `-p ""` plus a stdin pipe works the same as
 * codex's `exec -` pattern: the model sees only the stdin content.
 *
 * Session resumption is not supported in v1 — `gemini --resume` accepts
 * indices and `latest`, not UUIDs, so `newSessionId`/`resumeSessionId` are
 * silently ignored. See the design doc at docs/plans/gemini-and-init-wizard.md
 * (Future Work item #2) for the deferred follow-up.
 */
export declare function buildArgs(options: InvokeOptions): string[];
export type ExtractResult = {
    ok: true;
    text: string;
} | {
    ok: false;
    message: string;
    code?: number;
};
/**
 * Parse gemini's `--output-format json` envelope. Pure function.
 *
 * Envelope shape (verified against @google/gemini-cli@0.32 src/output/json-formatter.ts):
 *   success: { session_id, response, stats }
 *   error:   { session_id, error: { type, message, code } }
 */
export declare function extractResponse(stdout: string): ExtractResult;
/**
 * Classify a gemini invocation failure. v1 always returns `fatal` — gemini
 * doesn't accept any structured-output flags so there is no capability axis
 * to downgrade along.
 */
export declare function classifyError(stderr: string, exitCode: number): ProviderError;
export declare class GeminiProvider implements Provider {
    name: string;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    /**
     * Always returns false in v1. Gemini's CLI does not expose a `--json-schema`
     * or `--output-schema` flag, so structured-output mode is unavailable. See
     * Future Work item #1 in docs/plans/gemini-and-init-wizard.md.
     */
    checkStructuredOutputSupport(): Promise<boolean>;
    markNonCapable(): void;
    getModels(): string[];
    getEffortLevels(): string[];
}
