import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parse as parseYaml } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { getValidKeys } from "../../config/mutate.js";

const inputSchema = {
  cwd: z
    .string()
    .optional()
    .describe("Working directory (defaults to process.cwd())"),
};

export function registerGetConfig(server: McpServer): void {
  server.tool(
    "planpong_get_config",
    "Get the resolved planpong configuration, including config file path, per-key source provenance, and version.",
    inputSchema,
    async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const configPath = findConfigPath(cwd);
      const resolved = loadConfig({ cwd });

      // Load file config for source detection
      let fileConfig: Record<string, unknown> = {};
      if (configPath) {
        fileConfig =
          (parseYaml(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
      }

      // Build sources map
      const sources: Record<string, "default" | "file"> = {};
      for (const key of getValidKeys()) {
        const parts = key.split(".");
        let fileVal: unknown;
        if (parts.length === 1) {
          fileVal = fileConfig[parts[0]];
        } else {
          fileVal = (fileConfig[parts[0]] as Record<string, unknown> | undefined)?.[parts[1]];
        }
        sources[key] = fileVal !== undefined ? "file" : "default";
      }

      // Read version from package.json
      let version = "unknown";
      try {
        let here = dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 5; i++) {
          const candidate = join(here, "package.json");
          try {
            const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
              name?: string;
              version?: string;
            };
            if (pkg.name === "planpong" && pkg.version) {
              version = pkg.version;
              break;
            }
          } catch {
            // keep walking
          }
          here = dirname(here);
        }
      } catch {
        // fallback
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              config: resolved,
              config_path: configPath,
              version,
              sources,
            }),
          },
        ],
      };
    },
  );
}
