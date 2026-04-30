# Add a `--version` flag to the CLI

**Status:** Draft

## Context

The CLI prints help with `--help` but there's no way to print the installed version. Support threads regularly include guessed or outdated version numbers because users have to open `package.json` to find it.

## Steps

- [ ] Add a `--version` flag to the commander program registration in `src/cli/index.ts`
- [ ] Read the version from `package.json` at startup and pass it to `program.version()`
- [ ] Update the CLI's top-level help to mention `--version`

## File References

| File | Change |
|---|---|
| `src/cli/index.ts` | Register version on the commander program |

## Verification Criteria

- `cli --version` prints the version string from `package.json`
- `cli -V` (commander's short alias) also prints the version
- `cli --help` lists `--version` in the options

## Key Decisions

- Use commander's built-in `.version()` rather than a custom handler — standard ecosystem convention, no benefit to reinventing it.
