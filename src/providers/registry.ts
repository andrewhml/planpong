import type { Provider } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";

const ALL_PROVIDERS: Provider[] = [new ClaudeProvider(), new CodexProvider()];

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
