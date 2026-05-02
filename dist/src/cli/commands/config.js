import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { loadConfig, findConfigPath } from "../../config/loader.js";
import { setConfigValue, getValidKeys } from "../../config/mutate.js";
export function registerConfigCommand(program) {
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
        }
        else {
            console.log("No config file found");
            process.exitCode = 1;
        }
    });
    configCmd
        .command("set")
        .description("Set a config value")
        .argument("<key>", `Dotted config key (${getValidKeys().join(", ")})`)
        .argument("<value>", "Value to set")
        .action((key, value) => {
        const cwd = process.cwd();
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
    configCmd.action(() => {
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
        // Print each key with source annotation
        for (const key of getValidKeys()) {
            const parts = key.split(".");
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
            console.log(`  ${key}: ${displayVal}  (${source})`);
        }
    });
}
//# sourceMappingURL=config.js.map