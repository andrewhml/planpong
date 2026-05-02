import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { getValidKeys, getKeyMetadata } from "../../config/mutate.js";
const inputSchema = {
    cwd: z
        .string()
        .optional()
        .describe("Working directory (defaults to process.cwd())"),
};
export function registerGetConfig(server) {
    server.tool("planpong_get_config", "Get the resolved planpong configuration, including config file path, per-key source provenance, and version.", inputSchema, async (input) => {
        const cwd = input.cwd ?? process.cwd();
        const configPath = findConfigPath(cwd);
        const resolved = loadConfig({ cwd });
        // Load file config for source detection
        let fileConfig = {};
        if (configPath) {
            fileConfig =
                parseYaml(readFileSync(configPath, "utf-8")) ?? {};
        }
        // Build sources map
        const sources = {};
        for (const key of getValidKeys()) {
            const parts = key.split(".");
            let fileVal;
            if (parts.length === 1) {
                fileVal = fileConfig[parts[0]];
            }
            else {
                fileVal = fileConfig[parts[0]]?.[parts[1]];
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
                    const pkg = JSON.parse(readFileSync(candidate, "utf-8"));
                    if (pkg.name === "planpong" && pkg.version) {
                        version = pkg.version;
                        break;
                    }
                }
                catch {
                    // keep walking
                }
                here = dirname(here);
            }
        }
        catch {
            // fallback
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        config: resolved,
                        config_path: configPath,
                        version,
                        sources,
                        keys: getKeyMetadata(),
                    }),
                },
            ],
        };
    });
}
//# sourceMappingURL=get-config.js.map