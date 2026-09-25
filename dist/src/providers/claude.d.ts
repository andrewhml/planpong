import type { Provider, InvokeOptions, ProviderResponse, ProviderError } from "./types.js";
/**
 * Parse claude's `--output-format json` envelope and extract the
 * `structured_output` field as a JSON string ready for downstream parsing.
 * Returns null if the envelope is malformed or the field is missing.
 *
 * Envelope shape (subset):
 * {
 *   "type": "result",
 *   "is_error": false,
 *   "result": "",
 *   "structured_output": { ...model's constrained JSON... },
 *   ...
 * }
 */
export declare function extractStructuredOutput(stdout: string): string | null;
/**
 * Classify a CLI invocation failure as `capability` (downgrade-eligible) or
 * `fatal` (terminal). Capability errors indicate the CLI doesn't support the
 * requested structured output flag; fatal errors are everything else.
 */
/**
 * If stdout is an error envelope, return its evidence text. Claude reports
 * API failures (unknown model, auth, rate limit) as `is_error: true`, often
 * with `subtype: "success"`, so both fields are checked.
 */
export declare function extractEnvelopeError(stdout: string): string | null;
export type ClaudeResult = {
    ok: true;
    output: string;
} | {
    ok: false;
    error: ProviderError;
};
/**
 * Pure interpretation of one structured-output (`--output-format json`)
 * run. An error envelope is classified from its own text; only a
 * successful envelope that lacks `structured_output` is a capability
 * failure.
 */
export declare function interpretStructuredResult(run: {
    stdout: string;
    stderr: string | undefined;
    exitCode: number;
}): ClaudeResult;
export declare function classifyError(evidence: string, exitCode: number, overrides?: {
    message?: string;
    stderr?: string;
}): ProviderError;
export declare class ClaudeProvider implements Provider {
    name: string;
    private capabilityCache;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    checkStructuredOutputSupport(): Promise<boolean>;
    markNonCapable(): void;
    getModels(): string[];
    getEffortLevels(): string[];
}
