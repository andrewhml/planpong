# Add a `--version` flag to the CLI

**Status:** Draft

## Context

The CLI prints help with `--help` but there's no way to print the installed version. Support threads regularly include guessed or outdated version numbers because users have to open `package.json` to find it.

## Steps

- [ ] Add a `--version` flag to the commander program registration in `src/cli/index.ts`
- [ ] Load the version using a JSON import: `import pkg from "../../package.json" with { type: "json" }` and pass `pkg.version` to `program.version()`
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

- Use commander's built-in `.version()` rather than a custom handler — standard ecosystem convention, no benefit to reinventing it.
- Prefer a static JSON import over `fs.readFileSync` + `JSON.parse` — it's evaluated once at module load and gets type-checked.
