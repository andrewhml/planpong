# Add a `--version` flag to the CLI

**Status:** Draft

## Context

The CLI prints help with `--help` but there's no way to print the installed version. Support threads regularly include guessed or outdated version numbers because users have to open `package.json` to find it.

## Steps

- [ ] Add a `--version` flag to the commander program registration in `src/cli/index.ts`
- [ ] Read the version from `package.json` at startup and pass it to `program.version()`
- [ ] Update the CLI's top-level help to mention `--version`
- [ ] Add a `--config <path>` global flag that lets users point the CLI at a custom config file (default: `~/.notesrc`). Wire it through every subcommand so config is loaded before the action runs.
- [ ] Implement a config loader at `src/config/loader.ts` that parses YAML or JSON and validates it against a schema
- [ ] Add a `notes config init` subcommand that scaffolds a default config file at `~/.notesrc`
- [ ] Document the config file format and precedence rules (CLI flag > env var > default path) in the README

## File References

| File | Change |
|---|---|
| `src/cli/index.ts` | Register version + config flag on the commander program |
| `src/config/loader.ts` | New — parse and validate config files |
| `src/commands/config-init.ts` | New — scaffold default config |
| `README.md` | Document the config flow |

## Verification Criteria

- `notes --version` prints the version string from `package.json`
- `notes -V` (commander's short alias) also prints the version
- `notes --help` lists `--version` in the options

## Key Decisions

- Use commander's built-in `.version()` rather than a custom handler — standard ecosystem convention, no benefit to reinventing it.
- Bundle the config flag work with the version flag work since both touch the program registration block.
