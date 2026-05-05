import type { InvokeOptions } from "./types.js";
/**
 * Reject the impossible state where a caller asks the provider to both
 * initialize a fresh session AND resume an existing one. The operations-layer
 * state machine never passes both today, so this is purely defensive — but
 * all providers throw the same error so the parity is uniform.
 */
export declare function assertMutuallyExclusiveSessions(providerName: string, options: InvokeOptions): void;
