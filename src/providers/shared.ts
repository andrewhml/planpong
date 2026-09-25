import type { InvokeOptions, ModelCatalog, ModelInfo } from "./types.js";

/**
 * Reject the impossible state where a caller asks the provider to both
 * initialize a fresh session AND resume an existing one. The operations-layer
 * state machine never passes both today, so this is purely defensive — but
 * all providers throw the same error so the parity is uniform.
 */
export function assertMutuallyExclusiveSessions(
  providerName: string,
  options: InvokeOptions,
): void {
  if (options.newSessionId && options.resumeSessionId) {
    throw new Error(
      `${providerName} provider: newSessionId and resumeSessionId are mutually exclusive`,
    );
  }
}

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;
const STACK_FRAME_PATTERN = /^\s+at\s/;
const ERROR_LINE_PATTERN =
  /error|fail|denied|unsupported|invalid|not (?:found|supported)/i;

/**
 * Reduce CLI error output to the line a human needs. CLIs print banners and
 * warnings first and stack traces last, so the head of stderr (what we used
 * to keep) is usually noise. Strategy: strip ANSI codes and stack frames,
 * return the last line that reads like an error, else the tail. The full
 * text stays on `ProviderError.stderr` for debugging.
 */
export function summarizeStderr(text: string, max = 800): string {
  const lines = text
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .filter((line) => line.trim().length > 0 && !STACK_FRAME_PATTERN.test(line));
  for (let i = lines.length - 1; i >= 0; i--) {
    if (ERROR_LINE_PATTERN.test(lines[i])) {
      return lines[i].trim().slice(0, max);
    }
  }
  const tail = lines.join("\n").trim();
  return tail.length > max ? tail.slice(tail.length - max) : tail;
}

/**
 * Emit a single-line debug breadcrumb when a provider invocation produces no
 * usable output and is about to be classified as a failure. Matches the
 * `[<provider>-provider] exit=<code> stderr=<truncated>` format originally
 * added to the claude provider so triage logs read the same regardless of
 * which CLI failed.
 */
export function logClassificationFailure(
  providerName: string,
  exitCode: number,
  stderr: string | undefined,
): void {
  process.stderr.write(
    `[${providerName}-provider] exit=${exitCode} stderr=${summarizeStderr(stderr ?? "").replace(/\n/g, " | ")}\n`,
  );
}

/**
 * Build a catalog from per-model effort lists. `efforts` is the
 * intersection across models that report efforts (safe for whichever model
 * the CLI picks by default); `allEfforts` is the union. Order follows the
 * first model that lists each level.
 */
export function buildCatalog(
  source: ModelCatalog["source"],
  models: ModelInfo[],
  options: { advisories?: Record<string, string>; note?: string } = {},
): ModelCatalog {
  const withEfforts = models.filter((m) => m.efforts.length > 0);
  const allEfforts: string[] = [];
  for (const m of withEfforts) {
    for (const e of m.efforts) if (!allEfforts.includes(e)) allEfforts.push(e);
  }
  const efforts = allEfforts.filter((e) =>
    withEfforts.every((m) => m.efforts.includes(e)),
  );
  return {
    source,
    models,
    efforts,
    allEfforts,
    advisories: options.advisories ?? {},
    ...(options.note ? { note: options.note } : {}),
  };
}
