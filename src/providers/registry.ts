import type { Provider } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { GeminiProvider } from "./gemini.js";

const ALL_PROVIDERS: Provider[] = [
  new ClaudeProvider(),
  new CodexProvider(),
  new GeminiProvider(),
];

const INSTALL_HINTS: Record<string, string> = {
  claude:
    "Install Claude Code: npm install -g @anthropic-ai/claude-code (requires Anthropic API key or Max subscription)",
  codex:
    "Install Codex CLI: npm install -g @openai/codex (requires OpenAI API key)",
  gemini:
    "Install Gemini CLI: npm install -g @google/gemini-cli, then run `gemini` once to complete Google account auth before invoking planpong.",
};

export async function getAvailableProviders(): Promise<Provider[]> {
  const results = await Promise.all(
    ALL_PROVIDERS.map(async (p) => ({
      provider: p,
      available: await p.isAvailable(),
    })),
  );
  return results.filter((r) => r.available).map((r) => r.provider);
}

export function getProvider(name: string): Provider | undefined {
  return ALL_PROVIDERS.find((p) => p.name === name);
}

export function getAllProviders(): Provider[] {
  return ALL_PROVIDERS;
}

export function getInstallHint(providerName: string): string {
  return INSTALL_HINTS[providerName] ?? `Install the "${providerName}" CLI`;
}
