export interface InvokeOptions {
    cwd: string;
    model?: string;
    effort?: string;
    timeout?: number;
    /**
     * JSON Schema to constrain model output. When set, providers pass this to
     * their respective structured-output flags (`--json-schema` for claude,
     * `--output-schema` for codex).
     */
    jsonSchema?: Record<string, unknown>;
    /**
     * Initialize a NEW persistent conversation with this UUID. Mutually
     * exclusive with `resumeSessionId`. After the first call succeeds, the
     * caller must use `resumeSessionId` on subsequent calls.
     */
    newSessionId?: string;
    /**
     * Resume an EXISTING persistent conversation. The model retains context
     * from prior turns. Only valid for sessions previously created with
     * `newSessionId`.
     */
    resumeSessionId?: string;
}
/**
 * Provider invocation error categories. Used by the operations-layer state
 * machine to decide whether to downgrade or fail terminally.
 *
 * - `capability`: schema rejected, flag unrecognized at runtime, structured
 *   output format error. Indicates the CLI doesn't support the requested
 *   structured output mode. Downgrade-eligible.
 * - `fatal`: auth failure, timeout, network/transport error, non-zero exit
 *   with no output. Unrelated to structured output capability. Terminal.
 */
export type ProviderErrorKind = "capability" | "fatal";
export interface ProviderError {
    kind: ProviderErrorKind;
    message: string;
    exitCode: number;
    stderr?: string;
}
/**
 * Discriminated result of a single provider invocation. Providers are
 * single-shot — they perform one invocation and return either the output
 * or a typed error. They do NOT retry or downgrade internally; that is
 * the operations-layer state machine's job.
 *
 * `sessionId` (success only): the canonical conversation ID the provider
 * used. For providers that accept an externally-generated UUID (claude),
 * this echoes the input; for providers that generate their own IDs
 * (codex), this is parsed from the provider's output. Caller persists
 * this and passes it as `resumeSessionId` on subsequent calls to keep
 * the same conversation thread.
 */
export type ProviderResponse = {
    ok: true;
    output: string;
    duration: number;
    sessionId?: string;
} | {
    ok: false;
    error: ProviderError;
    duration: number;
};
export interface ModelInfo {
    id: string;
    /** Effort levels this model accepts. Empty when the provider has none. */
    efforts: string[];
    defaultEffort?: string;
}
/**
 * Models and effort levels a provider can use, for suggestions and soft
 * validation only. Never consulted on the review path: planpong passes any
 * model string through to the CLI.
 */
export interface ModelCatalog {
    /** `live` when read from the CLI at runtime, `static` for built-in lists. */
    source: "live" | "static";
    models: ModelInfo[];
    /**
     * Levels every listed model accepts (intersection). Safe to offer when no
     * model is pinned, since the CLI may resolve any of them as its default.
     */
    efforts: string[];
    /** Levels at least one model accepts (union). Used to avoid false "unknown" warnings. */
    allEfforts: string[];
    /** Effort levels that work but deserve a warning, e.g. codex `ultra`. */
    advisories: Record<string, string>;
    /** Set when discovery fell back to the built-in list, with the reason. */
    note?: string;
}
export interface Provider {
    name: string;
    invoke(prompt: string, options: InvokeOptions): Promise<ProviderResponse>;
    isAvailable(): Promise<boolean>;
    /** Static fallback list. CLI surfaces use `getModelCatalog()` instead. */
    getModels(): string[];
    /** Static fallback list. CLI surfaces use `getModelCatalog()` instead. */
    getEffortLevels(): string[];
    /**
     * Models and efforts for suggestions and soft validation. Live where the
     * CLI exposes a catalog, else built from the static lists. Never throws;
     * cached per provider instance.
     */
    getModelCatalog(): Promise<ModelCatalog>;
    /**
     * Probe the underlying CLI to determine whether structured output is
     * supported. Result is cached for the session lifetime. If the probe
     * fails or times out, returns false (use prompted path).
     */
    checkStructuredOutputSupport(): Promise<boolean>;
    /**
     * Mark this provider as non-capable for the remainder of the session.
     * Called by the state machine after a runtime structured-output failure
     * (capability error or JSON.parse failure) to prevent re-attempting
     * structured output on subsequent rounds.
     */
    markNonCapable(): void;
}
