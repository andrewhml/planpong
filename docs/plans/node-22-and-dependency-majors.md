# Node 22 Floor and Dependency Major Upgrades

**Status:** In progress (PR 2: zod 4)
**planpong:** R4/10 | claude(high) → claude(claude-opus-5-5/xhigh) | detail | 3P2 2P3 → 3P2 2P3 → 1P2 2P3 → 0 | Accepted: 13 | +27/-0 lines | 5m 19s | Approved after 4 rounds

## Context

`package.json` declares `engines.node: ">=18.0.0"`. That value came from the initial extraction commit (`facf628`) with no recorded rationale, and it is already false: dev-only vitest 4 requires Node 20+, which is why the CI matrix added in #55 tests 20, 22, 24 and not 18. Node 18 went end-of-life 2025-04-30 and Node 20 on 2026-04-30; 22 is maintenance LTS until 2027-04-30, 24 is active LTS until 2028-04-30, and 26 is current and becomes LTS in October 2026 ([endoflife.date/nodejs](https://endoflife.date/nodejs)).

Every dependency has a newer major, and the newest majors require Node 22:

| Package | Current | Target | Node floor | Code changes needed |
|---|---|---|---|---|
| @inquirer/prompts | 7.10.1 | 8.7.2 | `^22.13.0` on the 22 line | none |
| chalk | 5.6.2 | 6.0.0 | `>=22` | none |
| commander | 13.1.0 | 15.0.0 | `>=22.12.0` | none (help output byte-identical) |
| execa | 9.6.1 | 10.0.1 | `>=22` | none (result fields identical in probes) |
| ora | 8.2.0 | 9.4.1 | `>=20` | none |
| vitest (dev) | 4.0.18 | 5.0.2 | `^22.12 \|\| ^24 \|\| >=26` | none |
| typescript (dev) | 5.9.3 | 7.0.2 | n/a | add `"types": ["node"]` to tsconfig |
| zod | 3.25.76 | 4.6.5 | none | replace JSON Schema generator; 4 test regexes |
| @modelcontextprotocol/sdk | 1.27.1 (lockfile) | 1.30.1 | `>=18` | none |
| @types/node (dev) | 22.19.13 | ^22.20.4 | n/a | none; track the engines floor, not latest |
| ajv, tsx, yaml | minor bumps | latest minor | unchanged | none |

Evidence (research on 2026-09-25, each upgrade applied in scratch copies of the repo on Node 26.0.0):
- All targets together, plus the two code edits below: `tsc --noEmit` clean, 495/499 tests pass; the 4 failures are zod default error-message regexes in `src/config/mutate.test.ts:146,152,169,180`.
- `@inquirer/prompts` 8: `select<WizardChoice>` with a `Symbol` value (`init.ts`), `input` with `validate`, `confirm`, and `ExitPromptError` on Ctrl-C all behave identically to 7.
- execa 10: spawn ENOENT (`code: 'ENOENT'`, `exitCode: undefined`), timeout (`timedOut: true`), `input`, `env` + `extendEnv: false`, `reject: false` all identical to 9. Codex catalog fallback (`codex.ts`) depends on the ENOENT shape.
- TypeScript: 6.0 and 7.0 default `types` to `[]`, which produces ~100 TS2591 errors (`process`, `node:fs`) until `"types": ["node"]` is set. Nothing else in `tsconfig.json` is deprecated (`module`/`moduleResolution: Node16`, `esModuleInterop: true`, explicit `rootDir`, `strict`). TS 7 (the native port) emits byte-identical `.js` for all 43 files versus 5.9; 14 `.js.map` files differ in `mappings` only and one `.d.ts` differs only in union member order. `tsc --noEmit`: 1.8s on 5.9, 0.7s on 7.0. TS 7 has no JS API until 7.1; nothing in this toolchain uses it (tsx and vitest use esbuild/Vite; no typescript-eslint).
- zod 4 and JSON Schema: `zod-to-json-schema` (deprecated, unmaintained since November 2025) does not support zod 4 schemas. It fails typecheck at `src/schemas/json-schema.ts` and **at runtime silently returns `{"$schema": "..."}` with no properties**, which would ship an empty schema to `claude --json-schema` and `codex --output-schema`. Replacing it with `z.toJSONSchema(schema, { target: "draft-7" })` and keeping the existing `stripObservabilityFields` and `toOpenAIStrict` post-processing produces final schemas **deep-equal** to today's for Direction, Risk, Review, PlannerRevision, and EditsRevision.
- MCP SDK 1.30.1 accepts zod 4 via plain `import { z } from "zod"` (declares `zod: ^3.25 || ^4.0`). An in-memory client registered all 9 tools and 5 prompts; bad arguments return a readable error. Difference: tool `inputSchema` no longer carries `additionalProperties: false`.

Two existing bugs found during research:
- `bin/planpong.ts:74` calls `program.parse()` while command actions are async (`config set`, `config providers`, `init`, `review`, `plan`). Commander documents `parseAsync()` for async actions; with `parse()`, a rejected action promise is not awaited by commander.
- `src/schemas/json-schema.test.ts` "refinement violation passes JSON Schema but fails Zod" passes for the wrong reason: the `approved_with_notes` refinement moved to `convergence.ts`, and the payload is rejected only because `quoted_text: null` fails `.optional()`.

## Non-goals

- Migrating `server.tool()` to `registerTool()` (deprecated in SDK 1.30 typings, still works).
- Replacing `.strict()` with `z.strictObject` (deprecated, still works in zod 4).
- Reviewer context strategy (separate design).

## Decisions

- **`engines.node: ">=22.13.0"`.** The binding constraint is `@inquirer/prompts` 8.7.2 (`^22.13.0` on the 22 line); commander 15 and vitest 5 need 22.12. Node 20 is EOL, so no supported runtime is dropped.
- **TypeScript 7.0.2**, not 6.0.3. The gain is modest (identical emitted JS; `tsc --noEmit` 1.8s to 0.7s in research; the pre-commit hook runs `npm run build`, a full emit, on every commit touching `.ts`, and Step 3 measures that build on 5.9 vs 7.0 and records it in the PR), and the cost is running a new native port at x.0.2. The choice is low-stakes and cheap to reverse: 6.0.3 has the same type checker and needs the same `"types": ["node"]` change. **Reversal rule:** pin `typescript@6.0.3` if any of these happen: a compiler crash or a type error that 6.0.3 does not report; emitted `.js` differing from 6.0.3; a missing native binary on a platform we build on; or a need for the TS JS API (e.g. typescript-eslint) before 7.1.
- **`@types/node ^22`**: types for the minimum supported Node, so code can't compile against APIs Node 22 lacks.
- **CI matrix `["22", "24", "26"]`.**
- **Release as 0.8.0.** Pre-1.0, so a minor bump signals the breaking engines change. Release notes call out: Node 22.13+ required; validation messages from `config set` and the MCP `set_config` tool changed wording (zod 4 defaults).

## Sequencing

Three PRs, each behind the CI gate:

- **Where the work happens:** this Mac's planpong MCP registration runs `node /Users/andrewlee/workspace/personal/planpong/dist/bin/planpong-mcp.js` from this working tree (`claude mcp get planpong`), launched with `/opt/homebrew/bin/node` v26.0.0 (above the new floor, so the Step 4 guard does not block it). Branch checkouts and pre-commit rebuilds in this tree would swap the code under the review tool mid-session, and the dogfooding rule needs that tool working. So PRs 1 and 2 are implemented in a separate git worktree; this tree stays on `main` until 0.8.0 ships. PR 0 is small and on current deps, so it can use either.
- **Setup, before PR 1:**
  1. Land this plan (with PR 0), then in this tree `git checkout main && git pull`. This tree is currently on the plan branch `chore/node-22-deps` with the plan uncommitted, so this step is what actually returns it to `main`.
  2. `git worktree add ../planpong-node22 -b chore/node-22-majors main`.
  3. In the worktree: `npm ci`. The worktree has no `node_modules`; the pre-commit hook (shared via `core.hooksPath`) runs `npm run build` there and needs the worktree's own TypeScript.
  4. Confirm `claude mcp get planpong` still points at this tree's `dist/`, not the worktree.
- **Verifying the new code through MCP** must target the worktree's server explicitly; the registered `planpong` server runs this tree's `main` build and would pass regardless. Add `scripts/mcp-smoke.ts`: it spawns `node <path>/dist/bin/planpong-mcp.js` over stdio with the MCP SDK client, prints the absolute server path it launched (so the result can't be confused with the registered server), lists tools, calls `planpong_start_review` on a scratch plan with a real reviewer, runs one `planpong_get_feedback`, and sends one malformed call to confirm validation errors stay readable. PR 1 and PR 2 verification run it against `../planpong-node22`.
- **PR 0:** Step 0 (the two existing bug fixes, on current dependencies, so their effect is observed in isolation from any upgrade)
- **PR 1:** Steps 1-4 (platform: Node guard, engines, CI, tsconfig, runtime and dev majors). Kept as one PR: research ran every target together (typecheck clean, suite green apart from the zod messages), and each step is its own commit, so `git bisect` within the PR is the fallback if a regression appears.
- **PR 2:** Steps 5-7 (zod 4). Isolated because zod parses model output and user config files, not just schema generation.
- Then release 0.8.0.

## Steps

### PR 0: Existing bug fixes (current dependencies)

- [x] **Step 0: Fix the two existing bugs**
  - `bin/planpong.ts`: `await program.parseAsync()` (top-level await is valid in the ESM entrypoint). Verify a failing async action (e.g. `config set max_rounds 999` or an unreadable config) still sets a non-zero exit code and prints the error once.
  - `src/schemas/json-schema.test.ts`: rename the misleading test to what it asserts (JSON Schema accepts `quoted_text: null` that Zod rejects) or rewrite it to exercise the `approved_with_notes` rule where it now lives in `convergence.ts`; pick whichever keeps a real assertion, and state it in the PR.

### PR 1: Node 22 floor, runtime and tooling majors

- [x] **Step 1: Node floor**
  - `package.json`: `engines.node` to `">=22.13.0"`.
  - `.github/workflows/ci.yml`: matrix `["22", "24", "26"]`; replace the Node 18 comment with one stating the floor and why (`@inquirer/prompts` 8 and commander 15).
  - `publish.yml` stays on Node 24 (OIDC trusted publishing).
  - `tsconfig.json`: add `"types": ["node"]` (harmless on 5.9, required on 6/7).
  - `@types/node` to `^22.20.4`.
  - README Prerequisites: state Node 22.13+.
- [x] **Step 2: Runtime majors** (no code changes expected): `@inquirer/prompts@^8.7.2`, `chalk@^6.0.0`, `commander@^15.0.0`, `execa@^10.0.1`, `ora@^9.4.1`, `@modelcontextprotocol/sdk@^1.30.1`, `yaml@^2.9.1`. Run `npm install` to refresh the lockfile.
- [x] **Step 3: Dev majors**: `vitest@^5.0.2` (installs `vite` as its peer), `typescript` pinned **exactly** to `7.0.2` (no caret: a patch release that changes emit order would fail the dist gate on every PR), `tsx`, `ajv` latest minors.
  - Confirm `dist/` after a clean rebuild differs from the previous build only in `.js.map` mappings and the one `.d.ts` union order, and commit the rebuilt `dist/` (the CI dist gate enforces consistency).
  - **Determinism check before committing to TS 7:** research compared one TS 7 build against 5.9; it did not show TS 7 is stable across runs, and the `.d.ts` union-order change suggests emit depends on type-creation order, which a parallel native checker could vary. Build from an empty `dist/` three times locally and diff all three; then rely on the CI dist gate, which already rebuilds from empty on three Node versions (three independent runs on a different OS). Any difference in either check triggers the reversal rule (pin 6.0.3).
- [x] **Step 4: Clear failure on old Node**
  - `engines` is advisory and never shown when Claude Code spawns the MCP server directly (`node .../planpong-mcp.js` or `npx`), so on Node 20 the new majors would crash at import and the user would see only "failed to connect".
  - ESM hoists static imports, so a guard at the top of the current entrypoints would run too late. Split each bin into a guard plus the real entry: `bin/planpong.ts` and `bin/planpong-mcp.ts` import only `node:process`-level builtins, compare `process.versions.node` against the minimum (read from `package.json` `engines` so there is one source of truth; fall back to a constant if unreadable), and on failure write `planpong requires Node >= 22.13.0; found <version> at <process.execPath>. Upgrade Node or point your MCP config at a newer node.` to stderr and exit 1. On success they `await import("../src/cli/main.js")` / `await import("../src/mcp/main.js")`, which hold the current entry code unchanged.
  - For the MCP server, stderr is what Claude Code records for a failed server, so the message is visible in its MCP logs.
  - The `package.json` path differs between tsx dev (`bin/`), repo `dist/bin/`, and an installed package, so resolve it relative to the guard file with a check for each layout, and never fall back silently: if the file can't be read, use the constant **and** that constant is kept equal to `engines` by a test.
  - Tests: version comparison (22.12.9 fails, 22.13.0 passes, 26.0.0 passes, malformed version passes through rather than blocking); the fallback constant equals the `package.json` `engines` floor; the resolved `package.json` path is found from both `bin/` (tsx) and `dist/bin/`.
  - Smoke: both bins under `npx -y node@20` assert exit 1 and the message, run twice: from repo `dist/`, and from an `npm pack` tarball installed into a temp prefix (the layout real users get).
  - README troubleshooting: "MCP server fails to connect" → check the Node version the MCP config launches.
- [ ] **PR 1 verification**
  - `npm ci && npm run typecheck && npm test` green; CI green on 22/24/26.
  - Built CLI smoke on Node 22 and 26 (`npx -y node@22`): `planpong --help`, `config providers`, `config set`/`unset` in a temp dir, and `planpong init` driven by `expect` (same script as #56: provider switch and pinned-model preservation).
  - Live review round from `dist/` (codex reviewer structured, claude planner with `--effort low` structured), as in #56.
  - MCP: `scripts/mcp-smoke.ts` against `../planpong-node22/dist` boots the server, lists all tools, and completes one real round; the printed server path is the worktree.

### PR 2: zod 4

- [x] **Step 5: Lock current behavior before migrating** (first commit of PR 2, on zod 3, so every fixture provably predates zod 4)
  - **JSON Schema golden:** serialize every schema exported by `src/schemas/json-schema.ts` (all phases, both revision modes) to a committed fixture; a test compares against it.
  - **Parse-behavior golden (committed, synthetic):** a fixture set of model-output payloads run through the real parse entry points (`parseStructuredFeedbackForPhase`, `parseFeedbackForPhase` for prompted text, and the revision parsers in `convergence.ts`), recording for each the parsed object or the rejection. Cases: every phase's valid output; `null` where a field is `.nullable()` and where it is only `.optional()`; missing optional fields and fields with `.default()`; extra unknown keys on plain and `.strict()` objects; wrong enum values; prompted-mode text with the `<planpong-feedback>` wrapper; the `approved_with_notes` rule. The test asserts identical parsed objects and identical accept/reject outcomes.
  - **Parse-behavior replay (local, not committed; secondary evidence):** this repo is public, and the real corpus (204 `round-*-feedback.json` / `round-*-response.json` files under `~/workspace/*/*/.planpong/sessions`) contains private plan text from other projects. These files are **post-parse** objects, not raw provider output: feedback files already carry parser-added fields (`verified`, `unverified_count`, `quote_compliance_warning`) and response files hold the applied `updated_plan`. Replaying them shows that real-world, already-normalized shapes still parse identically; it cannot show how zod 4 treats raw edge-case output. Raw provider output is not persisted anywhere, so the committed synthetic golden above is the primary evidence for parse behavior, and the live structured and prompted rounds in Step 7 are the raw-output check. Add `scripts/replay-parse-corpus.ts` that takes a directory list, runs each file through the same parse entry points, and writes a results file (outcome plus a hash of the parsed object) to a gitignored path. Run it on zod 3 before the migration and on zod 4 after; the PR states the file count and that the two results files are identical, without including content.
  - **Persisted-input compatibility:** `session.json` is read without zod (`session.ts:141`, raw cast), so zod 4 cannot change how it loads; say so in a code comment near the golden tests. What *is* zod-parsed from disk: the user's `planpong.yaml` (`PlanpongConfigSchema.parse`, `loader.ts:143`) and round metrics (`RoundMetricsSchema.parse`, `session.ts:290`, read by the MCP `status` tool at `status.ts:102`). Add committed fixtures: a minimal config, a full config with every key, a config with a deprecated/unknown key, a 0.6.x-era metrics file using the old `"legacy"` mode value (handled by the `z.preprocess` in `metrics.ts`), and a current metrics file. Assert each loads to the same object (or fails with the same issue path) before and after.
- [x] **Step 6: Migrate**
  - `zod@^4.6.5`; remove `zod-to-json-schema` from dependencies.
  - `src/schemas/json-schema.ts`: replace the `zodToJsonSchema` call with `z.toJSONSchema(schema, { target: "draft-7" })`; keep `stripObservabilityFields` and `toOpenAIStrict` unchanged. The golden test must pass unchanged.
  - Add a guard test that every generated schema has a non-empty `properties` object, so a silently empty schema (the zod-to-json-schema failure mode) can never ship.
  - `src/config/mutate.test.ts:146,152,169,180`: update the four regexes to zod 4 default messages.
  - Grep for any other code or test matching zod's default message text or issue codes (`invalid_enum_value` became `invalid_value`); `convergence.ts` embeds `error.message` in `ZodValidationError` text but nothing parses it. Confirm and note.
- [x] **Step 7: PR 2 verification**
  - Full suite and CI green.
  - Live review round from `dist/` in structured mode for both providers (codex `--output-schema`, claude `--json-schema`), confirming no downgrade to prompted mode in the round metrics.
  - MCP: run `scripts/mcp-smoke.ts` against `../planpong-node22/dist` (not the registered server) for one real review round with each reviewer provider; confirm the printed server path is the worktree, tool calls validate, structured mode in the round metrics, and bad input still errors readably.

### Release

- [ ] Docs gate: README Node requirement; release-note text for the validation-message change.
- [ ] `npm version minor` → 0.8.0, push with tags; confirm the publish workflow and `npm view planpong@latest`.
- [ ] Post-release check: run one real `/pong-review` round per provider through the released package (`npx -y planpong@0.8.0` MCP, or the repo `dist/` at the tag) and confirm structured mode in the round metrics.
- [ ] **Rollback, if needed.** npx-based MCP registrations pick up `latest` automatically, so a bad 0.8.0 reaches users without them acting. Triggers: any structured-mode round falling back to prompted where 0.7.0 did not; a parse or config-load failure on input 0.7.0 accepted; the Node guard rejecting a supported Node (>= 22.13.0). Steps: `npm dist-tag add planpong@0.7.0 latest` (restores the previous version for new installs and npx), `npm deprecate planpong@0.8.0 "<reason>; use 0.7.0 or wait for 0.8.1"`, open an issue with the evidence, then fix forward as 0.8.1 and move `latest` back with a normal publish. Note that `npm dist-tag` and `npm deprecate` need an authenticated npm user with publish rights; CI publishes via OIDC, so these are run by the maintainer.

## Risks and mitigations

- **Users on Node 18/20 lose installs of new versions.** Both lines are EOL; 0.7.0 remains installable for them. npm's engines warning is not seen when Claude Code spawns the MCP server, so Step 4's entry guard prints an explicit version message instead of an import crash. Called out in release notes and README troubleshooting.
- **zod 4 changes how model output or user config parses.** Primary: the synthetic parse-behavior golden and config/metrics fixtures, recorded on zod 3 before the migration, plus live raw-output rounds in Step 7. Secondary: the local replay over 204 real post-parse round files.
- **The upgrade breaks the review tool mid-work.** PRs 1 and 2 run in a separate worktree; this tree, which the MCP registration runs from, stays on `main` until release.
- **An empty or altered JSON Schema reaches the model.** Mitigated by the golden fixture from zod 3, the non-empty-properties guard, and a live structured-mode round per provider.
- **MCP tool input schemas lose `additionalProperties: false`.** Unknown arguments become accepted by clients instead of rejected; the server's zod parse still strips them. No planpong tool depends on rejecting extra keys. Accept and note.
- **TS 7 native binary unavailable on some platform.** It ships as optional per-platform packages; CI (linux x64) and this Mac (darwin arm64) are covered. If a contributor platform lacks a binary, pin TS 6.0.3 (same checker, JS implementation).
- **vitest 5 `clearMocks: true` default hides a test that relied on shared mock state.** The suite passes on 5.0.2 in research; any future failure is visible in CI.
- **`parseAsync` changes error-exit timing.** Landed alone in PR 0 on current dependencies and covered by the explicit failing-action check.
