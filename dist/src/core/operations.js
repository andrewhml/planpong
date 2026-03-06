import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { buildRevisionPrompt } from "../prompts/planner.js";
import { buildReviewPrompt, formatPriorDecisions, } from "../prompts/reviewer.js";
import { parseFeedback, parseRevision, isConverged } from "./convergence.js";
import { createSession, writeSessionState, writeRoundFeedback, writeRoundResponse, readRoundFeedback, readRoundResponse, writeInitialPlan, } from "./session.js";
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
export function buildStatusLine(session, config, issueTrajectory, accepted, rejected, deferred, linesAdded, linesRemoved, elapsed) {
    const plannerLabel = formatProviderLabel(config.planner);
    const reviewerLabel = formatProviderLabel(config.reviewer);
    const trajectory = formatTrajectory(issueTrajectory);
    const tallies = formatTallies(accepted, rejected, deferred);
    const elapsedStr = formatDuration(elapsed);
    const parts = [
        `**planpong:** R${session.currentRound}/${config.max_rounds}`,
        `${plannerLabel} → ${reviewerLabel}`,
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
export function writeStatusLineToPlan(session, cwd, config, suffix) {
    const planPath = resolve(cwd, session.planPath);
    let planContent = readFileSync(planPath, "utf-8");
    const stats = computeSessionStats(cwd, session.id, session.currentRound);
    const elapsed = Date.now() - new Date(session.startedAt).getTime();
    const currentLines = countLines(planContent);
    const initialLines = session.initialLineCount ?? currentLines;
    const linesAdded = Math.max(0, currentLines - initialLines);
    const linesRemoved = Math.max(0, initialLines - currentLines);
    const statusLine = buildStatusLine(session, config, stats.issueTrajectory, stats.totalAccepted, stats.totalRejected, stats.totalDeferred, linesAdded, linesRemoved, elapsed) + (suffix ? ` | ${suffix}` : "");
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
    const session = createSession(cwd, relativePlanPath, config.planner, config.reviewer, hashFile(planPath));
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
 * Run a single review round: send current plan to the reviewer for critique.
 */
export async function runReviewRound(session, cwd, config, reviewerProvider) {
    const round = session.currentRound;
    const planPath = resolve(cwd, session.planPath);
    const planContent = readFileSync(planPath, "utf-8");
    const priorDecisions = buildPriorDecisions(cwd, session.id, round);
    const reviewPrompt = buildReviewPrompt(planContent, priorDecisions);
    const reviewResponse = await reviewerProvider.invoke(reviewPrompt, {
        cwd,
        model: config.reviewer.model,
        effort: config.reviewer.effort,
    });
    // Try to parse even on non-zero exit — CLIs can exit 1 with valid output
    let feedback;
    try {
        feedback = parseFeedback(reviewResponse.content);
    }
    catch (parseError) {
        // If exit code was also non-zero, the provider genuinely failed
        if (reviewResponse.exitCode !== 0) {
            throw new Error(`Reviewer failed (exit ${reviewResponse.exitCode}):\n${reviewResponse.content.slice(0, 500)}`);
        }
        // Exit was 0 but parse failed — retry
        const retryPrompt = `Your previous response could not be parsed. Please output ONLY a valid JSON object wrapped in <planpong-feedback> tags. The error was: ${parseError instanceof Error ? parseError.message : "parse error"}\n\nOriginal prompt:\n${reviewPrompt}`;
        const retryResponse = await reviewerProvider.invoke(retryPrompt, {
            cwd,
            model: config.reviewer.model,
            effort: config.reviewer.effort,
        });
        feedback = parseFeedback(retryResponse.content);
    }
    writeRoundFeedback(cwd, session.id, round, feedback);
    const severity = severityFromFeedback(feedback);
    const converged = isConverged(feedback);
    return { round, feedback, severity, converged };
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
    const keyDecisions = extractKeyDecisions(planContent);
    const revisionPrompt = buildRevisionPrompt(planContent, feedback, keyDecisions, null);
    const revisionResponse = await plannerProvider.invoke(revisionPrompt, {
        cwd,
        model: config.planner.model,
        effort: config.planner.effort,
    });
    // Try to parse even on non-zero exit — CLIs can exit 1 with valid output
    let revision;
    try {
        revision = parseRevision(revisionResponse.content);
    }
    catch (parseError) {
        // If exit code was also non-zero, the provider genuinely failed
        if (revisionResponse.exitCode !== 0) {
            throw new Error(`Planner revision failed (exit ${revisionResponse.exitCode}):\n${revisionResponse.content.slice(0, 500)}`);
        }
        // Exit was 0 but parse failed — retry
        const retryPrompt = `Your previous response could not be parsed. Please output ONLY a valid JSON object wrapped in <planpong-revision> tags. The error was: ${parseError instanceof Error ? parseError.message : "parse error"}\n\nOriginal prompt:\n${revisionPrompt}`;
        const retryResponse = await plannerProvider.invoke(retryPrompt, {
            cwd,
            model: config.planner.model,
            effort: config.planner.effort,
        });
        revision = parseRevision(retryResponse.content);
    }
    writeRoundResponse(cwd, session.id, round, revision);
    // Tally responses
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    for (const resp of revision.responses) {
        if (resp.action === "accepted")
            accepted++;
        else if (resp.action === "rejected")
            rejected++;
        else if (resp.action === "deferred")
            deferred++;
    }
    // Write updated plan to disk
    const updatedPlan = revision.updated_plan;
    writeFileSync(planPath, updatedPlan);
    session.planHash = hashFile(planPath);
    writeSessionState(cwd, session);
    return {
        round,
        revision,
        accepted,
        rejected,
        deferred,
        planUpdated: true,
    };
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