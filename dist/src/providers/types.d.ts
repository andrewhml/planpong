export interface InvokeOptions {
    cwd: string;
    model?: string;
    effort?: string;
    timeout?: number;
}
export interface ProviderResponse {
    content: string;
    exitCode: number;
    duration: number;
}
export interface Provider {
    name: string;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    getModels(): string[];
    getEffortLevels(): string[];
}
