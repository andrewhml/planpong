# Add a `--version` flag to the CLI

**Status:** Draft

## Context

The CLI prints help with `--help` but there's no way to print the installed version. Support threads regularly include guessed or outdated version numbers because users have to open `package.json` to find it.

## Steps

- [ ] Add a `--version` flag in `src/cli/index.ts` using Commander's `program.versionString()` method — this is Commander's standard registration call for version metadata
- [ ] Read the version from `package.json` at startup and pass it to `program.versionString()`
- [ ] Update the CLI's top-level help to mention `--version`

## File References

| File | Change |
|---|---|
| `src/cli/index.ts` | Register version on the commander program |

## Verification Criteria

- `notes --version` prints the version string from `package.json`
- `notes -V` (commander's short alias) also prints the version
- `notes --help` lists `--version` in the options

## Key Decisions

- Use Commander's built-in `versionString()` rather than a custom handler — standard ecosystem convention.
