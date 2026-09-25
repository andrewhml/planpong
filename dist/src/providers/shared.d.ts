import type { InvokeOptions } from "./types.js";
/**
 * Reject the impossible state where a caller asks the provider to both
 * initialize a fresh session AND resume an existing one. The operations-layer
 * state machine never passes both today, so this is purely defensive — but
 * all providers throw the same error so the parity is uniform.
 */
export declare function assertMutuallyExclusiveSessions(providerName: string, options: InvokeOptions): void;
/**
 * Reduce CLI error output to the line a human needs. CLIs print banners and
 * warnings first and stack traces last, so the head of stderr (what we used
 * to keep) is usually noise. Strategy: strip ANSI codes and stack frames,
 * return the last line that reads like an error, else the tail. The full
 * text stays on `ProviderError.stderr` for debugging.
 */
export declare function summarizeStderr(text: string, max?: number): string;
/**
 * Emit a single-line debug breadcrumb when a provider invocation produces no
 * usable output and is about to be classified as a failure. Matches the
 * `[<provider>-provider] exit=<code> stderr=<truncated>` format originally
 * added to the claude provider so triage logs read the same regardless of
 * which CLI failed.
 */
export declare function logClassificationFailure(providerName: string, exitCode: number, stderr: string | undefined): void;
