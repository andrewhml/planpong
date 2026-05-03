import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isEditsRevision, isDirectionRevision, } from "../schemas/revision.js";
import { buildRevisionPrompt, buildEditsRetryPrompt, } from "../prompts/planner.js";
import { buildReviewPrompt, buildIncrementalReviewPrompt, formatPriorDecisions, getReviewPhase, } from "../prompts/reviewer.js";
import { buildPlanDiff } from "./plan-diff.js";
import { parseFeedbackForPhase, parseRevision, parseStructuredFeedbackForPhase, parseStructuredRevision, isConverged, StructuredOutputParseError, ZodValidationError, } from "./convergence.js";
import { getFeedbackJsonSchemaForPhase, getRevisionJsonSchema, } from "../schemas/json-schema.js";
import { applyEdits, logFailures, summarizeApply, } from "./apply-edits.js";
import { createSession, writeSessionState, writeRoundFeedback, writeRoundResponse, readRoundFeedback, readRoundResponse, writeInitialPlan, writeRoundMetrics, writeRoundPlanSnapshot, readRoundPlanSnapshot, } from "./session.js";
import { summarizeTiming, } from "../schemas/metrics.js";
// --- Utility functions ---
export function hashFile(path) {
    const content = readFileSync(path, "utf-8");
    return createHash("sha256").update(content).digest("hex");
}
function extractKeyDecisions(plan) {
    const match = plan.match(/## Key [Dd]ecisions\s*\n([\s\S]*?)(?=\n## |\n---|\Z)/);
    return match?.[1]?.trim() ?? null;
}
function countLines(text) {
    return text.split("\n").length;
}
export function formatRoundSeverity(round) {
    const parts = [];
    if (round.P1 > 0)
        parts.push(`${round.P1}P1`);
    if (round.P2 > 0)
        parts.push(`${round.P2}P2`);
    if (round.P3 > 0)
        parts.push(`${round.P3}P3`);
    if (parts.length === 0)
        return "0";
    return parts.join(" ");
}
export function formatTrajectory(trajectory) {
    return trajectory.map(formatRoundSeverity).join(" → ");
}
export function severityFromFeedback(feedback) {
    const counts = { P1: 0, P2: 0, P3: 0 };
    for (const issue of feedback.issues) {
        counts[issue.severity]++;
    }
    return counts;
}
export function formatTallies(accepted, rejected, deferred) {
    const parts = [];
    if (accepted > 0)
        parts.push(`Accepted: ${accepted}`);
    if (rejected > 0)
        parts.push(`Rejected: ${rejected}`);
    if (deferred > 0)
        parts.push(`Deferred: ${deferred}`);
    return parts.join(" | ");
}
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes === 0)
        return `${seconds}s`;
    return `${minutes}m ${remainingSeconds}s`;
}
export function formatProviderLabel(provider) {
    const hasModel = provider.model && provider.model !== "default";
    const hasEffort = provider.effort && provider.effort !== "default";
    if (!hasModel && !hasEffort)
        return provider.provider;
    const parts = [
        hasModel ? provider.model : null,
        hasEffort ? provider.effort : null,
    ].filter(Boolean);
    return `${provider.provider}(${parts.join("/")})`;
}
export function computeSessionStats(cwd, sessionId, currentRound) {
    const trajectory = [];
    let totalAccepted = 0;
    let totalRejected = 0;
    let totalDeferred = 0;
    for (let r = 1; r <= currentRound; r++) {
        const feedback = readRoundFeedback(cwd, sessionId, r);
        if (feedback) {
            trajectory.push(severityFromFeedback(feedback));
        }
        const response = readRoundResponse(cwd, sessionId, r);
        if (response) {
            for (const resp of response.responses) {
                if (resp.action === "accepted")
                    totalAccepted++;
                else if (resp.action === "rejected")
                    totalRejected++;
                else if (resp.action === "deferred")
                    totalDeferred++;
            }
        }
    }
    return {
        issueTrajectory: trajectory,
        totalAccepted,
        totalRejected,
        totalDeferred,
    };
}
export function formatPhaseExtras(phase, extras) {
    if (extras.is_blocked) {
        if (phase === "risk" && extras.risk_count) {
            return `BLOCKED | ${extras.risk_count} unmitigable risks`;
        }
        return "BLOCKED";
    }
    const parts = [];
    if (phase === "direction" && extras.confidence) {
        parts.push(`confidence: ${extras.confidence}`);
    }
    if (phase === "risk") {
        if (extras.risk_level) {
            parts.push(`risk: ${extras.risk_level}`);
        }
        if (extras.risk_count !== undefined && extras.risks_promoted !== undefined) {
            parts.push(`${extras.risk_count} risks (${extras.risks_promoted} promoted)`);
        }
    }
    return parts.join(" | ");
}
export function buildStatusLine(session, config, issueTrajectory, accepted, rejected, deferred, linesAdded, linesRemoved, elapsed, phaseExtras) {
    const plannerLabel = formatProviderLabel(config.planner);
    const reviewerLabel = formatProviderLabel(config.reviewer);
    const trajectory = formatTrajectory(issueTrajectory);
    const tallies = formatTallies(accepted, rejected, deferred);
    const elapsedStr = formatDuration(elapsed);
    const phase = getReviewPhase(session.currentRound);
    const phaseSignal = phaseExtras
        ? formatPhaseExtras(phase, phaseExtras)
        : "";
    const parts = [
        `**planpong:** R${session.currentRound}/${config.max_rounds}`,
        `${plannerLabel} → ${reviewerLabel}`,
        phase,
        phaseSignal,
        trajectory,
        tallies,
        `+${linesAdded}/-${linesRemoved} lines`,
        elapsedStr,
    ].filter(Boolean);
    return parts.join(" | ");
}
/**
 * Build and write the status line to the plan file.
 * Used by both CLI and MCP paths after each round.
 */
export function writeStatusLineToPlan(session, cwd, config, suffix, phaseExtras) {
    const planPath = resolve(cwd, session.planPath);
    let planContent = readFileSync(planPath, "utf-8");
    const stats = computeSessionStats(cwd, session.id, session.currentRound);
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    const currentLines = countLines(planContent);
    const initialLines = session.initialLineCount ?? currentLines;
    const linesAdded = Math.max(0, currentLines - initialLines);
    const linesRemoved = Math.max(0, initialLines - currentLines);
    const statusLine = buildStatusLine(session, config, stats.issueTrajectory, stats.totalAccepted, stats.totalRejected, stats.totalDeferred, linesAdded, linesRemoved, elapsed, phaseExtras) + (suffix ? ` | ${suffix}` : "");
    planContent = updatePlanStatusLine(planContent, statusLine);
    writeFileSync(planPath, planContent);
    session.planHash = hashFile(planPath);
    writeSessionState(cwd, session);
    return statusLine;
}
export function updatePlanStatusLine(planContent, statusLine) {
    const lines = planContent.split("\n");
    const planpongIdx = lines.findIndex((l) => l.startsWith("**planpong:**"));
    if (planpongIdx >= 0) {
        lines[planpongIdx] = statusLine;
    }
    else {
        const statusIdx = lines.findIndex((l) => l.startsWith("**Status:**"));
        if (statusIdx >= 0) {
            lines.splice(statusIdx + 1, 0, statusLine);
        }
        else {
            lines.splice(1, 0, "", statusLine);
        }
    }
    return lines.join("\n");
}
// --- Core operations ---
/**
 * Initialize a review session for an existing plan file.
 * Validates the file exists, creates a session directory, and writes
 * an initial status line to the plan.
 */
export function initReviewSession(planPath, cwd, config) {
    if (!existsSync(planPath)) {
        throw new Error(`Plan file not found: ${planPath}`);
    }
    const relativePlanPath = relative(cwd, planPath);
    const originalContent = readFileSync(planPath, "utf-8");
    let planContent = originalContent;
    const initialStatusLine = `**planpong:** R0/${config.max_rounds} | ${formatProviderLabel(config.planner)} → ${formatProviderLabel(config.reviewer)} | Awaiting review`;
    planContent = updatePlanStatusLine(planContent, initialStatusLine);
    writeFileSync(planPath, planContent);
    const session = createSession(cwd, relativePlanPath, config.planner, config.reviewer, hashFile(planPath), config.planner_mode);
    session.initialLineCount = countLines(planContent);
    session.status = "in_review";
    writeInitialPlan(cwd, session.id, originalContent);
    writeSessionState(cwd, session);
    return { session, planContent, config };
}
/**
 * Build prior decisions context for rounds 2+.
 */
function buildPriorDecisions(cwd, sessionId, currentRound) {
    if (currentRound <= 1)
        return null;
    const priorRounds = [];
    for (let r = 1; r < currentRound; r++) {
        const fb = readRoundFeedback(cwd, sessionId, r);
        const resp = readRoundResponse(cwd, sessionId, r);
        if (fb && resp) {
            priorRounds.push({
                round: r,
                responses: resp.responses,
                issues: fb.issues.map((i) => ({
                    id: i.id,
                    severity: i.severity,
                    title: i.title,
                })),
            });
        }
    }
    if (priorRounds.length === 0)
        return null;
    return formatPriorDecisions(priorRounds);
}
/**
 * Invocation state machine — single owner of all retry/downgrade logic for
 * provider invocations. Providers are single-shot; this function decides
 * when to downgrade from structured output (schema-enforced) to prompted
 * output (tag-wrapped, prompt-enforced).
 *
 * Strict 2-attempt cap: structured (1) -> prompted fallback (1) -> terminal.
 *
 * Failure handling:
 * - Provider `capability` error in structured mode → downgrade
 * - Provider `fatal` error → terminal (no downgrade)
 * - JSON.parse failure on structured output → downgrade
 * - Zod validation failure on structured output → terminal (NOT retried)
 * - Any failure in prompted mode → terminal
 *
 * Observability: when `metricsContext` is provided, each attempt emits a
 * start/end line to stderr, collects `InvocationAttempt` records, and
 * persists a `RoundMetrics` file in the session directory. All telemetry
 * I/O is fail-open — failures log a warning and are swallowed, never
 * altering the invocation outcome. The in-memory metrics object is
 * returned alongside the result so callers get timing data without a
 * filesystem round-trip.
 */
async function invokeWithStateMachine(args) {
    const { provider, invokeOptions, jsonSchema, buildPrompt, parseStructured, parsePrompted, roundLabel, metricsContext, } = args;
    const supported = await provider.checkStructuredOutputSupport();
    let mode = supported ? "structured" : "prompted";
    let attempt = 0;
    const maxAttempts = 2;
    let lastError = null;
    // Metrics collection — only active when metricsContext is provided.
    const attempts = [];
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const providerLabel = buildProviderLabel(provider.name, invokeOptions.model, invokeOptions.effort);
    const writeMetricsNow = () => {
        if (!metricsContext)
            return;
        try {
            const metrics = {
                schema_version: 1,
                session_id: metricsContext.sessionId,
                round: metricsContext.round,
                phase: metricsContext.phase,
                role: metricsContext.role,
                started_at: startedAt,
                completed_at: new Date().toISOString(),
                total_duration_ms: Date.now() - startedAtMs,
                attempts,
            };
            writeRoundMetrics(invokeOptions.cwd, metricsContext.sessionId, metricsContext.round, metricsContext.role, metrics);
        }
        catch {
            // writeRoundMetrics is already fail-open; catch here belts-and-braces
            // against unexpected synchronous errors building the metrics object.
        }
    };
    const buildMetrics = () => {
        if (!metricsContext)
            return null;
        try {
            return {
                schema_version: 1,
                session_id: metricsContext.sessionId,
                round: metricsContext.round,
                phase: metricsContext.phase,
                role: metricsContext.role,
                started_at: startedAt,
                completed_at: new Date().toISOString(),
                total_duration_ms: Date.now() - startedAtMs,
                attempts,
            };
        }
        catch {
            return null;
        }
    };
    try {
        while (attempt < maxAttempts) {
            attempt++;
            const prompt = buildPrompt(mode === "structured");
            const promptChars = prompt.length;
            const promptLines = prompt.split("\n").length;
            const options = mode === "structured"
                ? { ...invokeOptions, jsonSchema }
                : { ...invokeOptions };
            logStart(roundLabel, providerLabel, mode, promptChars, metricsContext);
            const response = await provider.invoke(prompt, options);
            // Base attempt record — filled in below.
            const attemptRecord = {
                mode,
                provider: provider.name,
                model: invokeOptions.model ?? null,
                effort: invokeOptions.effort ?? null,
                prompt_chars: promptChars,
                prompt_lines: promptLines,
                output_chars: null,
                output_lines: null,
                duration_ms: response.duration ?? 0,
                ok: false,
                error_kind: null,
                error_exit_code: null,
            };
            if (!response.ok) {
                attemptRecord.ok = false;
                attemptRecord.error_kind = response.error.kind;
                attemptRecord.error_exit_code = response.error.exitCode;
                attempts.push(attemptRecord);
                logEnd(roundLabel, providerLabel, mode, promptChars, null, response.duration ?? 0, false, `${response.error.kind}: ${truncate(response.error.message, 200)}`, metricsContext);
                if (mode === "structured" &&
                    response.error.kind === "capability" &&
                    attempt < maxAttempts) {
                    provider.markNonCapable();
                    mode = "prompted";
                    continue;
                }
                // Fatal, or already in prompted mode — terminal
                throw new Error(`${roundLabel} failed (exit ${response.error.exitCode}, ${response.error.kind}):\n${response.error.message}`);
            }
            // Provider returned output — record output size, try to parse.
            const outputChars = response.output.length;
            const outputLines = response.output.split("\n").length;
            attemptRecord.output_chars = outputChars;
            attemptRecord.output_lines = outputLines;
            try {
                const parsed = mode === "structured"
                    ? parseStructured(response.output)
                    : parsePrompted(response.output);
                attemptRecord.ok = true;
                attempts.push(attemptRecord);
                logEnd(roundLabel, providerLabel, mode, promptChars, outputChars, response.duration ?? 0, true, null, metricsContext);
                return {
                    result: parsed,
                    metrics: buildMetrics(),
                    sessionId: response.ok ? response.sessionId : undefined,
                };
            }
            catch (parseError) {
                lastError = parseError instanceof Error ? parseError : new Error(String(parseError));
                // Zod validation failure on structured output is terminal — the model
                // produced semantically invalid content, retrying won't help.
                if (parseError instanceof ZodValidationError) {
                    attemptRecord.ok = false;
                    attemptRecord.error_kind = "zod";
                    attempts.push(attemptRecord);
                    logEnd(roundLabel, providerLabel, mode, promptChars, outputChars, response.duration ?? 0, false, `zod: ${truncate(lastError.message, 200)}`, metricsContext);
                    throw parseError;
                }
                // JSON.parse failure on structured output triggers downgrade
                if (mode === "structured" &&
                    parseError instanceof StructuredOutputParseError &&
                    attempt < maxAttempts) {
                    attemptRecord.ok = false;
                    attemptRecord.error_kind = "parse";
                    attempts.push(attemptRecord);
                    logEnd(roundLabel, providerLabel, mode, promptChars, outputChars, response.duration ?? 0, false, `parse: ${truncate(lastError.message, 200)}`, metricsContext);
                    provider.markNonCapable();
                    mode = "prompted";
                    continue;
                }
                // Prompted parse failure — terminal
                attemptRecord.ok = false;
                attemptRecord.error_kind = "parse";
                attempts.push(attemptRecord);
                logEnd(roundLabel, providerLabel, mode, promptChars, outputChars, response.duration ?? 0, false, `parse: ${truncate(lastError.message, 200)}`, metricsContext);
                throw new Error(`${roundLabel} parse failed in ${mode} mode: ${lastError.message}`);
            }
        }
        // Unreachable in normal flow — defensive
        throw lastError ?? new Error(`${roundLabel} exhausted all attempts`);
    }
    finally {
        // Persist metrics on every exit (success or throw). Fail-open — this
        // never throws; writeRoundMetrics catches its own errors.
        writeMetricsNow();
    }
}
function buildProviderLabel(providerName, model, effort) {
    return formatProviderLabel({
        provider: providerName,
        model: model ?? undefined,
        effort: effort ?? undefined,
    });
}
function truncate(text, max) {
    return text.length > max ? text.slice(0, max) : text;
}
function safeStderr(line) {
    try {
        process.stderr.write(line);
    }
    catch {
        // stderr unavailable — nothing else we can do
    }
}
function logStart(roundLabel, providerLabel, mode, promptChars, ctx) {
    if (!ctx)
        return;
    safeStderr(`[planpong] R${ctx.round} ${ctx.role} | ${providerLabel} | ${mode} | prompt=${promptChars}c\n`);
}
function logEnd(roundLabel, providerLabel, mode, promptChars, outputChars, durationMs, ok, failDetail, ctx) {
    if (!ctx)
        return;
    const durationStr = formatDuration(durationMs);
    if (ok && outputChars !== null) {
        safeStderr(`[planpong] R${ctx.round} ${ctx.role} | ${providerLabel} | ${mode} | prompt=${promptChars}c output=${outputChars}c duration=${durationStr} | ok\n`);
    }
    else {
        safeStderr(`[planpong] R${ctx.round} ${ctx.role} | ${providerLabel} | ${mode} | prompt=${promptChars}c duration=${durationStr} | fail (${failDetail ?? "unknown"})\n`);
    }
}
/**
 * Run a single review round: send current plan to the reviewer for critique.
 */
export async function runReviewRound(session, cwd, config, reviewerProvider) {
    const round = session.currentRound;
    const planPath = resolve(cwd, session.planPath);
    const planContent = readFileSync(planPath, "utf-8");
    const phase = getReviewPhase(round);
    const priorDecisions = buildPriorDecisions(cwd, session.id, round);
    // Persist a snapshot of the plan as the reviewer is about to see it. On
    // round N+1 we'll diff against this snapshot to produce the incremental
    // "what changed" content for the resumed reviewer session.
    writeRoundPlanSnapshot(cwd, session.id, round, planContent);
    // Reviewer-side persistent sessions. Both claude and codex support this:
    //   - claude: we generate the UUID and pass it via --session-id (first)
    //     or --resume (subsequent).
    //   - codex: codex generates its own thread_id; we capture it from the
    //     `--json` event stream and pass it via `codex exec resume <id>`
    //     on subsequent calls.
    // The canonical reviewer session ID is `session.reviewerSessionId` — for
    // claude this is the pre-generated UUID; for codex it's overwritten
    // after the first call with the captured thread_id.
    const reviewerSessionInited = session.reviewerSessionInitialized === true;
    const isResumedReviewerSession = reviewerSessionInited;
    const priorPlanContent = isResumedReviewerSession
        ? readRoundPlanSnapshot(cwd, session.id, round - 1)
        : null;
    const planDiff = priorPlanContent
        ? buildPlanDiff(priorPlanContent, planContent)
        : null;
    const newSessionId = !reviewerSessionInited && reviewerProvider.name === "claude"
        ? session.reviewerSessionId
        : undefined;
    const resumeSessionId = reviewerSessionInited
        ? session.reviewerSessionId
        : undefined;
    const { result: feedback, metrics, sessionId: capturedSessionId, } = await invokeWithStateMachine({
        provider: reviewerProvider,
        invokeOptions: {
            cwd,
            model: config.reviewer.model,
            effort: config.reviewer.effort,
            newSessionId,
            resumeSessionId,
        },
        jsonSchema: getFeedbackJsonSchemaForPhase(phase),
        buildPrompt: (structuredOutput) => isResumedReviewerSession
            ? buildIncrementalReviewPrompt(planDiff ?? planContent, planContent, priorDecisions, phase, structuredOutput)
            : buildReviewPrompt(planContent, priorDecisions, phase, structuredOutput),
        parseStructured: (output) => parseStructuredFeedbackForPhase(output, phase, planContent),
        parsePrompted: (output) => parseFeedbackForPhase(output, phase, planContent),
        roundLabel: `Round ${round} review`,
        metricsContext: {
            sessionId: session.id,
            round,
            phase,
            role: "review",
        },
    });
    writeRoundFeedback(cwd, session.id, round, feedback);
    const severity = severityFromFeedback(feedback);
    const converged = isConverged(feedback);
    const timing = metrics ? summarizeTiming(metrics) : undefined;
    // Persist the canonical reviewer session ID. For claude this is the
    // UUID we generated; for codex it's the thread_id captured from --json
    // output. Either way, future rounds resume this conversation.
    if (!reviewerSessionInited && capturedSessionId) {
        session.reviewerSessionId = capturedSessionId;
        session.reviewerSessionInitialized = true;
        writeSessionState(cwd, session);
    }
    // Extract phase-specific extras for status line
    const phaseExtras = {};
    if (feedback.verdict === "blocked") {
        phaseExtras.is_blocked = true;
        session.status = "blocked";
        writeSessionState(cwd, session);
    }
    if (phase === "direction" && "confidence" in feedback) {
        phaseExtras.confidence = feedback.confidence;
    }
    if (phase === "risk") {
        if ("risk_level" in feedback) {
            const riskFb = feedback;
            phaseExtras.risk_level = riskFb.risk_level;
            phaseExtras.risk_count = riskFb.risks?.length ?? 0;
            phaseExtras.risks_promoted = feedback.issues.length;
        }
    }
    return { round, feedback, severity, converged, phaseExtras, timing };
}
/**
 * Run a single revision round: send plan + feedback to the planner for revision.
 */
export async function runRevisionRound(session, cwd, config, plannerProvider) {
    const round = session.currentRound;
    const planPath = resolve(cwd, session.planPath);
    const planContent = readFileSync(planPath, "utf-8");
    const feedback = readRoundFeedback(cwd, session.id, round);
    if (!feedback) {
        throw new Error(`No feedback found for session ${session.id} round ${round}`);
    }
    const phase = getReviewPhase(round);
    const keyDecisions = extractKeyDecisions(planContent);
    // Direction phase always uses full-plan output. Risk + detail honor
    // config.revision_mode. The shape decision is made once here and threaded
    // through prompt + JSON schema + parser.
    const useEdits = phase !== "direction" && config.revision_mode === "edits";
    const revisionShape = useEdits ? "edits" : "full";
    const jsonSchema = getRevisionJsonSchema(phase, config.revision_mode);
    // Planner-side persistent sessions were tested and found to INCREASE wall
    // time — the model used the spared context budget to do more work per
    // round (more edits, deeper revisions), not to do the same work faster.
    // Reviewer-side persistent sessions are kept (see runReviewRound).
    const { result: revision, metrics } = await invokeWithStateMachine({
        provider: plannerProvider,
        invokeOptions: {
            cwd,
            model: config.planner.model,
            effort: config.planner.effort,
        },
        jsonSchema,
        buildPrompt: (structuredOutput) => buildRevisionPrompt(planContent, feedback, keyDecisions, null, phase, structuredOutput, config.revision_mode),
        parseStructured: (output) => parseStructuredRevision(output, revisionShape),
        parsePrompted: (output) => parseRevision(output, revisionShape),
        roundLabel: `Round ${round} revision`,
        metricsContext: {
            sessionId: session.id,
            round,
            phase,
            role: "revision",
        },
    });
    const timing = metrics ? summarizeTiming(metrics) : undefined;
    // Apply revision to disk. Two paths: full (today's behavior) or edits
    // (apply edit list, retry failures, atomic write). The full-mode branch
    // also writes its own metrics file (with edit telemetry) before
    // finalization; the edits branch writes metrics inside applyRevisionEdits.
    let editTelemetry;
    let finalRevision = revision;
    if (useEdits && isEditsRevision(revision)) {
        const result = await applyRevisionEdits({
            session,
            cwd,
            planPath,
            planContent,
            revision,
            plannerProvider,
            config,
            phase,
            metrics,
        });
        finalRevision = result.revision;
        editTelemetry = result.telemetry;
    }
    else if (isDirectionRevision(revision)) {
        writeFileSync(planPath, revision.updated_plan);
        editTelemetry = {
            revision_mode: "full",
            edits_attempted: null,
            edits_applied: null,
            edits_failed: null,
            edits_retried: null,
            edits_recovered: null,
            retry_invoked: false,
        };
        persistRevisionMetrics({
            cwd,
            session,
            round,
            phase,
            metrics,
            telemetry: editTelemetry,
        });
    }
    else {
        throw new Error(`runRevisionRound: revision shape mismatch — expected ${useEdits ? "edits" : "full"} but got ${"updated_plan" in revision ? "full" : "edits"}`);
    }
    // Persist the (possibly-downgraded) finalRevision via the shared finalizer.
    // Same path as planpong_record_revision so the two modes stay aligned.
    const tally = finalizeRevision({
        session,
        cwd,
        round,
        revision: finalRevision,
        planPath,
    });
    return {
        round,
        revision: finalRevision,
        accepted: tally.accepted,
        rejected: tally.rejected,
        deferred: tally.deferred,
        planUpdated: true,
        timing,
        edits: editTelemetry,
    };
}
/**
 * Persist the final revision artifacts and return the response tally.
 * Shared by `runRevisionRound` (external mode) and
 * `planpong_record_revision` (inline mode) so both paths produce identical
 * on-disk shape.
 *
 * Write ordering (the contract):
 *   1. `round-N-response.json` — the revision payload
 *   2. plan hash — `session.planHash = hashFile(planPath)`
 *   3. `session.json` — session state (commit point)
 *
 * Step 3 is the commit point. A crash before step 3 leaves a stale
 * `round-N-response.json` and an unchanged `session.planHash`; a retry
 * re-enters with the same round number and overwrites the response file
 * (idempotent at this granularity).
 *
 * **Round advancement is NOT performed here.** `currentRound` is owned by
 * the callers that drive the loop: `get-feedback.ts:63` for the MCP path
 * (`session.currentRound++`) and `loop.ts` for the CLI path. Moving
 * advancement into finalization would double-advance in MCP mode.
 *
 * Idempotency: if `round-N-response.json` already exists and its content
 * matches the proposed revision, returns the existing tally without
 * re-writing. Detects retries from upstream (e.g., a stale tool call
 * after a successful finalization) without relying on round-number
 * comparison — `currentRound` is owned elsewhere.
 */
export function finalizeRevision({ session, cwd, round, revision, planPath, }) {
    // Idempotency check compares only `responses` rather than the whole
    // revision payload. Reason: in inline mode, the revision's updated_plan
    // captures the plan content as of finalize time, but the very next thing
    // we do (in the caller) is rewrite the plan's status line — so a retry
    // would read a slightly different plan file and produce a different
    // payload even though the agent's intent is identical. Responses
    // capture the agent's decisions; that's the right idempotency key.
    const existing = readRoundResponse(cwd, session.id, round);
    if (existing &&
        JSON.stringify(existing.responses) === JSON.stringify(revision.responses)) {
        return {
            ...tallyResponses(existing.responses),
            fresh: false,
        };
    }
    writeRoundResponse(cwd, session.id, round, revision);
    session.planHash = hashFile(planPath);
    writeSessionState(cwd, session);
    return {
        ...tallyResponses(revision.responses),
        fresh: true,
    };
}
function tallyResponses(responses) {
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    for (const r of responses) {
        if (r.action === "accepted")
            accepted++;
        else if (r.action === "rejected")
            rejected++;
        else if (r.action === "deferred")
            deferred++;
    }
    return { accepted, rejected, deferred };
}
/**
 * Apply an edits-mode revision: first-pass apply, targeted retry on failures,
 * atomic write, response-edit consistency check. All mutations to the plan
 * happen in memory; a single writeFileSync persists the final state.
 */
async function applyRevisionEdits(args) {
    const { session, cwd, planPath, planContent, revision, plannerProvider, config, phase, metrics, } = args;
    const round = session.currentRound;
    const editsAttempted = revision.edits.length;
    // First-pass apply.
    const firstPass = applyEdits(planContent, revision.edits);
    if (firstPass.failures.length > 0) {
        logFailures(`R${round} edits first-pass`, firstPass.failures);
    }
    safeStderr(`[planpong] R${round} edits | first-pass | ${summarizeApply(firstPass)}\n`);
    let working = firstPass.plan;
    const successfulEdits = firstPass.applied.map((a) => a.edit);
    const recoveredEdits = [];
    const unrecoverableFailures = [];
    let retryInvoked = false;
    let retriedCount = 0;
    if (firstPass.failures.length > 0) {
        retryInvoked = true;
        retriedCount = firstPass.failures.length;
        try {
            const retryResult = await runEditsRetry({
                cwd,
                session,
                round,
                phase,
                plannerProvider,
                config,
                currentPlan: working,
                failures: firstPass.failures,
            });
            const secondPass = applyEdits(working, retryResult.edits);
            if (secondPass.failures.length > 0) {
                logFailures(`R${round} edits retry`, secondPass.failures);
            }
            safeStderr(`[planpong] R${round} edits | retry | ${summarizeApply(secondPass)}\n`);
            working = secondPass.plan;
            for (const a of secondPass.applied)
                recoveredEdits.push(a.edit);
            unrecoverableFailures.push(...secondPass.failures);
            // Track the retry as an additional invocation attempt in metrics.
            if (metrics) {
                metrics.attempts.push(retryResult.attemptRecord);
            }
        }
        catch (err) {
            // Retry failed entirely (provider error, parse error). Surface but
            // keep first-pass partial result — strictly better than nothing.
            safeStderr(`[planpong] R${round} edits | retry failed: ${err instanceof Error ? err.message : String(err)}\n`);
            unrecoverableFailures.push(...firstPass.failures);
        }
    }
    // Atomic write of the final plan state.
    writeFileSync(planPath, working);
    // Response-edit consistency check: if an `accepted` response has no
    // surviving edit anywhere in its rationale or suggestion's section, the
    // planner claimed to have addressed an issue without a corresponding plan
    // change. Downgrade to `deferred`. The match is heuristic — keyed on the
    // response's `issue_id` appearing in the edit's after text or in any
    // edit's section that maps to the issue's section field. This is the same
    // tradeoff the plan documents (R3 F2 issue, accepted as heuristic).
    const survivingEdits = [...successfulEdits, ...recoveredEdits];
    const downgraded = downgradeOrphanedResponses(revision, survivingEdits, unrecoverableFailures);
    // Persist failure metadata in the round response JSON alongside responses.
    // We rewrite the response file to include the (possibly-downgraded)
    // responses + edit application result.
    writeRoundResponse(cwd, session.id, round, downgraded);
    const telemetry = {
        revision_mode: "edits",
        edits_attempted: editsAttempted,
        edits_applied: successfulEdits.length,
        edits_failed: firstPass.failures.length,
        edits_retried: retriedCount,
        edits_recovered: recoveredEdits.length,
        retry_invoked: retryInvoked,
    };
    persistRevisionMetrics({
        cwd,
        session,
        round,
        phase,
        metrics,
        telemetry,
    });
    return { revision: downgraded, telemetry };
}
/**
 * One-shot retry for failed edits. Builds a targeted prompt with only the
 * failures + current (partially-edited) plan and asks the planner to
 * re-express each failed edit. The retry is best-effort — provider/parse
 * errors are caught by the caller and treated as "no recovery."
 */
async function runEditsRetry(args) {
    const { plannerProvider, config, currentPlan, failures } = args;
    const supported = await plannerProvider.checkStructuredOutputSupport();
    const useStructured = supported;
    const prompt = buildEditsRetryPrompt(currentPlan, failures.map((f) => ({
        edit: f.edit,
        reason: f.reason,
        section_searched: f.section_searched,
        diagnostic: f.diagnostic,
    })), useStructured);
    // Use a minimal JSON schema for the retry — only `edits` array. We lift
    // the EditsRevisionJsonSchema's `edits` block by using the full schema
    // and then ignoring the `responses` field (the planner is asked to omit
    // it). For simplicity reuse the full edits schema; the retry prompt
    // explicitly tells the planner not to include `responses`.
    const jsonSchema = getRevisionJsonSchema("detail", "edits");
    const promptChars = prompt.length;
    const promptLines = prompt.split("\n").length;
    const options = useStructured
        ? {
            cwd: args.cwd,
            model: config.planner.model,
            effort: config.planner.effort,
            jsonSchema,
        }
        : {
            cwd: args.cwd,
            model: config.planner.model,
            effort: config.planner.effort,
        };
    const response = await plannerProvider.invoke(prompt, options);
    const attemptRecord = {
        mode: useStructured ? "structured" : "prompted",
        provider: plannerProvider.name,
        model: config.planner.model ?? null,
        effort: config.planner.effort ?? null,
        prompt_chars: promptChars,
        prompt_lines: promptLines,
        output_chars: response.ok ? response.output.length : null,
        output_lines: response.ok ? response.output.split("\n").length : null,
        duration_ms: response.duration ?? 0,
        ok: false,
        error_kind: "edit-retry",
        error_exit_code: null,
    };
    if (!response.ok) {
        throw new Error(`edits retry: provider error (${response.error.kind}: ${response.error.exitCode})`);
    }
    // Parse the retry response — accept either a full edits revision (with
    // empty responses) or just an `edits` array wrapped in the standard tags.
    let edits;
    try {
        if (useStructured) {
            const parsed = JSON.parse(response.output);
            edits = extractEditsFromRetryPayload(parsed);
        }
        else {
            const json = response.output.match(/<planpong-revision>([\s\S]*?)<\/planpong-revision>/i)?.[1] ??
                response.output;
            const parsed = JSON.parse(json);
            edits = extractEditsFromRetryPayload(parsed);
        }
    }
    catch (err) {
        throw new Error(`edits retry: parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    attemptRecord.ok = true;
    return { edits, attemptRecord };
}
function extractEditsFromRetryPayload(payload) {
    if (payload &&
        typeof payload === "object" &&
        "edits" in payload &&
        Array.isArray(payload.edits)) {
        return payload.edits;
    }
    if (Array.isArray(payload))
        return payload;
    throw new Error("retry payload missing `edits` array");
}
/**
 * Heuristic response-edit consistency check.
 *
 * For each `accepted` response, look for at least one surviving edit in the
 * response's `section`. If none exists, downgrade the response action to
 * `deferred` with rationale prefixed `edit_not_applied: ...`. The plan
 * acknowledges this is heuristic (no explicit issue↔edit ID mapping in the
 * schema). False negatives are possible — an accepted response that didn't
 * require a plan change (e.g., "this was already addressed") is incorrectly
 * downgraded if no edit lands in its declared section. To reduce noise, we
 * only downgrade when there's at least one unrecoverable failure — if every
 * edit succeeded, the planner's accepts are taken at face value.
 */
function downgradeOrphanedResponses(revision, survivingEdits, unrecoverableFailures) {
    if (unrecoverableFailures.length === 0)
        return revision;
    // Build a set of sections that have at least one surviving edit.
    const editedSections = new Set(survivingEdits.map((e) => e.section.trim()));
    const downgradedResponses = revision.responses.map((resp) => {
        if (resp.action !== "accepted")
            return resp;
        // Section is not on IssueResponse; we have no per-issue section mapping
        // (R3 F2 limitation). Without that, we treat ANY surviving-edit set as
        // "the planner did some work" and only downgrade accepts when ALL edits
        // failed — i.e., the plan didn't change at all. This is conservative
        // but minimizes false-positive downgrades while still preventing the
        // worst case ("everything accepted, no edits applied").
        if (editedSections.size === 0) {
            return {
                ...resp,
                action: "deferred",
                rationale: `edit_not_applied: corresponding plan edit failed and could not be recovered. Original rationale: ${resp.rationale}`,
            };
        }
        return resp;
    });
    return { ...revision, responses: downgradedResponses };
}
/**
 * Re-persist the revision metrics file with augmented edit telemetry. The
 * state machine has already written the basic metrics file in its finally
 * block; this overwrites with the same data plus revision_mode + edit
 * counts. Fail-open — telemetry write errors never propagate.
 */
function persistRevisionMetrics(args) {
    const { cwd, session, round, metrics, telemetry } = args;
    if (!metrics)
        return;
    try {
        const augmented = {
            ...metrics,
            revision_mode: telemetry.revision_mode,
            edits_attempted: telemetry.edits_attempted,
            edits_applied: telemetry.edits_applied,
            edits_failed: telemetry.edits_failed,
            edits_retried: telemetry.edits_retried,
            edits_recovered: telemetry.edits_recovered,
            retry_invoked: telemetry.retry_invoked,
            planner_mode: "external",
        };
        writeRoundMetrics(cwd, session.id, round, "revision", augmented);
    }
    catch {
        // fail-open — telemetry never breaks the run
    }
}
/**
 * Mark the session as approved and update the plan's status line.
 */
export function finalizeApproved(session, cwd, config, issueTrajectory, totalAccepted, totalRejected, totalDeferred, startTime, initialLineCount) {
    const planPath = resolve(cwd, session.planPath);
    const round = session.currentRound;
    const elapsed = Date.now() - startTime;
    let planContent = readFileSync(planPath, "utf-8");
    const currentLines = countLines(planContent);
    const linesAdded = Math.max(0, currentLines - initialLineCount);
    const linesRemoved = Math.max(0, initialLineCount - currentLines);
    const finalStatus = buildStatusLine(session, config, issueTrajectory, totalAccepted, totalRejected, totalDeferred, linesAdded, linesRemoved, elapsed) + ` | Approved after ${round} rounds`;
    planContent = updatePlanStatusLine(planContent, finalStatus);
    planContent = planContent.replace(/\*\*Status:\*\* .*/, "**Status:** Approved");
    writeFileSync(planPath, planContent);
    session.status = "approved";
    session.planHash = hashFile(planPath);
    writeSessionState(cwd, session);
}
//# sourceMappingURL=operations.js.map