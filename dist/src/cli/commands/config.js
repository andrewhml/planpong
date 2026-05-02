import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { setConfigValue, getValidKeys, getKeyMetadata, getKeyMeta } from "../../config/mutate.js";
function formatKeyList() {
    return getKeyMetadata()
        .map((m) => `  ${m.key.padEnd(20)} ${m.values.padEnd(28)} ${m.description}`)
        .join("\n");
}
export function registerConfigCommand(program) {
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
        .action((key) => {
        if (!getValidKeys().includes(key)) {
            console.error(`Unknown config key: "${key}"\n`);
            printKeysTable();
            process.exitCode = 1;
            return;
        }
        const cwd = process.cwd();
        const resolved = loadConfig({ cwd });
        const parts = key.split(".");
        let val;
        if (parts.length === 1) {
            val = resolved[parts[0]];
        }
        else {
            val = resolved[parts[0]]?.[parts[1]];
        }
        console.log(val === undefined ? "(unset)" : String(val));
    });
    configCmd
        .command("keys")
        .description("List all config keys with descriptions, valid values, and defaults")
        .action(() => printKeysTable());
    configCmd
        .command("path")
        .description("Print the path to the active config file")
        .action(() => {
        const cwd = process.cwd();
        const path = findConfigPath(cwd);
        if (path) {
            console.log(path);
        }
        else {
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
        .action((key, value) => {
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
            console.log(`${result.created ? "Created" : "Updated"} ${result.configPath}`);
            console.log(`  ${key}: ${String(result.before ?? "(unset)")} → ${String(result.after)}`);
            // Check for shadow warnings
            const effective = loadConfig({ cwd });
            const parts = key.split(".");
            let effectiveVal;
            if (parts.length === 1) {
                effectiveVal = effective[parts[0]];
            }
            else {
                effectiveVal = effective[parts[0]]?.[parts[1]];
            }
            if (String(effectiveVal) !== String(result.after)) {
                console.log(`\n  Warning: effective value is "${String(effectiveVal)}" (overridden by CLI flag)`);
            }
        }
        catch (err) {
            console.error(`Error: ${err.message}`);
            process.exitCode = 1;
        }
    });
    // Default action: show resolved config with source annotations
    configCmd.action(() => showConfig());
}
function printKeysTable() {
    const meta = getKeyMetadata();
    const keyW = Math.max(...meta.map((m) => m.key.length)) + 2;
    const valW = Math.max(...meta.map((m) => m.values.length)) + 2;
    const defW = Math.max(...meta.map((m) => m.default.length)) + 2;
    console.log("KEY".padEnd(keyW) +
        "VALUES".padEnd(valW) +
        "DEFAULT".padEnd(defW) +
        "DESCRIPTION");
    console.log("─".repeat(keyW + valW + defW + 30));
    for (const m of meta) {
        console.log(m.key.padEnd(keyW) +
            m.values.padEnd(valW) +
            m.default.padEnd(defW) +
            m.description);
    }
}
function showConfig() {
    const cwd = process.cwd();
    const configPath = findConfigPath(cwd);
    const resolved = loadConfig({ cwd });
    if (configPath) {
        console.log(`# Config file: ${configPath}`);
    }
    else {
        console.log("# No config file found (using defaults)");
    }
    console.log();
    // Load file config for source detection
    let fileConfig = {};
    if (configPath) {
        fileConfig = parseYaml(readFileSync(configPath, "utf-8")) ?? {};
    }
    const meta = getKeyMetadata();
    const keyW = Math.max(...meta.map((m) => m.key.length)) + 2;
    for (const m of meta) {
        const parts = m.key.split(".");
        let fileVal;
        let resolvedVal;
        if (parts.length === 1) {
            fileVal = fileConfig[parts[0]];
            resolvedVal = resolved[parts[0]];
        }
        else {
            fileVal = fileConfig[parts[0]]?.[parts[1]];
            resolvedVal = resolved[parts[0]]?.[parts[1]];
        }
        const source = fileVal !== undefined ? "file" : "default";
        const displayVal = resolvedVal === undefined ? "(unset)" : String(resolvedVal);
        console.log(`  ${m.key.padEnd(keyW)} ${displayVal.padEnd(20)} (${source})`);
    }
    console.log(`\nRun 'planpong config keys' for valid values and descriptions.`);
}
//# sourceMappingURL=config.js.map