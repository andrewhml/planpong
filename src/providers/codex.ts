import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type {
  Provider,
  InvokeOptions,
  ProviderResponse,
  ProviderError,
} from "./types.js";

const MODELS = ["gpt-5.3-codex", "o3-pro", "o3", "o4-mini"];
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];

/**
 * Classify a CLI invocation failure as `capability` (downgrade-eligible) or
 * `fatal` (terminal). Capability errors indicate the CLI doesn't support the
 * requested structured output flag; fatal errors are everything else.
 */
function classifyError(stderr: string, exitCode: number): ProviderError {
  const lower = stderr.toLowerCase();
  const capabilityIndicators = [
    "unknown flag",
    "unknown option",
    "unrecognized",
    "invalid schema",
    "output-schema",
    "unsupported",
  ];
  const isCapability = capabilityIndicators.some((indicator) =>
    lower.includes(indicator),
  );
  return {
    kind: isCapability ? "capability" : "fatal",
    message: stderr.slice(0, 500) || `codex exited with code ${exitCode}`,
    exitCode,
    stderr,
  };
}

export class CodexProvider implements Provider {
  name = "codex";

  private capabilityCache: boolean | null = null;

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

    // Optional structured output schema
    let schemaFile: string | null = null;
    if (options.jsonSchema) {
      schemaFile = join(
        tmpdir(),
        `planpong-codex-schema-${randomBytes(6).toString("hex")}.json`,
      );
      try {
        writeFileSync(schemaFile, JSON.stringify(options.jsonSchema));
        args.push("--output-schema", schemaFile);
      } catch (error) {
        // If we can't write the schema file, fall through without structured output
        schemaFile = null;
      }
    }

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

      const duration = Date.now() - start;
      const exitCode = result.exitCode ?? 1;

      let content = "";
      try {
        content = readFileSync(outFile, "utf-8");
      } catch {
        // Fall back to stdout if output file wasn't created
        content = result.stdout ?? "";
      }

      // Clean up temp files
      try {
        unlinkSync(outFile);
      } catch {
        // ignore
      }
      if (schemaFile) {
        try {
          unlinkSync(schemaFile);
        } catch {
          // ignore
        }
      }

      if (content && content.trim().length > 0) {
        return { ok: true, output: content, duration };
      }

      return {
        ok: false,
        error: classifyError(result.stderr ?? "", exitCode),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - start;
      // Cleanup on error path
      if (schemaFile) {
        try {
          unlinkSync(schemaFile);
        } catch {
          // ignore
        }
      }
      const message =
        error instanceof Error ? error.message : "Unknown error invoking codex";
      return {
        ok: false,
        error: { kind: "fatal", message, exitCode: 1 },
        duration,
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

  async checkStructuredOutputSupport(): Promise<boolean> {
    if (this.capabilityCache !== null) {
      return this.capabilityCache;
    }
    try {
      const result = await execa("codex", ["exec", "--help"], {
        preferLocal: true,
        timeout: 5_000,
        reject: false,
      });
      const helpText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const supported = helpText.includes("--output-schema");
      this.capabilityCache = supported;
      if (!supported) {
        process.stderr.write(
          `[planpong] Structured output not supported by codex — using legacy parsing\n`,
        );
      }
      return supported;
    } catch {
      this.capabilityCache = false;
      return false;
    }
  }

  markNonCapable(): void {
    this.capabilityCache = false;
  }

  getModels(): string[] {
    return MODELS;
  }

  getEffortLevels(): string[] {
    return EFFORT_LEVELS;
  }
}
