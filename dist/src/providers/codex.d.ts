import type { Provider, InvokeOptions, ProviderResponse, ProviderError } from "./types.js";
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
export declare function classifyError(stderr: string, exitCode: number): ProviderError;
export declare class CodexProvider implements Provider {
    name: string;
    private capabilityCache;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    checkStructuredOutputSupport(): Promise<boolean>;
    markNonCapable(): void;
    getModels(): string[];
    getEffortLevels(): string[];
}
