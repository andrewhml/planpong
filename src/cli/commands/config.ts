import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { setConfigValue, getValidKeys, getKeyMetadata, getKeyMeta } from "../../config/mutate.js";
import { getAllProviders } from "../../providers/registry.js";

function formatKeyList(): string {
  return getKeyMetadata()
    .map((m) => `  ${m.key.padEnd(20)} ${m.values.padEnd(28)} ${m.description}`)
    .join("\n");
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command("config")
    .description("View or modify planpong configuration (run with no subcommand to show all)")
    .addHelpText("after", `\nAvailable config keys:\n${formatKeyList()}`);

  configCmd
    .command("show")
    .description("Show all resolved config values with sources")
    .action(() => showConfig());

  configCmd
    .command("get")
    .description("Get a single config value")
    .argument("<key>", "Config key (run 'planpong config keys' to see all)")
    .action((key: string) => {
      if (!getValidKeys().includes(key)) {
        console.error(`Unknown config key: "${key}"\n`);
        printKeysTable();
        process.exitCode = 1;
        return;
      }
      const cwd = process.cwd();
      const resolved = loadConfig({ cwd });
      const parts = key.split(".");
      let val: unknown;
      if (parts.length === 1) {
        val = (resolved as unknown as Record<string, unknown>)[parts[0]];
      } else {
        val = (
          (resolved as unknown as Record<string, unknown>)[parts[0]] as Record<string, unknown>
        )?.[parts[1]];
      }
      console.log(val === undefined ? "(unset)" : String(val));
    });

  configCmd
    .command("keys")
    .description("List all config keys with descriptions, valid values, and defaults")
    .action(() => printKeysTable());

  configCmd
    .command("providers")
    .description("List providers with their valid model and effort values")
    .action(() => printProvidersTable());

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
    .argument("<key>", "Config key (run 'planpong config keys' to see all)")
    .argument("<value>", "Value to set")
    .addHelpText("after", `\nAvailable config keys:\n${formatKeyList()}`)
    .action((key: string, value: string) => {
      const cwd = process.cwd();
      const meta = getKeyMeta(key);
      if (!meta) {
        console.error(`Unknown config key: "${key}"\n`);
        printKeysTable();
        process.exitCode = 1;
        return;
      }
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
  configCmd.action(() => showConfig());
}

function printKeysTable(): void {
  const meta = getKeyMetadata();
  const keyW = Math.max(...meta.map((m) => m.key.length)) + 2;
  const valW = Math.max(...meta.map((m) => m.values.length)) + 2;
  const defW = Math.max(...meta.map((m) => m.default.length)) + 2;

  console.log(
    "KEY".padEnd(keyW) +
    "VALUES".padEnd(valW) +
    "DEFAULT".padEnd(defW) +
    "DESCRIPTION",
  );
  console.log("─".repeat(keyW + valW + defW + 30));
  for (const m of meta) {
    console.log(
      m.key.padEnd(keyW) +
      m.values.padEnd(valW) +
      m.default.padEnd(defW) +
      m.description,
    );
  }
  console.log(
    "\nFor per-provider model and effort values, run 'planpong config providers'.",
  );
}

function printProvidersTable(): void {
  const providers = getAllProviders();
  for (const p of providers) {
    const models = p.getModels();
    const efforts = p.getEffortLevels();
    console.log(p.name);
    console.log(`  models:  ${models.length > 0 ? models.join(", ") : "(none enumerated)"}`);
    console.log(`  effort:  ${efforts.length > 0 ? efforts.join(", ") : "(none enumerated)"}`);
    console.log();
  }
  console.log(
    "Note: providers may accept additional model IDs not listed here (e.g. newly-released versions).",
  );
  console.log(
    "Run 'planpong init' for an interactive picker against the same lists.",
  );
}

function showConfig(): void {
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

  const meta = getKeyMetadata();
  const keyW = Math.max(...meta.map((m) => m.key.length)) + 2;

  for (const m of meta) {
    const parts = m.key.split(".");
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
    console.log(`  ${m.key.padEnd(keyW)} ${displayVal.padEnd(20)} (${source})`);
  }

  console.log(`\nRun 'planpong config keys' for valid values and descriptions.`);
}
