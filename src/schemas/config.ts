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
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type PlanpongConfig = z.infer<typeof PlanpongConfigSchema>;
