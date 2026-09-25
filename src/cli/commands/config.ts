import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import {
  setConfigValue,
  unsetConfigValue,
  getValidKeys,
  getKeyMetadata,
  getKeyMeta,
} from "../../config/mutate.js";
import { getAllProviders, getProvider } from "../../providers/registry.js";
import type { ModelCatalog } from "../../providers/types.js";

type CatalogLookup = (providerName: string) => Promise<ModelCatalog | null>;

const registryCatalog: CatalogLookup = async (name) =>
  (await getProvider(name)?.getModelCatalog()) ?? null;

/**
 * Soft-validate a config value against the provider's model catalog.
 * Returns a warning string if the value isn't recognized or deserves a
 * caveat, or null if it's fine (or there's nothing to check against).
 *
 * Soft because providers accept model IDs the catalog doesn't list; we
 * nudge typos and incompatible combinations without blocking.
 *
 * Effort checks depend on the role's pinned model: with one, check that
 * model's levels; without one, a level missing from some models gets a
 * model-dependent warning rather than "unknown".
 */
export async function getUnknownValueWarning(
  key: string,
  value: string,
  providerForRole: string | undefined,
  opts: { pinnedModel?: string; getCatalog?: CatalogLookup } = {},
): Promise<string | null> {
  if (key === "planner.provider" || key === "reviewer.provider") {
    const valid = getAllProviders().map((p) => p.name);
    if (valid.includes(value)) return null;
    return `Warning: "${value}" is not a known provider. Known: ${valid.join(", ")}.`;
  }
  const isModel = key === "planner.model" || key === "reviewer.model";
  const isEffort = key === "planner.effort" || key === "reviewer.effort";
  if (!isModel && !isEffort) return null;
  if (!providerForRole) return null;
  const catalog = await (opts.getCatalog ?? registryCatalog)(providerForRole);
  if (!catalog) return null;
  const hint = `The provider may still accept it. Run 'planpong config providers' to see current lists.`;

  if (isModel) {
    const ids = catalog.models.map((m) => m.id);
    if (ids.length === 0 || ids.includes(value)) return null;
    return `Warning: "${value}" is not in ${providerForRole}'s known model list (${ids.join(", ")}). ${hint}`;
  }

  if (catalog.allEfforts.length === 0) return null;
  const role = key.split(".")[0];
  const advisory = catalog.advisories[value];
  const pinned = opts.pinnedModel
    ? catalog.models.find((m) => m.id === opts.pinnedModel)
    : undefined;
  let warning: string | null = null;
  if (pinned) {
    if (!pinned.efforts.includes(value)) {
      warning =
        `Warning: "${value}" is not supported by ${pinned.id} ` +
        `(${pinned.efforts.join(", ")}). ${hint}`;
    }
  } else if (!catalog.allEfforts.includes(value)) {
    warning =
      `Warning: "${value}" is not in ${providerForRole}'s known effort level list ` +
      `(${catalog.allEfforts.join(", ")}). ${hint}`;
  } else if (!catalog.efforts.includes(value)) {
    warning =
      `Warning: "${value}" is not supported by every ${providerForRole} model; ` +
      `pin ${role}.model to one that supports it.`;
  }
  if (advisory) {
    warning = warning ? `${warning}\n  Note: ${advisory}` : `Note: ${advisory}`;
  }
  return warning;
}

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
    .action(async () => printProvidersTable());

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
    .action(async (key: string, value: string) => {
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

        // Soft-validate the value against the provider registry. We don't
        // reject because providers accept additional model IDs beyond the
        // enumerated lists — but a typo deserves a nudge.
        const role = parts[0];
        const roleConfig =
          role === "planner" || role === "reviewer"
            ? (effective[role as "planner" | "reviewer"] as { provider?: string; model?: string } | undefined)
            : undefined;
        const warning = await getUnknownValueWarning(key, value, roleConfig?.provider, {
          pinnedModel: roleConfig?.model,
        });
        if (warning) {
          console.error(`\n  ${warning}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  configCmd
    .command("unset")
    .description("Remove a config value so its default applies (for model/effort: the provider CLI's own default)")
    .argument("<key>", "Config key (run 'planpong config keys' to see all)")
    .addHelpText("after", `\nAvailable config keys:\n${formatKeyList()}`)
    .action((key: string) => {
      const cwd = process.cwd();
      if (!getKeyMeta(key)) {
        console.error(`Unknown config key: "${key}"\n`);
        printKeysTable();
        process.exitCode = 1;
        return;
      }
      try {
        const result = unsetConfigValue(cwd, key);
        if (result.before === undefined) {
          console.log(`${key} is not set in ${result.configPath}; nothing to do.`);
          return;
        }
        console.log(`Updated ${result.configPath}`);
        console.log(`  ${key}: ${String(result.before)} → (unset)`);
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

async function printProvidersTable(): Promise<void> {
  const providers = getAllProviders();
  for (const p of providers) {
    const catalog = await p.getModelCatalog();
    const source = catalog.source === "live" ? "live" : "built-in";
    console.log(`${p.name}  (${source} list)`);
    if (catalog.note) console.log(`  note:    ${catalog.note}`);
    if (catalog.models.length === 0) {
      console.log("  models:  (none enumerated)");
    } else if (catalog.source === "live") {
      const width = Math.max(...catalog.models.map((m) => m.id.length)) + 2;
      console.log("  models:");
      for (const m of catalog.models) {
        const efforts = m.efforts.length > 0 ? `effort: ${m.efforts.join(", ")}` : "";
        console.log(`    ${m.id.padEnd(width)}${efforts}`);
      }
    } else {
      console.log(`  models:  ${catalog.models.map((m) => m.id).join(", ")}`);
    }
    console.log(
      `  effort:  ${catalog.allEfforts.length > 0 ? catalog.allEfforts.join(", ") : "(none)"}`,
    );
    for (const [level, text] of Object.entries(catalog.advisories)) {
      console.log(`  ${level}:   ${text}`);
    }
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
