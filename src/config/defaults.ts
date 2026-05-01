import type { PlanpongConfig } from "../schemas/config.js";

export const DEFAULT_CONFIG: PlanpongConfig = {
  planner: {
    provider: "claude",
  },
  reviewer: {
    provider: "codex",
  },
  plans_dir: "docs/plans",
  max_rounds: 10,
  human_in_loop: true,
  revision_mode: "full",
  planner_mode: "external",
};
