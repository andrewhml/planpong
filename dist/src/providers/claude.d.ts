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
export declare function classifyError(stderr: string, exitCode: number): ProviderError;
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
