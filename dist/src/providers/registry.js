import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
const ALL_PROVIDERS = [new ClaudeProvider(), new CodexProvider()];
export async function getAvailableProviders() {
    const results = await Promise.all(ALL_PROVIDERS.map(async (p) => ({
        provider: p,
        available: await p.isAvailable(),
    })));
    return results.filter((r) => r.available).map((r) => r.provider);
}
export function getProvider(name) {
    return ALL_PROVIDERS.find((p) => p.name === name);
}
export function getAllProviders() {
    return ALL_PROVIDERS;
}
//# sourceMappingURL=registry.js.map