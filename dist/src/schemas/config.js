import { z } from "zod";
export const ProviderConfigSchema = z.object({
    provider: z.string(),
    model: z.string().optional(),
    effort: z.string().optional(),
});
export const PlanpongConfigSchema = z.object({
    planner: ProviderConfigSchema,
    reviewer: ProviderConfigSchema,
    plans_dir: z.string().default("docs/plans"),
    max_rounds: z.number().int().min(1).max(50).default(10),
    human_in_loop: z.boolean().default(true),
    // Initial release defaults to `"full"`. Edits mode is opt-in via
    // planpong.yaml until benchmark thresholds (first-pass success ≥80%,
    // retry rate <30%, no rounds increase) are confirmed. `"full"` is the
    // kill switch — risk + detail phases use the direction-phase schema and
    // skip the edit applier entirely.
    revision_mode: z.enum(["edits", "full"]).default("full"),
});
//# sourceMappingURL=config.js.map