import { execa } from "execa";
import { assertMutuallyExclusiveSessions, buildCatalog, logClassificationFailure, summarizeStderr, } from "./shared.js";
// Aliases resolve to the latest model on the CLI side, so this list stays
// current without discovery (claude has no command that lists models).
const MODELS = ["fable", "opus", "sonnet", "haiku"];
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
/** Pure parse of `claude --help` output. */
export function parseClaudeHelp(helpText) {
    const supportsEffort = /--effort\b/.test(helpText);
    let advertisedEfforts = null;
    if (supportsEffort) {
        // The option's description can wrap; stop at the next option line.
        const block = helpText.split(/--effort\b/)[1]?.split(/\n\s{2}-/)[0] ?? "";
        const listed = block.match(/\(([^)]+)\)/)?.[1];
        if (listed)
            advertisedEfforts = listed.split(",").map((v) => v.trim()).filter(Boolean);
    }
    return {
        supportsJsonSchema: helpText.includes("--json-schema"),
        supportsEffort,
        advertisedEfforts,
    };
}
/**
 * Decide whether to pass `--effort`. The flag is dropped (with a warning)
 * rather than sent when we know it won't take effect: claude ignores
 * unknown values silently apart from a stderr line, and older CLIs reject
 * the flag outright, which classifyError would misread as a structured
 * output capability gap.
 */
export function resolveEffortArgs(effort, help) {
    if (!effort || effort === "default")
        return { args: [] };
    if (!help.supportsEffort) {
        return {
            args: [],
            warning: `claude CLI does not support --effort; ignoring effort=${effort}. Upgrade claude to enable.`,
        };
    }
    if (help.advertisedEfforts && !help.advertisedEfforts.includes(effort)) {
        return {
            args: [],
            warning: `claude does not accept effort=${effort}; ignoring it. Valid values: ${help.advertisedEfforts.join(", ")}.`,
        };
    }
    return { args: ["--effort", effort] };
}
const emittedWarnings = new Set();
function warnOnce(message) {
    if (emittedWarnings.has(message))
        return;
    emittedWarnings.add(message);
    process.stderr.write(`[planpong] ${message}\n`);
}
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
export function extractStructuredOutput(stdout) {
    try {
        const envelope = JSON.parse(stdout);
        if (envelope &&
            typeof envelope === "object" &&
            "structured_output" in envelope &&
            envelope.structured_output !== null &&
            typeof envelope.structured_output === "object") {
            return JSON.stringify(envelope.structured_output);
        }
    }
    catch {
        // Not JSON — may indicate a pre-envelope error or auth failure
    }
    return null;
}
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
export function extractEnvelopeError(stdout) {
    let envelope;
    try {
        envelope = JSON.parse(stdout);
    }
    catch {
        return null;
    }
    if (!envelope || typeof envelope !== "object")
        return null;
    const subtype = typeof envelope.subtype === "string" ? envelope.subtype : "";
    if (envelope.is_error !== true && !subtype.startsWith("error"))
        return null;
    const parts = [
        typeof envelope.result === "string" ? envelope.result : null,
        envelope.error != null ? JSON.stringify(envelope.error) : null,
        envelope.errors != null ? JSON.stringify(envelope.errors) : null,
        typeof envelope.api_error_status === "number"
            ? `api_error_status ${envelope.api_error_status}`
            : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : `claude reported an error (${subtype || "is_error"})`;
}
const ENVELOPE_CAPABILITY_PATTERN = /invalid (?:json )?schema|json-schema|structured output (?:is )?not supported/i;
/**
 * Pure interpretation of one structured-output (`--output-format json`)
 * run. An error envelope is classified from its own text; only a
 * successful envelope that lacks `structured_output` is a capability
 * failure.
 */
export function interpretStructuredResult(run) {
    const stderr = run.stderr ?? "";
    const envelopeError = extractEnvelopeError(run.stdout);
    if (envelopeError !== null) {
        // An envelope means the CLI already accepted every flag, so flag-level
        // indicators ("unrecognized", "unknown option") can't mean a capability
        // gap here. Real stderr for a bad model is `[claude-code:unrecognized_model]`,
        // which the general classifier would misread. Only schema wording counts.
        const evidence = `${envelopeError}\n${stderr}`;
        const isSchemaProblem = ENVELOPE_CAPABILITY_PATTERN.test(evidence);
        return {
            ok: false,
            error: {
                kind: isSchemaProblem ? "capability" : "fatal",
                // Envelope fields are already clean text; keep all of them (the
                // result sentence plus status) rather than picking one line.
                message: envelopeError.replace(/\n/g, "; ").slice(0, 800),
                exitCode: run.exitCode,
                stderr,
            },
        };
    }
    const extracted = extractStructuredOutput(run.stdout);
    if (extracted === null) {
        return {
            ok: false,
            error: {
                kind: "capability",
                message: `claude returned envelope without structured_output field: ${run.stdout.slice(0, 300)}`,
                exitCode: run.exitCode,
                stderr,
            },
        };
    }
    return { ok: true, output: extracted };
}
export function classifyError(evidence, exitCode, overrides = {}) {
    const lower = evidence.toLowerCase();
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
        message: overrides.message ||
            summarizeStderr(evidence) ||
            `claude exited with code ${exitCode}`,
        exitCode,
        stderr: overrides.stderr ?? evidence,
    };
}
export class ClaudeProvider {
    name = "claude";
    capabilityCache = null;
    helpCache = null;
    /** Run `claude --help` once per instance; shared by all capability checks. */
    probeHelp() {
        if (!this.helpCache) {
            this.helpCache = execa("claude", ["--help"], {
                preferLocal: true,
                timeout: 5_000,
                reject: false,
                env: cleanEnv(),
                extendEnv: false,
            })
                .then((r) => parseClaudeHelp(`${r.stdout ?? ""}\n${r.stderr ?? ""}`))
                .catch(() => parseClaudeHelp(""));
        }
        return this.helpCache;
    }
    async invoke(prompt, options) {
        assertMutuallyExclusiveSessions(this.name, options);
        // claude -p reads prompt from stdin when no positional arg is given.
        // --bare skips hooks/MCP/auto-memory/CLAUDE.md/plugin-sync for faster
        // subprocess startup, but it bypasses OAuth/keychain — only safe to use
        // when ANTHROPIC_API_KEY is set.
        const args = ["-p"];
        if (process.env.ANTHROPIC_API_KEY) {
            args.push("--bare");
        }
        if (options.jsonSchema) {
            // With a schema, use --output-format json so the response envelope
            // includes a `structured_output` field containing the model's
            // constrained JSON as a native object. --output-format text drops
            // the structured_output field entirely.
            args.push("--output-format", "json", "--json-schema", JSON.stringify(options.jsonSchema));
        }
        else {
            args.push("--output-format", "text");
        }
        if (options.model) {
            args.push("--model", options.model);
        }
        if (options.effort && options.effort !== "default") {
            const effort = resolveEffortArgs(options.effort, await this.probeHelp());
            if (effort.warning)
                warnOnce(effort.warning);
            args.push(...effort.args);
        }
        // Persistent conversation. `--session-id` creates a new session with the
        // given UUID; `--resume` continues an existing one. Mutual exclusion is
        // enforced at the top of invoke() via assertMutuallyExclusiveSessions.
        // Lets us drop heavy "current plan + prior decisions" stuffing on round
        // 2+ since the model retains context.
        if (options.newSessionId) {
            args.push("--session-id", options.newSessionId);
        }
        else if (options.resumeSessionId) {
            args.push("--resume", options.resumeSessionId);
        }
        const start = Date.now();
        try {
            const result = await execa("claude", args, {
                cwd: options.cwd,
                preferLocal: true,
                timeout: options.timeout ?? 600_000,
                reject: false,
                env: cleanEnv(),
                extendEnv: false,
                input: prompt,
            });
            const duration = Date.now() - start;
            const exitCode = result.exitCode ?? 1;
            // claude -p can exit non-zero with valid stdout. Treat presence of
            // stdout as success even on non-zero exit.
            // Canonical session ID for the response: echoes the input UUID
            // (claude accepts external UUIDs as session IDs, so input == output).
            const sessionId = options.newSessionId ?? options.resumeSessionId;
            const effortWarning = result.stderr?.match(/Unknown --effort value[^\n]*/)?.[0];
            if (effortWarning)
                warnOnce(`claude: ${effortWarning}`);
            if (result.stdout && result.stdout.trim().length > 0) {
                if (options.jsonSchema) {
                    const interpreted = interpretStructuredResult({
                        stdout: result.stdout,
                        stderr: result.stderr,
                        exitCode,
                    });
                    if (interpreted.ok) {
                        return { ok: true, output: interpreted.output, duration, sessionId };
                    }
                    logClassificationFailure(this.name, exitCode, interpreted.error.message);
                    return { ok: false, error: interpreted.error, duration };
                }
                return { ok: true, output: result.stdout, duration, sessionId };
            }
            // No usable output — classify the failure
            logClassificationFailure(this.name, exitCode, result.stderr);
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
            const supported = (await this.probeHelp()).supportsJsonSchema;
            this.capabilityCache = supported;
            if (!supported) {
                process.stderr.write(`[planpong] Structured output not supported by claude — using prompted parsing\n`);
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
        return EFFORT_LEVELS;
    }
    async getModelCatalog() {
        return buildCatalog("static", MODELS.map((id) => ({ id, efforts: EFFORT_LEVELS })));
    }
}
//# sourceMappingURL=claude.js.map