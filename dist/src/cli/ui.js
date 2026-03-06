import chalk from "chalk";
import ora from "ora";
const SEVERITY_COLORS = {
    P1: chalk.red.bold,
    P2: chalk.yellow,
    P3: chalk.blue,
};
const ACTION_COLORS = {
    accepted: chalk.green,
    rejected: chalk.red,
    deferred: chalk.yellow,
};
export function printBanner() {
    console.log(chalk.bold("\nplanpong") + chalk.dim(" — multi-model plan review\n"));
}
export function printPlanGenerated(planPath) {
    console.log(chalk.green("Plan written to:"), planPath);
}
export function createSpinner(text) {
    return ora({ text, color: "cyan" }).start();
}
export function printFeedbackSummary(round, feedback) {
    const verdictColor = feedback.verdict === "needs_revision" ? chalk.yellow : chalk.green;
    console.log(`\n${chalk.bold(`Round ${round} Review`)} — ${verdictColor(feedback.verdict)}`);
    console.log(chalk.dim(feedback.summary));
    if (feedback.issues.length === 0) {
        console.log(chalk.green("  No issues found."));
        return;
    }
    console.log();
    for (const issue of feedback.issues) {
        printIssue(issue);
    }
}
function printIssue(issue) {
    const colorFn = SEVERITY_COLORS[issue.severity] ?? chalk.white;
    console.log(`  ${colorFn(issue.severity)} ${chalk.bold(issue.id)}: ${issue.title}`);
    console.log(chalk.dim(`       ${issue.section}`));
}
export function printRevisionSummary(round, revision) {
    console.log(`\n${chalk.bold(`Round ${round} Revision`)}`);
    for (const resp of revision.responses) {
        const colorFn = ACTION_COLORS[resp.action] ?? chalk.white;
        const action = colorFn(resp.action.toUpperCase());
        const rationale = resp.rationale.length > 100
            ? resp.rationale.slice(0, 100) + "..."
            : resp.rationale;
        let line = `  ${resp.issue_id}: ${action}`;
        if (resp.severity_dispute) {
            line += chalk.magenta(` (${resp.severity_dispute.original}→${resp.severity_dispute.revised})`);
        }
        console.log(line);
        console.log(chalk.dim(`       ${rationale}`));
    }
}
export function printConverged(round) {
    console.log(chalk.green.bold(`\nPlan approved after ${round} round${round === 1 ? "" : "s"}.`));
}
export function printMaxRounds(maxRounds) {
    console.log(chalk.yellow(`\nMax rounds (${maxRounds}) reached without convergence. Review the plan manually.`));
}
export function printAborted() {
    console.log(chalk.dim("\nAborted by user."));
}
//# sourceMappingURL=ui.js.map