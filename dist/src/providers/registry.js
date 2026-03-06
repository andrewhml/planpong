import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
const ALL_PROVIDERS = [new ClaudeProvider(), new CodexProvider()];
const INSTALL_HINTS = {
    claude: "Install Claude Code: npm install -g @anthropic-ai/claude-code (requires Anthropic API key or Max subscription)",
    codex: "Install Codex CLI: npm install -g @openai/codex (requires OpenAI API key)",
};
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
export function getInstallHint(providerName) {
    return INSTALL_HINTS[providerName] ?? `Install the "${providerName}" CLI`;
}
//# sourceMappingURL=registry.js.map