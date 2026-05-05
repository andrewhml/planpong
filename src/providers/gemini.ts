import { execa } from "execa";
import { assertMutuallyExclusiveSessions } from "./shared.js";
import type {
  Provider,
  InvokeOptions,
  ProviderResponse,
  ProviderError,
} from "./types.js";

const MODELS = ["gemini-2.5-pro", "gemini-3-pro", "gemini-2.5-flash"];

/**
 * Build argv for `gemini -p`. Pure function — no I/O.
 *
 * The `gemini` CLI's `-p/--prompt` flag requires a string value (the help text
 * is misleading on this point). Per the CLI source, stdin content is appended
 * to the `-p` argument, so passing `-p ""` plus a stdin pipe works the same as
 * codex's `exec -` pattern: the model sees only the stdin content.
 *
 * `--skip-trust` bypasses the "trusted folder" gate added in gemini CLI 0.32.
 * Without it, gemini exits 55 in any directory the user has not interactively
 * acknowledged as trusted, which would block planpong runs in fresh repos,
 * temp directories, and CI shells. The alternative escape hatch is the
 * `GEMINI_CLI_TRUST_WORKSPACE=true` env var; we prefer the explicit flag so
 * the contract is visible in process listings and not coupled to env state.
 *
 * Session resumption is not supported in v1 — `gemini --resume` accepts
 * indices and `latest`, not UUIDs, so `newSessionId`/`resumeSessionId` are
 * silently ignored. See the design doc at docs/plans/gemini-and-init-wizard.md
 * (Future Work item #2) for the deferred follow-up.
 */
export function buildArgs(options: InvokeOptions): string[] {
  const args = ["-p", "", "--skip-trust", "--output-format", "json"];
  if (options.model) {
    args.push("-m", options.model);
  }
  return args;
}

export type ExtractResult =
  | { ok: true; text: string }
  | { ok: false; message: string; code?: number };

/**
 * Parse gemini's `--output-format json` envelope. Pure function.
 *
 * Envelope shape (verified against @google/gemini-cli@0.32 src/output/json-formatter.ts):
 *   success: { session_id, response, stats }
 *   error:   { session_id, error: { type, message, code } }
 */
export function extractResponse(stdout: string): ExtractResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      message: "could not parse gemini JSON envelope",
      code: undefined,
    };
  }
  if (envelope === null || typeof envelope !== "object") {
    return {
      ok: false,
      message: "could not parse gemini JSON envelope",
      code: undefined,
    };
  }
  const obj = envelope as Record<string, unknown>;
  if (
    obj.error &&
    typeof obj.error === "object" &&
    obj.error !== null
  ) {
    const err = obj.error as Record<string, unknown>;
    const message =
      typeof err.message === "string" ? err.message : "gemini reported error";
    const code = typeof err.code === "number" ? err.code : undefined;
    return { ok: false, message, code };
  }
  if (typeof obj.response === "string") {
    return { ok: true, text: obj.response };
  }
  return {
    ok: false,
    message: "gemini envelope missing response and error fields",
    code: undefined,
  };
}

/**
 * Classify a gemini invocation failure. v1 always returns `fatal` — gemini
 * doesn't accept any structured-output flags so there is no capability axis
 * to downgrade along.
 */
export function classifyError(stderr: string, exitCode: number): ProviderError {
  return {
    kind: "fatal",
    message: stderr.slice(0, 500) || `gemini exited with code ${exitCode}`,
    exitCode,
    stderr,
  };
}

export class GeminiProvider implements Provider {
  name = "gemini";

  async invoke(
    prompt: string,
    options: InvokeOptions,
  ): Promise<ProviderResponse> {
    assertMutuallyExclusiveSessions(this.name, options);

    const args = buildArgs(options);
    const start = Date.now();
    try {
      const result = await execa("gemini", args, {
        cwd: options.cwd,
        preferLocal: true,
        timeout: options.timeout ?? 600_000,
        reject: false,
        input: prompt,
      });
      const duration = Date.now() - start;
      const exitCode = result.exitCode ?? 1;
      const stdout = result.stdout ?? "";

      if (stdout.trim().length > 0) {
        const parsed = extractResponse(stdout);
        if (parsed.ok) {
          return { ok: true, output: parsed.text, duration };
        }
        return {
          ok: false,
          error: {
            kind: "fatal",
            message: parsed.message,
            exitCode: parsed.code ?? exitCode,
            stderr: result.stderr,
          },
          duration,
        };
      }

      return {
        ok: false,
        error: classifyError(result.stderr ?? "", exitCode),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - start;
      const message =
        error instanceof Error ? error.message : "Unknown error invoking gemini";
      return {
        ok: false,
        error: { kind: "fatal", message, exitCode: 1 },
        duration,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execa("gemini", ["--version"], {
        preferLocal: true,
        timeout: 5_000,
        reject: false,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Always returns false in v1. Gemini's CLI does not expose a `--json-schema`
   * or `--output-schema` flag, so structured-output mode is unavailable. See
   * Future Work item #1 in docs/plans/gemini-and-init-wizard.md.
   */
  async checkStructuredOutputSupport(): Promise<boolean> {
    return false;
  }

  markNonCapable(): void {
    // No-op for symmetry with the other providers; v1 is permanently non-capable.
  }

  getModels(): string[] {
    return MODELS;
  }

  getEffortLevels(): string[] {
    return ["default"];
  }
}
