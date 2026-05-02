#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { registerPlanCommand } from "../src/cli/commands/plan.js";
import { registerReviewCommand } from "../src/cli/commands/review.js";
import { registerConfigCommand } from "../src/cli/commands/config.js";

// Read version from the installed package.json so `planpong --version`
// always reflects the actual installed version. Hardcoding it here
// drifts every time we cut a release.
//
// Resolution differs between compiled (`dist/bin/planpong.js` — package
// root is two levels up) and dev mode (`bin/planpong.ts` via tsx —
// package root is one level up). Walk up until we find a package.json
// whose `name` is "planpong".
function readPackageVersion(): string {
  try {
    let here = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
      const candidate = join(here, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "planpong" && typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch {
        // candidate doesn't exist or isn't readable — keep walking up
      }
      const parent = dirname(here);
      if (parent === here) break;
      here = parent;
    }
  } catch {
    // fall through to fallback
  }
  return "0.0.0";
}

const program = new Command();

program
  .name("planpong")
  .description(
    "Multi-model plan review CLI — orchestrates AI agents for adversarial plan refinement",
  )
  .version(readPackageVersion())
  .addHelpText(
    "after",
    `
Quick reference:
  planpong config              Show current config values and sources
  planpong config keys         List all settings with valid values and defaults
  planpong config get <key>    Get a single setting
  planpong config set <key> <value>  Change a setting

  planpong review <plan-file>  Start adversarial review of a plan
  planpong plan <requirements> Generate a plan and review it`,
  );

registerPlanCommand(program);
registerReviewCommand(program);
registerConfigCommand(program);

program.parse();
