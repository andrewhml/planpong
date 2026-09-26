import { Command } from "commander";
import { registerPlanCommand } from "./commands/plan.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerInitCommand } from "./commands/init.js";
import { findPlanpongPackageJson } from "../runtime/node-guard.js";
// Read version from the installed package.json so `planpong --version`
// always reflects the actual installed version. Hardcoding it here
// drifts every time we cut a release. The lookup walks up to the
// package.json named "planpong", which works from tsx, dist/, and an
// installed package alike.
function readPackageVersion() {
    const version = findPlanpongPackageJson(import.meta.url)?.pkg.version;
    return typeof version === "string" ? version : "0.0.0";
}
const program = new Command();
program
    .name("planpong")
    .description("Multi-model plan review CLI — orchestrates AI agents for adversarial plan refinement")
    .version(readPackageVersion())
    .addHelpText("after", `
Quick reference:
  planpong init                Interactive first-run setup wizard
  planpong config              Show current config values and sources
  planpong config keys         List all settings with valid values and defaults
  planpong config providers    List per-provider model and effort values
  planpong config get <key>    Get a single setting
  planpong config set <key> <value>  Change a setting
  planpong config unset <key>  Remove a setting (model/effort: use the CLI's default)

  planpong review <plan-file>  Start adversarial review of a plan
  planpong plan <requirements> Generate a plan and review it`);
registerPlanCommand(program);
registerReviewCommand(program);
registerConfigCommand(program);
registerInitCommand(program);
// Actions are async (config set/providers, init, review, plan); parseAsync
// awaits them so a rejected action surfaces instead of floating.
await program.parseAsync();
//# sourceMappingURL=main.js.map