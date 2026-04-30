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

interface Block {
  type: "context" | "removed" | "added";
  lines: string[];
}

const CONTEXT_LINES = 2;

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
export function buildPlanDiff(prev: string, next: string): string {
  if (prev === next) return "(no changes)";

  const a = prev.split("\n");
  const b = next.split("\n");

  // Compute longest-common-subsequence table (line-level).
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  // Walk the table to produce a sequence of operations.
  const ops: Array<{ kind: "eq" | "del" | "add"; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "eq", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "del", line: a[i] });
      i++;
    } else {
      ops.push({ kind: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++] });
  while (j < m) ops.push({ kind: "add", line: b[j++] });

  // Group into hunks: a hunk starts at the first non-eq op and ends after
  // the last non-eq op, with CONTEXT_LINES of equal lines on each side.
  const hunks: Array<Block[]> = [];
  let current: Block[] | null = null;
  let lastChangeIdx = -1;

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.kind === "eq") {
      if (current && k - lastChangeIdx <= CONTEXT_LINES) {
        // still within trailing context
        const last = current[current.length - 1];
        if (last && last.type === "context") last.lines.push(op.line);
        else current.push({ type: "context", lines: [op.line] });
      }
    } else {
      // change op — open or extend a hunk
      if (!current) {
        current = [];
        // Add up to CONTEXT_LINES preceding context
        const ctx: string[] = [];
        for (
          let p = k - 1;
          p >= 0 && ctx.length < CONTEXT_LINES && ops[p].kind === "eq";
          p--
        ) {
          ctx.unshift(ops[p].line);
        }
        if (ctx.length) current.push({ type: "context", lines: ctx });
      }
      const lastBlock = current[current.length - 1];
      const blockType = op.kind === "del" ? "removed" : "added";
      if (lastBlock && lastBlock.type === blockType) {
        lastBlock.lines.push(op.line);
      } else {
        current.push({ type: blockType, lines: [op.line] });
      }
      lastChangeIdx = k;
    }
    // Decide whether to close the current hunk: if we've seen CONTEXT_LINES
    // equal lines AND the next CONTEXT_LINES ops are also equal, close.
    if (current && op.kind === "eq" && k - lastChangeIdx > CONTEXT_LINES) {
      // peek ahead
      let allEqAhead = true;
      for (let p = k + 1; p < Math.min(ops.length, k + 1 + CONTEXT_LINES); p++) {
        if (ops[p].kind !== "eq") {
          allEqAhead = false;
          break;
        }
      }
      if (allEqAhead) {
        hunks.push(current);
        current = null;
      }
    }
  }
  if (current) hunks.push(current);

  // Render hunks.
  const rendered = hunks
    .map((blocks) =>
      blocks
        .map((block) => {
          const prefix =
            block.type === "context" ? "  " : block.type === "removed" ? "- " : "+ ";
          return block.lines.map((l) => `${prefix}${l}`).join("\n");
        })
        .join("\n"),
    )
    .join("\n  ...\n");

  return `\`\`\`diff\n${rendered}\n\`\`\``;
}
