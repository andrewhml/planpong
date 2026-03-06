import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildInitialPlanPrompt } from "../prompts/planner.js";
import { createSession, writeSessionState } from "./session.js";
import { hashFile, buildStatusLine, updatePlanStatusLine, formatProviderLabel, initReviewSession, runReviewRound, runRevisionRound, finalizeApproved, } from "./operations.js";
function resolvePlanSlug(plansDir, name) {
    const slug = name ??
        `plan-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
    let filename = `${slug}.md`;
    let fullPath = join(plansDir, filename);
    let counter = 2;
    while (existsSync(fullPath)) {
        filename = `${slug}-${counter}.md`;
        fullPath = join(plansDir, filename);
        counter++;
    }
    return filename;
}
function countLines(text) {
    return text.split("\n").length;
}
export async function runLoop(options) {
    const { requirements, cwd, config, plannerProvider, reviewerProvider, planName, callbacks, } = options;
    const plansDir = join(cwd, config.plans_dir);
    if (!existsSync(plansDir)) {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(plansDir, { recursive: true });
    }
    const startTime = Date.now();
    // Step 1-2: Generate initial plan
    const planPrompt = buildInitialPlanPrompt(requirements, config.plans_dir);
    const planResponse = await plannerProvider.invoke(planPrompt, {
        cwd,
        model: config.planner.model,
        effort: config.planner.effort,
    });
    if (planResponse.exitCode !== 0) {
        throw new Error(`Planner failed (exit ${planResponse.exitCode}):\n${planResponse.content.slice(0, 500)}`);
    }
    // Step 3: Write plan to disk
    const filename = resolvePlanSlug(plansDir, planName);
    const planPath = join(plansDir, filename);
    const relativePlanPath = relative(cwd, planPath);
    let planContent = planResponse.content;
    const initialStatusLine = `**planpong:** R0/${config.max_rounds} | ${formatProviderLabel(config.planner)} → ${formatProviderLabel(config.reviewer)} | Awaiting review`;
    planContent = updatePlanStatusLine(planContent, initialStatusLine);
    writeFileSync(planPath, planContent);
    const initialLineCount = countLines(planContent);
    const session = createSession(cwd, relativePlanPath, config.planner, config.reviewer, hashFile(planPath));
    session.status = "in_review";
    writeSessionState(cwd, session);
    await callbacks.onPlanGenerated(planPath, planContent);
    // Step 4: Human pause
    if (config.human_in_loop) {
        const shouldContinue = await callbacks.confirmContinue("Plan generated. Continue to review?");
        if (!shouldContinue) {
            session.status = "aborted";
            writeSessionState(cwd, session);
            return;
        }
    }
    // Tracking stats
    const issueTrajectory = [];
    let totalAccepted = 0;
    let totalRejected = 0;
    let totalDeferred = 0;
    // Review loop
    for (let round = 1; round <= config.max_rounds; round++) {
        session.currentRound = round;
        writeSessionState(cwd, session);
        const preHash = hashFile(planPath);
        // Send to reviewer
        callbacks.onReviewStarting(round);
        const reviewResult = await runReviewRound(session, cwd, config, reviewerProvider);
        issueTrajectory.push(reviewResult.severity);
        await callbacks.onReviewComplete(round, reviewResult.feedback);
        // Check convergence
        if (reviewResult.converged) {
            finalizeApproved(session, cwd, config, issueTrajectory, totalAccepted, totalRejected, totalDeferred, startTime, initialLineCount);
            callbacks.onConverged(round, reviewResult.feedback);
            return;
        }
        // Human pause
        if (config.human_in_loop) {
            const shouldContinue = await callbacks.confirmContinue(`Round ${round}: ${reviewResult.feedback.issues.length} issues found. Continue to revision?`);
            if (!shouldContinue) {
                session.status = "aborted";
                writeSessionState(cwd, session);
                return;
            }
        }
        // Send to planner for revision
        callbacks.onRevisionStarting(round);
        const revisionResult = await runRevisionRound(session, cwd, config, plannerProvider);
        totalAccepted += revisionResult.accepted;
        totalRejected += revisionResult.rejected;
        totalDeferred += revisionResult.deferred;
        await callbacks.onRevisionComplete(round, revisionResult.revision);
        // Check plan file hash (external modification detection)
        const postHash = hashFile(planPath);
        if (postHash !== preHash) {
            if (!config.human_in_loop) {
                const backupPath = `${planPath}.bak.${round}`;
                copyFileSync(planPath, backupPath);
                process.stderr.write(`Warning: Plan file modified externally during round ${round}. Backup saved to ${backupPath}\n`);
            }
            else {
                const action = await callbacks.onHashMismatch(planPath, false);
                if (action === "abort") {
                    session.status = "aborted";
                    writeSessionState(cwd, session);
                    return;
                }
            }
        }
        // Update status line in plan
        planContent = readFileSync(planPath, "utf-8");
        const currentLines = countLines(planContent);
        const linesAdded = Math.max(0, currentLines - initialLineCount);
        const linesRemoved = Math.max(0, initialLineCount - currentLines);
        const elapsed = Date.now() - startTime;
        const statusLine = buildStatusLine(session, config, issueTrajectory, totalAccepted, totalRejected, totalDeferred, linesAdded, linesRemoved, elapsed);
        planContent = updatePlanStatusLine(planContent, statusLine);
        writeFileSync(planPath, planContent);
        session.planHash = hashFile(planPath);
        writeSessionState(cwd, session);
    }
    // Max rounds reached
    callbacks.onMaxRoundsReached(config.max_rounds);
    session.status = "aborted";
    writeSessionState(cwd, session);
}
/**
 * Review an existing plan file through adversarial refinement.
 * Skips plan generation — starts directly at the review cycle.
 * Returns structured result for programmatic consumption.
 */
export async function runReviewLoop(options) {
    const { planPath, cwd, config, plannerProvider, reviewerProvider, callbacks, } = options;
    const startTime = Date.now();
    const { session, planContent } = initReviewSession(planPath, cwd, config);
    const initialLineCount = countLines(planContent);
    await callbacks.onPlanGenerated(planPath, planContent);
    // Tracking stats
    const issueTrajectory = [];
    let totalAccepted = 0;
    let totalRejected = 0;
    let totalDeferred = 0;
    // Review loop
    for (let round = 1; round <= config.max_rounds; round++) {
        session.currentRound = round;
        writeSessionState(cwd, session);
        const preHash = hashFile(planPath);
        // Send to reviewer
        callbacks.onReviewStarting(round);
        const reviewResult = await runReviewRound(session, cwd, config, reviewerProvider);
        issueTrajectory.push(reviewResult.severity);
        await callbacks.onReviewComplete(round, reviewResult.feedback);
        // Check convergence
        if (reviewResult.converged) {
            finalizeApproved(session, cwd, config, issueTrajectory, totalAccepted, totalRejected, totalDeferred, startTime, initialLineCount);
            callbacks.onConverged(round, reviewResult.feedback);
            return {
                status: "approved",
                rounds: round,
                issueTrajectory,
                accepted: totalAccepted,
                rejected: totalRejected,
                deferred: totalDeferred,
                planPath,
                sessionId: session.id,
                elapsed: Date.now() - startTime,
            };
        }
        // Human pause
        if (config.human_in_loop) {
            const shouldContinue = await callbacks.confirmContinue(`Round ${round}: ${reviewResult.feedback.issues.length} issues found. Continue to revision?`);
            if (!shouldContinue) {
                session.status = "aborted";
                writeSessionState(cwd, session);
                return {
                    status: "aborted",
                    rounds: round,
                    issueTrajectory,
                    accepted: totalAccepted,
                    rejected: totalRejected,
                    deferred: totalDeferred,
                    planPath,
                    sessionId: session.id,
                    elapsed: Date.now() - startTime,
                };
            }
        }
        // Send to planner for revision
        callbacks.onRevisionStarting(round);
        const revisionResult = await runRevisionRound(session, cwd, config, plannerProvider);
        totalAccepted += revisionResult.accepted;
        totalRejected += revisionResult.rejected;
        totalDeferred += revisionResult.deferred;
        await callbacks.onRevisionComplete(round, revisionResult.revision);
        // Check plan file hash
        const postHash = hashFile(planPath);
        if (postHash !== preHash) {
            if (!config.human_in_loop) {
                const backupPath = `${planPath}.bak.${round}`;
                copyFileSync(planPath, backupPath);
                process.stderr.write(`Warning: Plan file modified externally during round ${round}. Backup saved to ${backupPath}\n`);
            }
            else {
                const action = await callbacks.onHashMismatch(planPath, false);
                if (action === "abort") {
                    session.status = "aborted";
                    writeSessionState(cwd, session);
                    return {
                        status: "aborted",
                        rounds: round,
                        issueTrajectory,
                        accepted: totalAccepted,
                        rejected: totalRejected,
                        deferred: totalDeferred,
                        planPath,
                        sessionId: session.id,
                        elapsed: Date.now() - startTime,
                    };
                }
            }
        }
        // Update status line in plan
        const currentPlan = readFileSync(planPath, "utf-8");
        const currentLines = countLines(currentPlan);
        const linesAdded = Math.max(0, currentLines - initialLineCount);
        const linesRemoved = Math.max(0, initialLineCount - currentLines);
        const elapsed = Date.now() - startTime;
        const statusLine = buildStatusLine(session, config, issueTrajectory, totalAccepted, totalRejected, totalDeferred, linesAdded, linesRemoved, elapsed);
        const updatedPlan = updatePlanStatusLine(currentPlan, statusLine);
        writeFileSync(planPath, updatedPlan);
        session.planHash = hashFile(planPath);
        writeSessionState(cwd, session);
    }
    // Max rounds reached
    callbacks.onMaxRoundsReached(config.max_rounds);
    session.status = "aborted";
    writeSessionState(cwd, session);
    return {
        status: "max_rounds",
        rounds: config.max_rounds,
        issueTrajectory,
        accepted: totalAccepted,
        rejected: totalRejected,
        deferred: totalDeferred,
        planPath,
        sessionId: session.id,
        elapsed: Date.now() - startTime,
    };
}
//# sourceMappingURL=loop.js.map