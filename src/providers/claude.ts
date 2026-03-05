import { execa } from "execa";
import type { Provider, InvokeOptions, ProviderResponse } from "./types.js";

const MODELS = ["opus", "sonnet", "haiku"];

/**
 * Build a clean env object with CLAUDECODE removed.
 * This allows spawning headless `claude -p` from inside a Claude Code session.
 */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== "CLAUDECODE" && value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export class ClaudeProvider implements Provider {
  name = "claude";

  async invoke(
    prompt: string,
    options: InvokeOptions,
  ): Promise<ProviderResponse> {
    // claude -p reads prompt from stdin when no positional arg is given
    const args = ["-p", "--output-format", "text"];

    if (options.model) {
      args.push("--model", options.model);
    }

    const start = Date.now();
    try {
      const result = await execa("claude", args, {
        cwd: options.cwd,
        preferLocal: true,
        timeout: options.timeout ?? 300_000,
        reject: false,
        env: cleanEnv(),
        extendEnv: false,
        input: prompt,
      });

      if (result.exitCode !== 0) {
        process.stderr.write(
          `[claude-provider] exit=${result.exitCode} stderr=${result.stderr?.slice(0, 500)}\n`,
        );
      }

      return {
        content: result.stdout,
        exitCode: result.exitCode ?? 1,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        content:
          error instanceof Error
            ? error.message
            : "Unknown error invoking claude",
        exitCode: 1,
        duration: Date.now() - start,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execa("claude", ["--version"], {
        preferLocal: true,
        timeout: 5_000,
        reject: false,
        env: cleanEnv(),
        extendEnv: false,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  getModels(): string[] {
    return MODELS;
  }

  getEffortLevels(): string[] {
    // Claude effort maps to model selection — opus is highest reasoning
    return ["default"];
  }
}
