#!/usr/bin/env npx tsx
import { Command } from "commander";
import { registerPlanCommand } from "../src/cli/commands/plan.js";
import { registerReviewCommand } from "../src/cli/commands/review.js";

const program = new Command();

program
  .name("planpong")
  .description(
    "Multi-model plan review CLI — orchestrates AI agents for adversarial plan refinement",
  )
  .version("0.1.0");

registerPlanCommand(program);
registerReviewCommand(program);

program.parse();
