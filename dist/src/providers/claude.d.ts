import type { Provider, InvokeOptions, ProviderResponse } from "./types.js";
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
