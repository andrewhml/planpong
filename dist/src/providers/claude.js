import { execa } from "execa";
const MODELS = ["opus", "sonnet", "haiku"];
/**
 * Build a clean env object with CLAUDECODE removed.
 * This allows spawning headless `claude -p` from inside a Claude Code session.
 */
function cleanEnv() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (key !== "CLAUDECODE" && value !== undefined) {
            env[key] = value;
        }
    }
    return env;
}
/**
 * Classify a CLI invocation failure as `capability` (downgrade-eligible) or
 * `fatal` (terminal). Capability errors indicate the CLI doesn't support the
 * requested structured output flag; fatal errors are everything else.
 */
function classifyError(stderr, exitCode) {
    const lower = stderr.toLowerCase();
    const capabilityIndicators = [
        "unknown flag",
        "unknown option",
        "unrecognized",
        "invalid schema",
        "invalid json schema",
        "json-schema",
        "unsupported",
    ];
    const isCapability = capabilityIndicators.some((indicator) => lower.includes(indicator));
    return {
        kind: isCapability ? "capability" : "fatal",
        message: stderr.slice(0, 500) || `claude exited with code ${exitCode}`,
        exitCode,
        stderr,
    };
}
export class ClaudeProvider {
    name = "claude";
    capabilityCache = null;
    async invoke(prompt, options) {
        // claude -p reads prompt from stdin when no positional arg is given
        // --bare skips hooks, MCP servers, auto-memory, CLAUDE.md discovery,
        // and plugin sync — recommended for subprocess/SDK calls.
        const args = ["-p", "--bare"];
        if (options.jsonSchema) {
            args.push("--output-format", "json", "--json-schema", JSON.stringify(options.jsonSchema));
        }
        else {
            args.push("--output-format", "text");
        }
        if (options.model) {
            args.push("--model", options.model);
        }
        const start = Date.now();
        try {
            const result = await execa("claude", args, {
                cwd: options.cwd,
                preferLocal: true,
                timeout: options.timeout ?? 300_000,
                reject: false,
                env: cleanEnv(),
                extendEnv: false,
                input: prompt,
            });
            const duration = Date.now() - start;
            const exitCode = result.exitCode ?? 1;
            // claude -p can exit non-zero with valid stdout. Treat presence of
            // stdout as success even on non-zero exit.
            if (result.stdout && result.stdout.trim().length > 0) {
                return { ok: true, output: result.stdout, duration };
            }
            // No usable output — classify the failure
            process.stderr.write(`[claude-provider] exit=${exitCode} stderr=${result.stderr?.slice(0, 500)}\n`);
            return {
                ok: false,
                error: classifyError(result.stderr ?? "", exitCode),
                duration,
            };
        }
        catch (error) {
            const duration = Date.now() - start;
            const message = error instanceof Error ? error.message : "Unknown error invoking claude";
            return {
                ok: false,
                error: { kind: "fatal", message, exitCode: 1 },
                duration,
            };
        }
    }
    async isAvailable() {
        try {
            const result = await execa("claude", ["--version"], {
                preferLocal: true,
                timeout: 5_000,
                reject: false,
                env: cleanEnv(),
                extendEnv: false,
            });
            return result.exitCode === 0;
        }
        catch {
            return false;
        }
    }
    async checkStructuredOutputSupport() {
        if (this.capabilityCache !== null) {
            return this.capabilityCache;
        }
        try {
            const result = await execa("claude", ["--help"], {
                preferLocal: true,
                timeout: 5_000,
                reject: false,
                env: cleanEnv(),
                extendEnv: false,
            });
            const helpText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
            const supported = helpText.includes("--json-schema");
            this.capabilityCache = supported;
            if (!supported) {
                process.stderr.write(`[planpong] Structured output not supported by claude — using legacy parsing\n`);
            }
            return supported;
        }
        catch {
            this.capabilityCache = false;
            return false;
        }
    }
    markNonCapable() {
        this.capabilityCache = false;
    }
    getModels() {
        return MODELS;
    }
    getEffortLevels() {
        // Claude effort maps to model selection — opus is highest reasoning
        return ["default"];
    }
}
//# sourceMappingURL=claude.js.map