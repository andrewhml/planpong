#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { registerPlanCommand } from "../src/cli/commands/plan.js";
import { registerReviewCommand } from "../src/cli/commands/review.js";
// Read version from the installed package.json so `planpong --version`
// always reflects the actual installed version. Hardcoding it here
// drifts every time we cut a release.
//
// Resolution differs between compiled (`dist/bin/planpong.js` — package
// root is two levels up) and dev mode (`bin/planpong.ts` via tsx —
// package root is one level up). Walk up until we find a package.json
// whose `name` is "planpong".
function readPackageVersion() {
    try {
        let here = dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 5; i++) {
            const candidate = join(here, "package.json");
            try {
                const pkg = JSON.parse(readFileSync(candidate, "utf-8"));
                if (pkg.name === "planpong" && typeof pkg.version === "string") {
                    return pkg.version;
                }
            }
            catch {
                // candidate doesn't exist or isn't readable — keep walking up
            }
            const parent = dirname(here);
            if (parent === here)
                break;
            here = parent;
        }
    }
    catch {
        // fall through to fallback
    }
    return "0.0.0";
}
const program = new Command();
program
    .name("planpong")
    .description("Multi-model plan review CLI — orchestrates AI agents for adversarial plan refinement")
    .version(readPackageVersion());
registerPlanCommand(program);
registerReviewCommand(program);
program.parse();
//# sourceMappingURL=planpong.js.map