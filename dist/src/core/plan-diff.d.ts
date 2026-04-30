/**
 * Tiny line-level diff for plan revisions.
 *
 * Used to build "what changed since you last saw it" snippets for resumed
 * provider sessions — instead of re-sending the whole plan markdown to the
 * reviewer or planner on round 2+, we send just the modified lines plus a
 * few lines of context.
 *
 * Not a full unified-diff implementation. The output is a markdown-friendly
 * change summary, not a patch that can be reapplied. The model only needs
 * to understand "this is what's different now."
 */
/**
 * Compute a compact, human-readable diff between two plan markdown texts.
 *
 * Algorithm: line-level Myers-style LCS, then group runs of equal /
 * different lines into blocks. The output is markdown — code-fenced sections
 * with `~` (removed) and `+` (added) prefixes and `>` for context.
 *
 * If the two texts are identical, returns "(no changes)" so the caller can
 * detect a no-op revision.
 */
export declare function buildPlanDiff(prev: string, next: string): string;
