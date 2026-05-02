import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { parse as parseYaml, stringify } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { setConfigValue, getValidKeys } from "../../config/mutate.js";

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("View or modify planpong configuration");

  configCmd
    .command("path")
    .description("Print the path to the active config file")
    .action(() => {
      const cwd = process.cwd();
      const path = findConfigPath(cwd);
      if (path) {
        console.log(path);
      } else {
        console.log("No config file found");
        process.exitCode = 1;
      }
    });

  configCmd
    .command("set")
    .description("Set a config value")
    .argument("<key>", `Dotted config key (${getValidKeys().join(", ")})`)
    .argument("<value>", "Value to set")
    .action((key: string, value: string) => {
      const cwd = process.cwd();
      try {
        const result = setConfigValue(cwd, key, value);
        console.log(
          `${result.created ? "Created" : "Updated"} ${result.configPath}`,
        );
        console.log(`  ${key}: ${String(result.before ?? "(unset)")} → ${String(result.after)}`);

        // Check for shadow warnings
        const effective = loadConfig({ cwd });
        const parts = key.split(".");
        let effectiveVal: unknown;
        if (parts.length === 1) {
          effectiveVal = (effective as unknown as Record<string, unknown>)[parts[0]];
        } else {
          effectiveVal = (
            (effective as unknown as Record<string, unknown>)[parts[0]] as Record<string, unknown>
          )?.[parts[1]];
        }
        if (String(effectiveVal) !== String(result.after)) {
          console.log(
            `\n  Warning: effective value is "${String(effectiveVal)}" (overridden by CLI flag)`,
          );
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // Default action: show resolved config with source annotations
  configCmd.action(() => {
    const cwd = process.cwd();
    const configPath = findConfigPath(cwd);
    const resolved = loadConfig({ cwd });

    if (configPath) {
      console.log(`# Config file: ${configPath}`);
    } else {
      console.log("# No config file found (using defaults)");
    }
    console.log();

    // Load file config for source detection
    let fileConfig: Record<string, unknown> = {};
    if (configPath) {
      fileConfig = (parseYaml(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
    }

    // Print each key with source annotation
    for (const key of getValidKeys()) {
      const parts = key.split(".");
      let fileVal: unknown;
      let resolvedVal: unknown;

      if (parts.length === 1) {
        fileVal = fileConfig[parts[0]];
        resolvedVal = (resolved as unknown as Record<string, unknown>)[parts[0]];
      } else {
        fileVal = (fileConfig[parts[0]] as Record<string, unknown> | undefined)?.[parts[1]];
        resolvedVal = (
          (resolved as unknown as Record<string, unknown>)[parts[0]] as Record<string, unknown>
        )?.[parts[1]];
      }

      const source = fileVal !== undefined ? "file" : "default";
      const displayVal = resolvedVal === undefined ? "(unset)" : String(resolvedVal);
      console.log(`  ${key}: ${displayVal}  (${source})`);
    }
  });
}
