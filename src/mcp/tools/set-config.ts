import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { setConfigValue, getValidKeys } from "../../config/mutate.js";

const inputSchema = {
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
  key: z
    .string()
    .describe(
      `Dotted config key. Valid keys: ${getValidKeys().join(", ")}`,
    ),
  value: z
    .string()
    .describe("Value to set (coerced to number/boolean as schema requires)"),
  confirm: z
    .boolean()
    .default(false)
    .describe(
      "If false (default), dry-run: returns what would change without writing. If true, performs the write.",
    ),
};

export function registerSetConfig(server: McpServer): void {
  server.tool(
    "planpong_set_config",
    "Set a planpong configuration value. Dry-run by default (confirm: false); pass confirm: true to write.",
    inputSchema,
    async (input) => {
      const cwd = input.cwd ?? process.cwd();

      try {
        const result = setConfigValue(cwd, input.key, input.value, {
          dryRun: !input.confirm,
        });

        // Check for shadow warnings
        let shadowWarning: string | undefined;
        if (input.confirm) {
          const effective = loadConfig({ cwd });
          const parts = input.key.split(".");
          let effectiveVal: unknown;
          if (parts.length === 1) {
            effectiveVal = (effective as unknown as Record<string, unknown>)[parts[0]];
          } else {
            effectiveVal = (
              (effective as unknown as Record<string, unknown>)[parts[0]] as Record<string, unknown>
            )?.[parts[1]];
          }
          if (String(effectiveVal) !== String(result.after)) {
            shadowWarning = `Effective value is "${String(effectiveVal)}" — a CLI override takes precedence over the file value.`;
          }
        }

        const response: Record<string, unknown> = {
          mode: input.confirm ? "applied" : "dry_run",
          config_path: result.configPath,
          key: result.key,
          before: result.before ?? null,
          after: result.after,
          created: result.created,
        };

        if (shadowWarning) {
          response.shadow_warning = shadowWarning;
        }

        if (input.confirm) {
          response.resolved_config = loadConfig({ cwd });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: (err as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
