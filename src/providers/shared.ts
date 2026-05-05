import type { InvokeOptions } from "./types.js";

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
    `[${providerName}-provider] exit=${exitCode} stderr=${stderr?.slice(0, 500) ?? ""}\n`,
  );
}
