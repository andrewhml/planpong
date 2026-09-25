import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { z } from "zod";
import { assertMutuallyExclusiveSessions, buildCatalog, logClassificationFailure, summarizeStderr, } from "./shared.js";
// Built-in fallback, snapshot of `codex debug models` (list-visible only)
// taken 2026-09-25 with codex-cli 0.157.0. Used when live discovery fails.
const STATIC_MODELS = [
    { id: "gpt-6-astra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
    { id: "gpt-6-sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
    { id: "gpt-6-luna", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
    { id: "gpt-5.6-sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low" },
    { id: "gpt-5.6-terra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
    { id: "gpt-5.6-luna", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
    { id: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium" },
];
const MODELS = STATIC_MODELS.map((m) => m.id);
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
/**
 * Efforts that work but change behavior enough to warn about. Kept in the
 * catalog so `config set` doesn't call them unknown; excluded from wizard
 * suggestions.
 */
export const EFFORT_ADVISORIES = {
    ultra: "ultra enables automatic task delegation; the reviewer may spawn sub-agents, increasing time and cost.",
};
// Tolerant on purpose: `codex debug models` is a debug command whose shape
// can change. Only `slug` is required; unknown fields are stripped.
const CatalogEntrySchema = z.object({
    slug: z.string(),
    visibility: z.string().optional(),
    supported_reasoning_levels: z
        .array(z.object({ effort: z.string() }))
        .optional(),
    default_reasoning_level: z.string().optional(),
});
const CatalogSchema = z.union([
    z.object({ models: z.array(CatalogEntrySchema) }),
    z.array(CatalogEntrySchema),
]);
/**
 * Parse `codex debug models` stdout into visible models. Returns an error
 * string instead of throwing so the caller can fall back and say why.
 */
export function parseCodexCatalog(stdout) {
    let raw;
    try {
        raw = JSON.parse(stdout);
    }
    catch {
        return { ok: false, reason: "output was not JSON" };
    }
    const parsed = CatalogSchema.safeParse(raw);
    if (!parsed.success)
        return { ok: false, reason: "unrecognized catalog shape" };
    const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.models;
    const models = entries
        .filter((e) => e.visibility !== "hide")
        .map((e) => ({
        id: e.slug,
        efforts: (e.supported_reasoning_levels ?? []).map((l) => l.effort),
        ...(e.default_reasoning_level ? { defaultEffort: e.default_reasoning_level } : {}),
    }));
    if (models.length === 0)
        return { ok: false, reason: "catalog listed no models" };
    return { ok: true, models };
}
/**
 * Classify a CLI invocation failure as `capability` (downgrade-eligible) or
 * `fatal` (terminal). Capability errors indicate the CLI doesn't support the
 * requested structured output flag; fatal errors are everything else.
 *
 * Patterns must be narrow — codex's normal session header includes flag
 * names like "output-schema:" in its info output, so substring matches on
 * the flag name alone produce false positives.
 */
export function extractCodexThreadId(stdout) {
    if (!stdout)
        return undefined;
    // The first non-empty line of `codex exec --json` stdout is a
    // `thread.started` or `thread.resumed` event with `thread_id`. Scan
    // the first ~10 lines defensively in case the model emits anything
    // else first.
    const lines = stdout.split("\n").slice(0, 10);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{"))
            continue;
        try {
            const evt = JSON.parse(trimmed);
            if ((evt.type === "thread.started" || evt.type === "thread.resumed") &&
                typeof evt.thread_id === "string") {
                return evt.thread_id;
            }
        }
        catch {
            continue;
        }
    }
    return undefined;
}
function parseEvents(stdout) {
    if (!stdout)
        return [];
    const events = [];
    for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{"))
            continue;
        try {
            const evt = JSON.parse(trimmed);
            if (evt && typeof evt === "object")
                events.push(evt);
        }
        catch {
            continue;
        }
    }
    return events;
}
/**
 * Codex wraps API errors as a JSON string inside the event's message, e.g.
 * `{"type":"error","status":400,"error":{"message":"The 'x' model is not
 * supported..."}}`. Return the innermost human-readable message.
 */
function unwrapCodexMessage(message) {
    try {
        const inner = JSON.parse(message);
        if (inner && typeof inner.error?.message === "string") {
            const prefix = [inner.status, inner.error.type].filter(Boolean).join(" ");
            return prefix ? `${prefix}: ${inner.error.message}` : inner.error.message;
        }
    }
    catch {
        // Not wrapped JSON; use as-is.
    }
    return message;
}
/**
 * Codex with `--json` reports failures as JSONL events on stdout
 * (`turn.failed`, top-level `error`), not on stderr. Extract the terminal
 * failure, preferring `turn.failed`, plus warnings such as
 * "Model metadata for `x` not found", codex's only hint that a model slug
 * is unknown.
 */
export function extractCodexError(stdout) {
    let turnFailed;
    let topLevelError;
    let turnCompleted = false;
    const warnings = [];
    for (const evt of parseEvents(stdout)) {
        if (evt.type === "turn.completed") {
            turnCompleted = true;
        }
        else if (evt.type === "turn.failed") {
            const err = evt.error;
            if (typeof err?.message === "string")
                turnFailed = unwrapCodexMessage(err.message);
        }
        else if (evt.type === "error" && typeof evt.message === "string") {
            topLevelError = unwrapCodexMessage(evt.message);
        }
        else if (evt.type === "item.completed") {
            const item = evt.item;
            if (item?.type === "error" &&
                typeof item.message === "string" &&
                item.message.startsWith("Model metadata for")) {
                warnings.push(item.message);
            }
        }
    }
    // A top-level `error` event is not always terminal: codex also emits them
    // for retried stream disconnects ("Reconnecting... 1/5") in runs that go
    // on to complete. Treat it as the failure only when the turn never
    // completed.
    const message = turnFailed ?? (turnCompleted ? undefined : topLevelError);
    return { message, warnings };
}
/**
 * Recover the final agent message from the event stream. Used only when the
 * `-o` output file is missing or empty.
 */
export function extractCodexAgentMessage(stdout) {
    let last;
    for (const evt of parseEvents(stdout)) {
        if (evt.type !== "item.completed")
            continue;
        const item = evt.item;
        if (item?.type === "agent_message" && typeof item.text === "string") {
            last = item.text;
        }
    }
    return last;
}
/**
 * Pure interpretation of one `codex exec --json` run. Order matters:
 * 1. A terminal failure in the event stream wins, whatever else exists.
 * 2. The `-o` file, if non-empty, is the output.
 * 3. Else the last `agent_message` event.
 * 4. Else failure. Raw stdout (JSONL events) is never returned as output.
 */
export function interpretCodexResult(run) {
    const stderr = run.stderr ?? "";
    const eventError = extractCodexError(run.stdout);
    if (eventError.message) {
        const evidence = `${eventError.message}\n${stderr}`;
        const stderrSummary = summarizeStderr(stderr);
        const message = stderrSummary
            ? `${eventError.message}\n${stderrSummary}`
            : eventError.message;
        return { ok: false, error: classifyError(evidence, run.exitCode, { message, stderr }) };
    }
    const sessionId = extractCodexThreadId(run.stdout);
    if (run.fileContent && run.fileContent.trim().length > 0) {
        return { ok: true, output: run.fileContent, sessionId };
    }
    const agentMessage = extractCodexAgentMessage(run.stdout);
    if (agentMessage && agentMessage.trim().length > 0) {
        return { ok: true, output: agentMessage, sessionId };
    }
    return { ok: false, error: classifyError(stderr, run.exitCode) };
}
export function classifyError(evidence, exitCode, overrides = {}) {
    const lower = evidence.toLowerCase();
    const capabilityPatterns = [
        /\bunknown (?:flag|option|argument)\b/,
        /\bunrecognized (?:flag|option|argument)\b/,
        /\bunexpected (?:flag|option|argument)\b/,
        /\binvalid_json_schema\b/,
        /\binvalid schema\b/,
        /\bschema is not supported\b/,
        /\bstructured output (?:not|isn't) supported\b/,
    ];
    const isCapability = capabilityPatterns.some((pattern) => pattern.test(lower));
    return {
        kind: isCapability ? "capability" : "fatal",
        message: overrides.message ||
            summarizeStderr(evidence) ||
            `codex exited with code ${exitCode}`,
        exitCode,
        stderr: overrides.stderr ?? evidence,
    };
}
export class CodexProvider {
    name = "codex";
    capabilityCache = null;
    catalogCache = null;
    async invoke(prompt, options) {
        assertMutuallyExclusiveSessions(this.name, options);
        // codex doesn't accept an externally-generated session UUID. The first
        // call always creates a fresh thread; we capture `thread_id` from the
        // `--json` event stream on stdout and the caller persists it. Resume
        // subsequent calls via `codex exec resume <id>` (subcommand form).
        if (options.newSessionId) {
            // Silent ignore — codex generates its own ID. The caller will get
            // the actual ID back via ProviderResponse.sessionId.
        }
        const isResume = options.resumeSessionId != null && options.resumeSessionId.length > 0;
        const args = isResume
            ? ["exec", "resume", options.resumeSessionId]
            : ["exec"];
        if (options.model) {
            args.push("-m", options.model);
        }
        if (options.effort) {
            args.push("-c", `model_reasoning_effort="${options.effort}"`);
        }
        // Write clean output to a temp file to avoid parsing header/footer
        const outFile = join(tmpdir(), `planpong-codex-${randomBytes(6).toString("hex")}.txt`);
        args.push("-o", outFile);
        // Always enable --json so we can capture the thread_id event from
        // stdout. The `-o` file still receives the agent's clean text output;
        // `--json` only changes stdout/stderr streaming.
        args.push("--json");
        // Optional structured output schema
        let schemaFile = null;
        if (options.jsonSchema) {
            schemaFile = join(tmpdir(), `planpong-codex-schema-${randomBytes(6).toString("hex")}.json`);
            try {
                writeFileSync(schemaFile, JSON.stringify(options.jsonSchema));
                args.push("--output-schema", schemaFile);
            }
            catch (error) {
                // If we can't write the schema file, fall through without structured output
                schemaFile = null;
            }
        }
        // Use stdin for prompt (CLI arg has length limits)
        args.push("-");
        const start = Date.now();
        try {
            const result = await execa("codex", args, {
                cwd: options.cwd,
                preferLocal: true,
                timeout: options.timeout ?? 600_000,
                reject: false,
                input: prompt,
            });
            const duration = Date.now() - start;
            const exitCode = result.exitCode ?? 1;
            let fileContent = null;
            try {
                fileContent = readFileSync(outFile, "utf-8");
            }
            catch {
                // Output file not created; interpretCodexResult falls back to the
                // agent_message event, never to raw stdout.
            }
            // Clean up temp files
            try {
                unlinkSync(outFile);
            }
            catch {
                // ignore
            }
            if (schemaFile) {
                try {
                    unlinkSync(schemaFile);
                }
                catch {
                    // ignore
                }
            }
            for (const warning of extractCodexError(result.stdout).warnings) {
                process.stderr.write(`[planpong] codex: ${warning}\n`);
            }
            // Session IDs come from the thread.started / thread.resumed event;
            // a missing one means "no session tracking", not an error.
            const interpreted = interpretCodexResult({
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode,
                fileContent,
            });
            if (interpreted.ok) {
                return { ...interpreted, duration };
            }
            logClassificationFailure(this.name, exitCode, interpreted.error.message);
            return { ok: false, error: interpreted.error, duration };
        }
        catch (error) {
            const duration = Date.now() - start;
            // Cleanup on error path
            if (schemaFile) {
                try {
                    unlinkSync(schemaFile);
                }
                catch {
                    // ignore
                }
            }
            const message = error instanceof Error ? error.message : "Unknown error invoking codex";
            return {
                ok: false,
                error: { kind: "fatal", message, exitCode: 1 },
                duration,
            };
        }
    }
    async isAvailable() {
        try {
            const result = await execa("codex", ["--version"], {
                preferLocal: true,
                timeout: 5_000,
                reject: false,
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
            const result = await execa("codex", ["exec", "--help"], {
                preferLocal: true,
                timeout: 5_000,
                reject: false,
            });
            const helpText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
            const supported = helpText.includes("--output-schema");
            this.capabilityCache = supported;
            if (!supported) {
                process.stderr.write(`[planpong] Structured output not supported by codex — using prompted parsing\n`);
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
    async getModelCatalog() {
        if (this.catalogCache)
            return this.catalogCache;
        let reason;
        try {
            const result = await execa("codex", ["debug", "models"], {
                preferLocal: true,
                timeout: 5_000,
                reject: false,
            });
            if (result.exitCode === 0) {
                const parsed = parseCodexCatalog(result.stdout ?? "");
                if (parsed.ok) {
                    this.catalogCache = buildCatalog("live", parsed.models, {
                        advisories: EFFORT_ADVISORIES,
                    });
                    return this.catalogCache;
                }
                reason = parsed.reason;
            }
            else {
                // With reject: false, a spawn failure (codex not installed)
                // resolves with no exitCode and an ENOENT-style `code`.
                reason = result.timedOut
                    ? "timed out"
                    : result.exitCode === undefined
                        ? `could not run codex${result.code ? ` (${result.code})` : ""}`
                        : `exit ${result.exitCode}`;
            }
        }
        catch (error) {
            reason = error instanceof Error ? error.message : "could not run codex";
        }
        this.catalogCache = buildCatalog("static", STATIC_MODELS, {
            advisories: EFFORT_ADVISORIES,
            note: `codex model discovery failed (${reason}); showing built-in list`,
        });
        return this.catalogCache;
    }
    getEffortLevels() {
        return EFFORT_LEVELS;
    }
}
//# sourceMappingURL=codex.js.map