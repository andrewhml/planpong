import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Provider } from "../providers/types.js";
import type { ProviderConfig, PlanpongConfig } from "../schemas/config.js";
import type { ReviewFeedback } from "../schemas/feedback.js";
import type { PlannerRevision, IssueResponse } from "../schemas/revision.js";
import {
  buildInitialPlanPrompt,
  buildRevisionPrompt,
} from "../prompts/planner.js";
import {
  buildReviewPrompt,
  formatPriorDecisions,
} from "../prompts/reviewer.js";
import { parseFeedback, parseRevision, isConverged } from "./convergence.js";
import {
  createSession,
  writeSessionState,
  writeRoundFeedback,
  writeRoundResponse,
  readRoundFeedback,
  readRoundResponse,
} from "./session.js";
import type { Session } from "../schemas/session.js";

export interface LoopCallbacks {
  onPlanGenerated(planPath: string, content: string): Promise<void>;
  onReviewStarting(round: number): void;
  onReviewComplete(round: number, feedback: ReviewFeedback): Promise<void>;
  onRevisionStarting(round: number): void;
  onRevisionComplete(round: number, revision: PlannerRevision): Promise<void>;
  onConverged(round: number, feedback: ReviewFeedback): void;
  onMaxRoundsReached(round: number): void;
  onHashMismatch(
    planPath: string,
    autonomous: boolean,
  ): Promise<"overwrite" | "abort">;
  /** Return true to continue, false to abort */
  confirmContinue(message: string): Promise<boolean>;
}

export interface LoopOptions {
  requirements: string;
  cwd: string;
  config: PlanpongConfig;
  plannerProvider: Provider;
  reviewerProvider: Provider;
  planName?: string;
  callbacks: LoopCallbacks;
}

export interface ReviewOptions {
  planPath: string;
  cwd: string;
  config: PlanpongConfig;
  plannerProvider: Provider;
  reviewerProvider: Provider;
  callbacks: LoopCallbacks;
}

export interface RoundSeverity {
  P1: number;
  P2: number;
  P3: number;
}

export interface ReviewResult {
  status: "approved" | "max_rounds" | "aborted";
  rounds: number;
  issueTrajectory: RoundSeverity[];
  accepted: number;
  rejected: number;
  deferred: number;
  planPath: string;
  sessionId: string;
  elapsed: number;
}

function hashFile(path: string): string {
  const content = readFileSync(path, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

function resolvePlanSlug(plansDir: string, name?: string): string {
  const slug =
    name ??
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

function extractKeyDecisions(plan: string): string | null {
  const match = plan.match(
    /## Key [Dd]ecisions\s*\n([\s\S]*?)(?=\n## |\n---|\Z)/,
  );
  return match?.[1]?.trim() ?? null;
}

function countLines(text: string): number {
  return text.split("\n").length;
}

function formatRoundSeverity(round: RoundSeverity): string {
  const parts: string[] = [];
  if (round.P1 > 0) parts.push(`${round.P1}P1`);
  if (round.P2 > 0) parts.push(`${round.P2}P2`);
  if (round.P3 > 0) parts.push(`${round.P3}P3`);
  if (parts.length === 0) return "0";
  return parts.join(" ");
}

function formatTrajectory(trajectory: RoundSeverity[]): string {
  return trajectory.map(formatRoundSeverity).join(" → ");
}

function severityFromFeedback(feedback: ReviewFeedback): RoundSeverity {
  const counts: RoundSeverity = { P1: 0, P2: 0, P3: 0 };
  for (const issue of feedback.issues) {
    counts[issue.severity]++;
  }
  return counts;
}

function formatTallies(
  accepted: number,
  rejected: number,
  deferred: number,
): string {
  const parts: string[] = [];
  if (accepted > 0) parts.push(`Accepted: ${accepted}`);
  if (rejected > 0) parts.push(`Rejected: ${rejected}`);
  if (deferred > 0) parts.push(`Deferred: ${deferred}`);
  return parts.join(" | ");
}

function buildStatusLine(
  session: Session,
  config: PlanpongConfig,
  issueTrajectory: RoundSeverity[],
  accepted: number,
  rejected: number,
  deferred: number,
  linesAdded: number,
  linesRemoved: number,
  elapsed: number,
): string {
  const plannerLabel = `${config.planner.provider}(${config.planner.model ?? "default"}/${config.planner.effort ?? "default"})`;
  const reviewerLabel = `${config.reviewer.provider}(${config.reviewer.model ?? "default"}/${config.reviewer.effort ?? "default"})`;
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

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

function updatePlanStatusLine(planContent: string, statusLine: string): string {
  const lines = planContent.split("\n");
  const planpongIdx = lines.findIndex((l) => l.startsWith("**planpong:**"));

  if (planpongIdx >= 0) {
    lines[planpongIdx] = statusLine;
  } else {
    // Insert after **Status:** line
    const statusIdx = lines.findIndex((l) => l.startsWith("**Status:**"));
    if (statusIdx >= 0) {
      lines.splice(statusIdx + 1, 0, statusLine);
    } else {
      // Insert after title
      lines.splice(1, 0, "", statusLine);
    }
  }

  return lines.join("\n");
}

export async function runLoop(options: LoopOptions): Promise<void> {
  const {
    requirements,
    cwd,
    config,
    plannerProvider,
    reviewerProvider,
    planName,
    callbacks,
  } = options;

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
    throw new Error(
      `Planner failed (exit ${planResponse.exitCode}):\n${planResponse.content.slice(0, 500)}`,
    );
  }

  // Step 3: Write plan to disk
  const filename = resolvePlanSlug(plansDir, planName);
  const planPath = join(plansDir, filename);
  const relativePlanPath = relative(cwd, planPath);

  // Add initial planpong status line
  let planContent = planResponse.content;
  const initialStatusLine = `**planpong:** R0/${config.max_rounds} | ${config.planner.provider}(${config.planner.model ?? "default"}/${config.planner.effort ?? "default"}) → ${config.reviewer.provider}(${config.reviewer.model ?? "default"}/${config.reviewer.effort ?? "default"}) | Awaiting review`;
  planContent = updatePlanStatusLine(planContent, initialStatusLine);
  writeFileSync(planPath, planContent);

  const initialLineCount = countLines(planContent);

  // Create session
  const session = createSession(
    cwd,
    relativePlanPath,
    config.planner,
    config.reviewer,
    hashFile(planPath),
  );
  session.status = "in_review";
  writeSessionState(cwd, session);

  await callbacks.onPlanGenerated(planPath, planContent);

  // Step 4: Human pause
  if (config.human_in_loop) {
    const shouldContinue = await callbacks.confirmContinue(
      "Plan generated. Continue to review?",
    );
    if (!shouldContinue) {
      session.status = "aborted";
      writeSessionState(cwd, session);
      return;
    }
  }

  // Tracking stats
  const issueTrajectory: RoundSeverity[] = [];
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalDeferred = 0;

  // Review loop
  for (let round = 1; round <= config.max_rounds; round++) {
    session.currentRound = round;
    writeSessionState(cwd, session);

    // Step 5: Hash plan file
    const preHash = hashFile(planPath);

    // Step 6: Read plan from disk
    planContent = readFileSync(planPath, "utf-8");

    // Build prior decisions summary for rounds 2+
    let priorDecisions: string | null = null;
    if (round > 1) {
      const priorRounds: Array<{
        round: number;
        responses: IssueResponse[];
        issues: Array<{ id: string; severity: string; title: string }>;
      }> = [];
      for (let r = 1; r < round; r++) {
        const fb = readRoundFeedback(cwd, session.id, r);
        const resp = readRoundResponse(cwd, session.id, r);
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
      if (priorRounds.length > 0) {
        priorDecisions = formatPriorDecisions(priorRounds);
      }
    }

    // Step 7: Send to reviewer
    callbacks.onReviewStarting(round);
    const reviewPrompt = buildReviewPrompt(planContent, priorDecisions);
    const reviewResponse = await reviewerProvider.invoke(reviewPrompt, {
      cwd,
      model: config.reviewer.model,
      effort: config.reviewer.effort,
    });

    if (reviewResponse.exitCode !== 0) {
      throw new Error(
        `Reviewer failed (exit ${reviewResponse.exitCode}):\n${reviewResponse.content.slice(0, 500)}`,
      );
    }

    // Step 8: Parse feedback
    let feedback: ReviewFeedback;
    try {
      feedback = parseFeedback(reviewResponse.content);
    } catch (firstError) {
      // Retry once with corrective prompt
      const retryPrompt = `Your previous response could not be parsed. Please output ONLY a valid JSON object wrapped in <planpong-feedback> tags. The error was: ${firstError instanceof Error ? firstError.message : "parse error"}\n\nOriginal prompt:\n${reviewPrompt}`;
      const retryResponse = await reviewerProvider.invoke(retryPrompt, {
        cwd,
        model: config.reviewer.model,
        effort: config.reviewer.effort,
      });
      feedback = parseFeedback(retryResponse.content);
    }

    writeRoundFeedback(cwd, session.id, round, feedback);
    issueTrajectory.push(severityFromFeedback(feedback));

    await callbacks.onReviewComplete(round, feedback);

    // Step 9: Check convergence
    if (isConverged(feedback)) {
      const currentLines = countLines(planContent);
      const linesAdded = Math.max(0, currentLines - initialLineCount);
      const linesRemoved = Math.max(0, initialLineCount - currentLines);
      const elapsed = Date.now() - startTime;

      const finalStatus = buildStatusLine(
        session,
        config,
        issueTrajectory,
        totalAccepted,
        totalRejected,
        totalDeferred,
        linesAdded,
        linesRemoved,
        elapsed,
      )
        .replace(/^(\*\*planpong:\*\* R)\d+/, `$1${round}`)
        .replace(
          /\| Issues:.*$/,
          `| Approved after ${round} rounds | ${formatTrajectory(issueTrajectory)} → Approved | ${formatTallies(totalAccepted, totalRejected, totalDeferred)} | +${linesAdded}/-${linesRemoved} lines | ${formatDuration(elapsed)}`,
        );

      planContent = readFileSync(planPath, "utf-8");
      planContent = updatePlanStatusLine(planContent, finalStatus);
      planContent = planContent.replace(
        /\*\*Status:\*\* .*/,
        "**Status:** Approved",
      );
      writeFileSync(planPath, planContent);

      session.status = "approved";
      session.planHash = hashFile(planPath);
      writeSessionState(cwd, session);
      callbacks.onConverged(round, feedback);
      return;
    }

    // Step 10-11: Human pause for feedback review
    if (config.human_in_loop) {
      const shouldContinue = await callbacks.confirmContinue(
        `Round ${round}: ${feedback.issues.length} issues found. Continue to revision?`,
      );
      if (!shouldContinue) {
        session.status = "aborted";
        writeSessionState(cwd, session);
        return;
      }
    }

    // Step 12-13: Send to planner for revision
    callbacks.onRevisionStarting(round);
    const keyDecisions = extractKeyDecisions(planContent);
    const revisionPrompt = buildRevisionPrompt(
      planContent,
      feedback,
      keyDecisions,
      null,
    );
    const revisionResponse = await plannerProvider.invoke(revisionPrompt, {
      cwd,
      model: config.planner.model,
      effort: config.planner.effort,
    });

    if (revisionResponse.exitCode !== 0) {
      throw new Error(
        `Planner revision failed (exit ${revisionResponse.exitCode}):\n${revisionResponse.content.slice(0, 500)}`,
      );
    }

    let revision: PlannerRevision;
    try {
      revision = parseRevision(revisionResponse.content);
    } catch (firstError) {
      const retryPrompt = `Your previous response could not be parsed. Please output ONLY a valid JSON object wrapped in <planpong-revision> tags. The error was: ${firstError instanceof Error ? firstError.message : "parse error"}\n\nOriginal prompt:\n${revisionPrompt}`;
      const retryResponse = await plannerProvider.invoke(retryPrompt, {
        cwd,
        model: config.planner.model,
        effort: config.planner.effort,
      });
      revision = parseRevision(retryResponse.content);
    }

    writeRoundResponse(cwd, session.id, round, revision);

    // Tally responses
    for (const resp of revision.responses) {
      if (resp.action === "accepted") totalAccepted++;
      else if (resp.action === "rejected") totalRejected++;
      else if (resp.action === "deferred") totalDeferred++;
    }

    await callbacks.onRevisionComplete(round, revision);

    // Step 14: Check plan file hash
    const postHash = hashFile(planPath);
    if (postHash !== preHash) {
      if (!config.human_in_loop) {
        // Autonomous mode: backup + overwrite
        const backupPath = `${planPath}.bak.${round}`;
        copyFileSync(planPath, backupPath);
        process.stderr.write(
          `Warning: Plan file modified externally during round ${round}. Backup saved to ${backupPath}\n`,
        );
      } else {
        const action = await callbacks.onHashMismatch(planPath, false);
        if (action === "abort") {
          session.status = "aborted";
          writeSessionState(cwd, session);
          return;
        }
      }
    }

    // Step 15: Write updated plan
    let updatedPlan = revision.updated_plan;
    const currentLines = countLines(updatedPlan);
    const linesAdded = Math.max(0, currentLines - initialLineCount);
    const linesRemoved = Math.max(0, initialLineCount - currentLines);
    const elapsed = Date.now() - startTime;

    const statusLine = buildStatusLine(
      session,
      config,
      issueTrajectory,
      totalAccepted,
      totalRejected,
      totalDeferred,
      linesAdded,
      linesRemoved,
      elapsed,
    );
    updatedPlan = updatePlanStatusLine(updatedPlan, statusLine);
    writeFileSync(planPath, updatedPlan);
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
export async function runReviewLoop(
  options: ReviewOptions,
): Promise<ReviewResult> {
  const {
    planPath,
    cwd,
    config,
    plannerProvider,
    reviewerProvider,
    callbacks,
  } = options;

  if (!existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  const startTime = Date.now();
  const relativePlanPath = relative(cwd, planPath);
  let planContent = readFileSync(planPath, "utf-8");
  const initialLineCount = countLines(planContent);

  // Add initial planpong status line if not present
  const initialStatusLine = `**planpong:** R0/${config.max_rounds} | ${config.planner.provider}(${config.planner.model ?? "default"}/${config.planner.effort ?? "default"}) → ${config.reviewer.provider}(${config.reviewer.model ?? "default"}/${config.reviewer.effort ?? "default"}) | Awaiting review`;
  planContent = updatePlanStatusLine(planContent, initialStatusLine);
  writeFileSync(planPath, planContent);

  // Create session
  const session = createSession(
    cwd,
    relativePlanPath,
    config.planner,
    config.reviewer,
    hashFile(planPath),
  );
  session.status = "in_review";
  writeSessionState(cwd, session);

  await callbacks.onPlanGenerated(planPath, planContent);

  // Tracking stats
  const issueTrajectory: RoundSeverity[] = [];
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalDeferred = 0;

  // Review loop
  for (let round = 1; round <= config.max_rounds; round++) {
    session.currentRound = round;
    writeSessionState(cwd, session);

    const preHash = hashFile(planPath);
    planContent = readFileSync(planPath, "utf-8");

    // Build prior decisions summary for rounds 2+
    let priorDecisions: string | null = null;
    if (round > 1) {
      const priorRounds: Array<{
        round: number;
        responses: IssueResponse[];
        issues: Array<{ id: string; severity: string; title: string }>;
      }> = [];
      for (let r = 1; r < round; r++) {
        const fb = readRoundFeedback(cwd, session.id, r);
        const resp = readRoundResponse(cwd, session.id, r);
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
      if (priorRounds.length > 0) {
        priorDecisions = formatPriorDecisions(priorRounds);
      }
    }

    // Send to reviewer
    callbacks.onReviewStarting(round);
    const reviewPrompt = buildReviewPrompt(planContent, priorDecisions);
    const reviewResponse = await reviewerProvider.invoke(reviewPrompt, {
      cwd,
      model: config.reviewer.model,
      effort: config.reviewer.effort,
    });

    if (reviewResponse.exitCode !== 0) {
      throw new Error(
        `Reviewer failed (exit ${reviewResponse.exitCode}):\n${reviewResponse.content.slice(0, 500)}`,
      );
    }

    // Parse feedback
    let feedback: ReviewFeedback;
    try {
      feedback = parseFeedback(reviewResponse.content);
    } catch (firstError) {
      const retryPrompt = `Your previous response could not be parsed. Please output ONLY a valid JSON object wrapped in <planpong-feedback> tags. The error was: ${firstError instanceof Error ? firstError.message : "parse error"}\n\nOriginal prompt:\n${reviewPrompt}`;
      const retryResponse = await reviewerProvider.invoke(retryPrompt, {
        cwd,
        model: config.reviewer.model,
        effort: config.reviewer.effort,
      });
      feedback = parseFeedback(retryResponse.content);
    }

    writeRoundFeedback(cwd, session.id, round, feedback);
    issueTrajectory.push(severityFromFeedback(feedback));

    await callbacks.onReviewComplete(round, feedback);

    // Check convergence
    if (isConverged(feedback)) {
      const currentLines = countLines(planContent);
      const linesAdded = Math.max(0, currentLines - initialLineCount);
      const linesRemoved = Math.max(0, initialLineCount - currentLines);
      const elapsed = Date.now() - startTime;

      const finalStatus = buildStatusLine(
        session,
        config,
        issueTrajectory,
        totalAccepted,
        totalRejected,
        totalDeferred,
        linesAdded,
        linesRemoved,
        elapsed,
      )
        .replace(/^(\*\*planpong:\*\* R)\d+/, `$1${round}`)
        .replace(
          /\| Issues:.*$/,
          `| Approved after ${round} rounds | ${formatTrajectory(issueTrajectory)} → Approved | ${formatTallies(totalAccepted, totalRejected, totalDeferred)} | +${linesAdded}/-${linesRemoved} lines | ${formatDuration(elapsed)}`,
        );

      planContent = readFileSync(planPath, "utf-8");
      planContent = updatePlanStatusLine(planContent, finalStatus);
      planContent = planContent.replace(
        /\*\*Status:\*\* .*/,
        "**Status:** Approved",
      );
      writeFileSync(planPath, planContent);

      session.status = "approved";
      session.planHash = hashFile(planPath);
      writeSessionState(cwd, session);
      callbacks.onConverged(round, feedback);

      return {
        status: "approved",
        rounds: round,
        issueTrajectory,
        accepted: totalAccepted,
        rejected: totalRejected,
        deferred: totalDeferred,
        planPath,
        sessionId: session.id,
        elapsed,
      };
    }

    // Human pause
    if (config.human_in_loop) {
      const shouldContinue = await callbacks.confirmContinue(
        `Round ${round}: ${feedback.issues.length} issues found. Continue to revision?`,
      );
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
    const keyDecisions = extractKeyDecisions(planContent);
    const revisionPrompt = buildRevisionPrompt(
      planContent,
      feedback,
      keyDecisions,
      null,
    );
    const revisionResponse = await plannerProvider.invoke(revisionPrompt, {
      cwd,
      model: config.planner.model,
      effort: config.planner.effort,
    });

    if (revisionResponse.exitCode !== 0) {
      throw new Error(
        `Planner revision failed (exit ${revisionResponse.exitCode}):\n${revisionResponse.content.slice(0, 500)}`,
      );
    }

    let revision: PlannerRevision;
    try {
      revision = parseRevision(revisionResponse.content);
    } catch (firstError) {
      const retryPrompt = `Your previous response could not be parsed. Please output ONLY a valid JSON object wrapped in <planpong-revision> tags. The error was: ${firstError instanceof Error ? firstError.message : "parse error"}\n\nOriginal prompt:\n${revisionPrompt}`;
      const retryResponse = await plannerProvider.invoke(retryPrompt, {
        cwd,
        model: config.planner.model,
        effort: config.planner.effort,
      });
      revision = parseRevision(retryResponse.content);
    }

    writeRoundResponse(cwd, session.id, round, revision);

    for (const resp of revision.responses) {
      if (resp.action === "accepted") totalAccepted++;
      else if (resp.action === "rejected") totalRejected++;
      else if (resp.action === "deferred") totalDeferred++;
    }

    await callbacks.onRevisionComplete(round, revision);

    // Check plan file hash
    const postHash = hashFile(planPath);
    if (postHash !== preHash) {
      if (!config.human_in_loop) {
        const backupPath = `${planPath}.bak.${round}`;
        copyFileSync(planPath, backupPath);
        process.stderr.write(
          `Warning: Plan file modified externally during round ${round}. Backup saved to ${backupPath}\n`,
        );
      } else {
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

    // Write updated plan
    let updatedPlan = revision.updated_plan;
    const currentLines = countLines(updatedPlan);
    const linesAdded = Math.max(0, currentLines - initialLineCount);
    const linesRemoved = Math.max(0, initialLineCount - currentLines);
    const elapsed = Date.now() - startTime;

    const statusLine = buildStatusLine(
      session,
      config,
      issueTrajectory,
      totalAccepted,
      totalRejected,
      totalDeferred,
      linesAdded,
      linesRemoved,
      elapsed,
    );
    updatedPlan = updatePlanStatusLine(updatedPlan, statusLine);
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
