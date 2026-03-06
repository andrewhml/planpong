import type { Provider, InvokeOptions, ProviderResponse } from "./types.js";
export declare class ClaudeProvider implements Provider {
    name: string;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    getModels(): string[];
    getEffortLevels(): string[];
}
