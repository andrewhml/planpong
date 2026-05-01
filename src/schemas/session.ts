import { z } from "zod";
import { ProviderConfigSchema } from "./config.js";

export const SessionSchema = z.object({
  id: z.string(),
  repoRoot: z.string(),
  planPath: z.string(),
  planPathAbsolute: z.string(),
  planner: ProviderConfigSchema,
  reviewer: ProviderConfigSchema,
  status: z.enum(["planning", "in_review", "approved", "blocked", "aborted"]),
  currentRound: z.number().int().min(0),
  startedAt: z.string(),
  planHash: z.string(),
  initialLineCount: z.number().int().optional(),
  // Persistent reviewer CLI conversation. Lets the reviewer retain
  // context (plan, its own prior critique) across rounds — round 2+
  // prompts can be a tiny "what changed" diff instead of re-loading the
  // full plan. Initial value: a UUID we generate (used directly by
  // claude reviewer); for codex reviewer it's overwritten with the
  // thread_id captured from the first invocation's --json stream.
  // `Initialized` flips after the first successful invocation; subsequent
  // calls use `--resume` (claude) or `codex exec resume <id>` (codex).
  reviewerSessionId: z.string().optional(),
  reviewerSessionInitialized: z.boolean().optional(),
  // Planner mode is sticky for the session lifetime. `external` (default)
  // routes revisions through `planpong_revise` + a planner provider;
  // `inline` routes through `planpong_record_revision` so the agent that
  // invoked /pong-review acts as the planner. Set at createSession time
  // from the config; cannot change mid-loop.
  //
  // `.default("external")` makes old session files (written before this
  // field existed) deserialize cleanly through SessionSchema.parse(). It is
  // NOT sufficient on its own: `readSessionState` skips Zod validation and
  // uses a raw `as Session` cast, so runtime normalization in core/session.ts
  // is the authoritative compatibility mechanism.
  plannerMode: z.enum(["inline", "external"]).default("external"),
});

export type Session = z.infer<typeof SessionSchema>;
