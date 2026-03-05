import { z } from "zod";
import { ProviderConfigSchema } from "./config.js";

export const SessionSchema = z.object({
  id: z.string(),
  repoRoot: z.string(),
  planPath: z.string(),
  planPathAbsolute: z.string(),
  planner: ProviderConfigSchema,
  reviewer: ProviderConfigSchema,
  status: z.enum(["planning", "in_review", "approved", "aborted"]),
  currentRound: z.number().int().min(0),
  startedAt: z.string(),
  planHash: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;
