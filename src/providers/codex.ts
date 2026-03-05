import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { Provider, InvokeOptions, ProviderResponse } from "./types.js";

const MODELS = ["gpt-5.3-codex", "o3-pro", "o3", "o4-mini"];
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];

export class CodexProvider implements Provider {
  name = "codex";

  async invoke(
    prompt: string,
    options: InvokeOptions,
  ): Promise<ProviderResponse> {
    const args = ["exec"];

    if (options.model) {
      args.push("-m", options.model);
    }

    if (options.effort) {
      args.push("-c", `model_reasoning_effort="${options.effort}"`);
    }

    // Write clean output to a temp file to avoid parsing header/footer
    const outFile = join(
      tmpdir(),
      `planpong-codex-${randomBytes(6).toString("hex")}.txt`,
    );
    args.push("-o", outFile);

    // Use stdin for prompt (CLI arg has length limits)
    args.push("-");

    const start = Date.now();
    try {
      const result = await execa("codex", args, {
        cwd: options.cwd,
        preferLocal: true,
        timeout: options.timeout ?? 300_000,
        reject: false,
        input: prompt,
      });

      let content: string;
      try {
        content = readFileSync(outFile, "utf-8");
      } catch {
        // Fall back to stdout if output file wasn't created
        content = result.stdout;
      }

      // Clean up temp file
      try {
        unlinkSync(outFile);
      } catch {
        // ignore
      }

      return {
        content,
        exitCode: result.exitCode ?? 1,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        content:
          error instanceof Error
            ? error.message
            : "Unknown error invoking codex",
        exitCode: 1,
        duration: Date.now() - start,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execa("codex", ["--version"], {
        preferLocal: true,
        timeout: 5_000,
        reject: false,
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
    return EFFORT_LEVELS;
  }
}
