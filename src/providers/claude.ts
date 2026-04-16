import { execa } from "execa";
import type {
  Provider,
  InvokeOptions,
  ProviderResponse,
  ProviderError,
} from "./types.js";

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

/**
 * Parse claude's `--output-format json` envelope and extract the
 * `structured_output` field as a JSON string ready for downstream parsing.
 * Returns null if the envelope is malformed or the field is missing.
 *
 * Envelope shape (subset):
 * {
 *   "type": "result",
 *   "is_error": false,
 *   "result": "",
 *   "structured_output": { ...model's constrained JSON... },
 *   ...
 * }
 */
function extractStructuredOutput(stdout: string): string | null {
  try {
    const envelope = JSON.parse(stdout);
    if (
      envelope &&
      typeof envelope === "object" &&
      "structured_output" in envelope &&
      envelope.structured_output !== null &&
      typeof envelope.structured_output === "object"
    ) {
      return JSON.stringify(envelope.structured_output);
    }
  } catch {
    // Not JSON — may indicate a pre-envelope error or auth failure
  }
  return null;
}

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
    "invalid json schema",
    "json-schema",
    "unsupported",
  ];
  const isCapability = capabilityIndicators.some((indicator) =>
    lower.includes(indicator),
  );
  return {
    kind: isCapability ? "capability" : "fatal",
    message: stderr.slice(0, 500) || `claude exited with code ${exitCode}`,
    exitCode,
    stderr,
  };
}

export class ClaudeProvider implements Provider {
  name = "claude";

  private capabilityCache: boolean | null = null;

  async invoke(
    prompt: string,
    options: InvokeOptions,
  ): Promise<ProviderResponse> {
    // claude -p reads prompt from stdin when no positional arg is given.
    // --bare skips hooks/MCP/auto-memory/CLAUDE.md/plugin-sync for faster
    // subprocess startup, but it bypasses OAuth/keychain — only safe to use
    // when ANTHROPIC_API_KEY is set.
    const args = ["-p"];
    if (process.env.ANTHROPIC_API_KEY) {
      args.push("--bare");
    }

    if (options.jsonSchema) {
      // With a schema, use --output-format json so the response envelope
      // includes a `structured_output` field containing the model's
      // constrained JSON as a native object. --output-format text drops
      // the structured_output field entirely.
      args.push(
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(options.jsonSchema),
      );
    } else {
      args.push("--output-format", "text");
    }

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

      const duration = Date.now() - start;
      const exitCode = result.exitCode ?? 1;

      // claude -p can exit non-zero with valid stdout. Treat presence of
      // stdout as success even on non-zero exit.
      if (result.stdout && result.stdout.trim().length > 0) {
        if (options.jsonSchema) {
          // Parse claude's envelope and extract structured_output.
          const extracted = extractStructuredOutput(result.stdout);
          if (extracted === null) {
            return {
              ok: false,
              error: {
                kind: "capability",
                message: `claude returned envelope without structured_output field: ${result.stdout.slice(0, 300)}`,
                exitCode,
                stderr: result.stderr,
              },
              duration,
            };
          }
          return { ok: true, output: extracted, duration };
        }
        return { ok: true, output: result.stdout, duration };
      }

      // No usable output — classify the failure
      process.stderr.write(
        `[claude-provider] exit=${exitCode} stderr=${result.stderr?.slice(0, 500)}\n`,
      );
      return {
        ok: false,
        error: classifyError(result.stderr ?? "", exitCode),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - start;
      const message =
        error instanceof Error ? error.message : "Unknown error invoking claude";
      return {
        ok: false,
        error: { kind: "fatal", message, exitCode: 1 },
        duration,
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

  async checkStructuredOutputSupport(): Promise<boolean> {
    if (this.capabilityCache !== null) {
      return this.capabilityCache;
    }
    try {
      const result = await execa("claude", ["--help"], {
        preferLocal: true,
        timeout: 5_000,
        reject: false,
        env: cleanEnv(),
        extendEnv: false,
      });
      const helpText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const supported = helpText.includes("--json-schema");
      this.capabilityCache = supported;
      if (!supported) {
        process.stderr.write(
          `[planpong] Structured output not supported by claude — using legacy parsing\n`,
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
    // Claude effort maps to model selection — opus is highest reasoning
    return ["default"];
  }
}
