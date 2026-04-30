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
});
//# sourceMappingURL=session.js.map