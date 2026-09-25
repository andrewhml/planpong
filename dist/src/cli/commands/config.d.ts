import type { Command } from "commander";
import type { ModelCatalog } from "../../providers/types.js";
type CatalogLookup = (providerName: string) => Promise<ModelCatalog | null>;
/**
 * Soft-validate a config value against the provider's model catalog.
 * Returns a warning string if the value isn't recognized or deserves a
 * caveat, or null if it's fine (or there's nothing to check against).
 *
 * Soft because providers accept model IDs the catalog doesn't list; we
 * nudge typos and incompatible combinations without blocking.
 *
 * Effort checks depend on the role's pinned model: with one, check that
 * model's levels; without one, a level missing from some models gets a
 * model-dependent warning rather than "unknown".
 */
export declare function getUnknownValueWarning(key: string, value: string, providerForRole: string | undefined, opts?: {
    pinnedModel?: string;
    getCatalog?: CatalogLookup;
}): Promise<string | null>;
export declare function registerConfigCommand(program: Command): void;
export {};
