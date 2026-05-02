# Config visibility and mutation via CLI + MCP

**Status:** Approved
**planpong:** R4/10 | claude(claude-opus-4-6/high) → codex(gpt-5.3-codex/xhigh) | detail | 2P2 2P3 → 1P1 3P2 → 1P1 → 0 | Accepted: 8 | Rejected: 1 | +10/-0 lines | 8m 16s | Approved after 4 rounds

## Context

Users have no way to inspect or change their resolved planpong configuration without manually reading `planpong.yaml`. After upgrading models (e.g., codex 5.3 → 5.5) or toggling modes (inline vs external), the only confirmation is starting a review and reading the status line. This plan adds read and write access to the resolved config through both the CLI and MCP surfaces.

## Steps

- [ ] Add `planpong config` CLI command (read)
  - New file `src/cli/commands/config.ts`
  - Subcommands: `planpong config` (show resolved config), `planpong config path` (print config file path)
  - Output: YAML-formatted resolved config with annotations showing source (default / file / override)
  - Shows config file path (or "no config file found") at top
  - Register in `bin/planpong.ts`
- [ ] Add `planpong config set <key> <value>` CLI command (write)
  - Mutates the nearest `planpong.yaml` (or creates one in cwd if none exists — only when no config file found anywhere up the tree)
  - Supports dotted keys: `reviewer.model`, `planner.provider`, `max_rounds`, `planner_mode`, etc.
  - Scalar values only (string, number, boolean). List/object values must be edited in YAML directly.
  - Validates against `PlanpongConfigSchema` before writing
  - Preserves existing YAML formatting/comments (use `yaml` library's document API for round-trip editing)
  - After write, prints the *effective* value (resolved config) — includes warning if a CLI override still shadows the written value
  - Example: `planpong config set reviewer.model gpt-5.5-codex`
- [ ] Add `planpong_get_config` MCP tool (read)
  - New file `src/mcp/tools/get-config.ts`
  - No required params (optional `cwd`)
  - Returns: resolved config object + config file path + version + per-key `sources` map (provenance: "default" / "file" / "override")
  - Register in `src/mcp/server.ts`
- [ ] Add `planpong_set_config` MCP tool (write)
  - New file `src/mcp/tools/set-config.ts`
  - Params: `cwd` (optional), `key` (dotted path), `value` (string — coerced to number/boolean as schema requires), `confirm` (boolean, default false)
  - When `confirm: false` (default): dry-run — returns what *would* change without writing (before/after values, target file path, shadow warnings)
  - When `confirm: true`: performs the write and returns updated resolved config + shadow warnings if applicable
  - Scalar values only (same constraint as CLI)
  - Register in `src/mcp/server.ts`
- [ ] Shared config mutation logic
  - New file `src/config/mutate.ts`
  - `setConfigValue(cwd: string, key: string, value: unknown, opts?: { dryRun?: boolean }): { configPath: string; before: unknown; after: unknown }`
  - Key-path validation: reject unknown dotted paths via explicit allowlist derived from schema shape (e.g., `["planner.provider", "planner.model", "planner.effort", "reviewer.provider", ...]`). Required because Zod `z.object()` strips unknown keys silently rather than rejecting them.
  - Value validation: Zod parse of full merged config after applying the change
  - Handles: file discovery (or creation), YAML round-trip parse, dotted-key descent, atomic write (write to temp file + rename — prevents corruption from interrupted writes)
  - Used by both CLI and MCP tool
- [ ] Add `findConfigPath` export to `src/config/loader.ts`
  - Extract the path-discovery logic from `findConfigFile` into a reusable function that returns the path (or null) without reading/parsing
  - Both `config` command and `get_config` tool need this
- [ ] Tests
  - Unit: `setConfigValue` with existing file, no file (creates), invalid key, invalid value
  - Unit: `setConfigValue` atomic write — verify temp-file-then-rename pattern (simulate crash mid-write doesn't corrupt)
  - Unit: `findConfigPath` traversal
  - Unit: YAML round-trip preservation fixture — file with comments, multi-line strings; verify output matches input after no-op parse/stringify
  - Integration: `planpong config` output matches expected format
  - Integration: `planpong config set reviewer.model foo` → file updated → `planpong config` reflects change

## File References

| File | Change |
|---|---|
| `src/cli/commands/config.ts` | Create — `config` + `config set` subcommands |
| `src/mcp/tools/get-config.ts` | Create — `planpong_get_config` MCP tool |
| `src/mcp/tools/set-config.ts` | Create — `planpong_set_config` MCP tool |
| `src/config/mutate.ts` | Create — shared config mutation logic |
| `src/config/loader.ts` | Modify — export `findConfigPath` |
| `src/mcp/server.ts` | Modify — register new tools |
| `bin/planpong.ts` | Modify — register `config` command |

## Verification Criteria

- `planpong config` prints resolved config with source annotations and config file path
- `planpong config set reviewer.model gpt-5.5-codex` updates the YAML file and subsequent `planpong config` reflects it
- `planpong config set max_rounds 5` coerces to number, validates range, writes
- `planpong config set planner_mode inline` validates enum, writes
- `planpong config set foo.bar baz` fails with schema validation error
- MCP `planpong_get_config` returns the same resolved config as CLI
- MCP `planpong_set_config` with `key: "reviewer.model", value: "gpt-5.5-codex", confirm: false` returns dry-run preview (before/after) without writing
- MCP `planpong_set_config` with `key: "reviewer.model", value: "gpt-5.5-codex", confirm: true` updates file and returns new config
- Existing YAML comments/formatting are preserved after mutation
- When no config file exists, `config set` creates `planpong.yaml` in cwd with just the set field

## Key Decisions

- **Dotted-key syntax for set.** `reviewer.model` is unambiguous and matches how users think about the config. No need for separate `--planner-model` style flags — the config schema is the interface.
- **Round-trip YAML editing.** The `yaml` library's `Document` API preserves comments and formatting. Validated via test fixture with comments and multi-line strings. Exotic features (anchors, aliases, merge keys) are not expected in planpong configs and not guaranteed to round-trip — documented limitation.
- **Single shared mutation function.** CLI and MCP use the same `setConfigValue` — one validation path, one test surface. Writes are atomic (temp file + rename) to prevent corruption from interrupted processes.
- **No `config delete` or `config reset`.** Users can delete keys from YAML manually. Adding removal commands is scope creep for v1.
- **Source annotations in both CLI and MCP.** CLI shows inline annotations; MCP returns a `sources` map with per-key provenance. Both surfaces expose shadow warnings so agents and humans can reason about effective vs persisted state.
- **MCP write is dry-run by default.** `planpong_set_config` requires explicit `confirm: true` to write. This gives agents a safe preview step without needing a feature flag or capability gate.
- **Scalar-only write contract.** v1 only supports string/number/boolean values via `config set`. Structured values (lists, objects) must be edited in YAML directly. This is explicit scope — not an oversight.

## v2 Enhancements (out of scope)

- **Provider availability validation on config read.** `planpong config` and `planpong_get_config` could probe configured providers (e.g., `codex exec -m <model> "test"`) and surface access-tier errors inline. Motivation: `gpt-5.5-codex` is unavailable on ChatGPT accounts — this was only discovered after starting a session and hitting a 400 error. A config read that warns "reviewer model gpt-5.5-codex is not available with your current auth" would catch this before wasting a review session.
