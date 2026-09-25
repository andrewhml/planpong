# Provider Refresh and CI Test Gate

**Status:** In progress (PR 1: CI gate)
**planpong:** R5/10 | claude(claude-opus-4-6/high) → codex(gpt-6-astra/xhigh) | detail | 0 → 2P2 2P3 → 1P1 3P2 1P3 → 2P2 → 0 | Accepted: 11 | +24/-0 lines | 22m 40s | Approved after 5 rounds

## Context

Planpong's last release was 0.6.2 (2026-05-07). Since then the provider CLIs have moved and planpong's assumptions about them have drifted. An audit on 2026-09-25 against claude 2.1.282, codex-cli 0.157.0, and gemini 0.40.1, plus metrics from 90 review attempts across 4 repos, found:

1. **Gemini failures are unreadable.** winnow session `a34ce3810290` R1 failed in 1.9s as `fatal`. Reproduced: gemini writes `MCP issues detected. Run /mcp list for status.` to stdout and the real error to stderr (`IneligibleTierError ... UNSUPPORTED_CLIENT ... migrate to the Antigravity suite`). Because stdout is non-empty, `GeminiProvider.invoke` (`src/providers/gemini.ts`) takes the envelope-parse branch and reports only `could not parse gemini JSON envelope`; stderr never reaches the user. The same shape of bug exists in the other providers in weaker form: `classifyError` and `logClassificationFailure` keep the *first* 500 chars of stderr, but CLI errors usually print the useful line last (after banners and before/after stack frames).
2. **Codex model and effort lists are fully stale.** `src/providers/codex.ts:17` lists `gpt-5.3-codex, o3-pro, o3, o4-mini`; `codex debug models` lists none of them. Current list-visible models are `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`. Effort levels are per model now (`gpt-5.5` stops at `xhigh`; `luna` models have `max` but no `ultra`; others add `ultra`, described as "maximum reasoning with automatic task delegation"). Closes #18.
3. **Claude effort is silently dropped.** `ClaudeProvider.invoke` never reads `options.effort` and `getEffortLevels()` returns `["default"]`, while `claude --effort <low|medium|high|xhigh|max>` exists. A user who sets `planner.effort` or `reviewer.effort` for claude gets no effect and no warning. Claude also now has a `fable` alias missing from `MODELS`. Closes #19.
4. **Inline mode stamps the wrong planner (#54).** The status line is built from `formatProviderLabel(config.planner)` at `src/core/operations.ts:295` (`buildStatusLine`) and `:403` (`initReviewSession`), so an inline session run from, e.g., a Fable session reads `claude(opus) → codex(...)` even though opus never ran. Revision metrics already record `planner_mode: "inline"` correctly; only the plan-file status line is wrong.
5. **Codex errors are also lost, and this repo's own config pins a dead model.** `planpong.yaml` here sets `reviewer.model: gpt-5.3-codex`. Running it now fails with `400 invalid_request_error: The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.` That message arrives only as `error` / `turn.failed` JSONL events on stdout (planpong always passes `--json`), not on stderr, so `CodexProvider.invoke` classifies from an unrelated stderr and the reason is dropped. Same failure mode as gemini, different stream.
6. **No test gate.** `.github/workflows/publish.yml` builds and publishes on tag; nothing runs `npm test` or `npm run typecheck` on PRs or before publish. The only gate is the local pre-commit hook, which rebuilds `dist/` but does not test.

Decision already made (2026-09-25): keep model lists current via **live discovery with a static fallback**, not hand-maintained lists alone.

### Why the lists matter less than they look

Model selection itself is not broken. `DEFAULT_CONFIG` sets no model, so an unconfigured provider uses the CLI's own default (codex reads `~/.codex/config.toml`), and any explicit model string is passed through. The lists only drive three surfaces, all in the CLI layer:

- `src/cli/commands/init.ts:227,235,262,270`: wizard model and effort choices
- `src/cli/commands/config.ts:33`: `getUnknownValueWarning` soft validation on `config set`
- `src/cli/commands/config.ts:200-201`: `planpong config providers` table

No MCP tool and no core operation calls `getModels()` or `getEffortLevels()`.

## Non-goals

- Reviewer prompt size / diff-vs-full-plan strategy. Separate design conversation (critical to review quality).
- Codex `--sandbox read-only` for reviewers (#21). Deprioritized.
- Node engine bump and dependency upgrades. Sequenced after this plan's CI gate lands, with its own research note (see "Follow-up").
- Deprecating the gemini provider. This plan makes its failure legible; whether to keep it is a later call.
- Validating the configured model at review start against the live catalog.

## Sequencing

Two PRs. The CI gate lands first so the provider changes merge behind it.

- **PR 1:** Steps 1–2 (CI gate)
- **PR 2:** Steps 3–8 (provider refresh), then release as 0.7.0 (minor: the `Provider` interface gains a method and claude now honors effort, which changes behavior for anyone who had set it)

## Steps

### PR 1: CI test gate

- [x] **Step 1: Add `.github/workflows/ci.yml`**
  - Triggers: `pull_request` (all branches) and `push` to `main`.
  - Matrix: Node `20`, `22`, `24`. Node 18 is excluded because dev-only vitest 4 requires `^20 || ^22 || >=24`; record that in a comment, since it is evidence for the later engines discussion.
  - Steps: `actions/checkout`, `actions/setup-node` with `cache: npm`, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
  - `npm run build` is included because `dist/` is committed and the pre-commit hook regenerates it; a clean `tsc` in CI catches a source change that only compiled locally against stale state.
  - Add a dist consistency check to catch commits where `dist/` is out of sync with `src/` (e.g. hook bypassed with `--no-verify`). `git diff --exit-code` alone misses new untracked outputs, and plain `tsc` never removes outputs for deleted sources, so the step is: `rm -rf dist && npm run build && test -z "$(git status --porcelain -- dist/)"`, printing `git status --porcelain -- dist/` on failure. This catches modified, deleted (stale committed file with no source), and untracked (new source never committed to dist) outputs.
  - Verify the gate on a scratch branch against three cases before merging: an edited source with stale dist, an added module whose dist was not committed, and a removed module whose dist was left behind. Each must fail; a clean tree must pass. If tsc output differs across Node versions, run this check on the Node 24 leg only.
- [x] **Step 2: Gate publish on tests**
  - In `publish.yml`, add `npm run typecheck` and `npm test` before `npm publish` (after `npm install`). Publish stays on Node 24 (required for OIDC trusted publishing, commit `c1352f6`).
  - Branch protection (require `ci` checks on `main`) is a GitHub settings change: propose it to the user in the PR description; do not apply it from the agent.

### PR 2: Provider refresh

- [ ] **Step 3: Surface real provider errors (all three providers)**
  - Add `summarizeStderr(stderr: string, max = 800): string` to `src/providers/shared.ts`. Strategy: strip ANSI codes; drop stack-frame lines (`/^\s+at /`); prefer the last line matching `/error|fail|denied|unsupported|invalid|not (found|supported)/i`; otherwise return the tail `max` chars. Pure function, unit-tested with the captured gemini stderr as a fixture.
  - Use it in `classifyError` for claude, codex, gemini and in `logClassificationFailure` (replacing `stderr.slice(0, 500)`). Keep the full `stderr` on `ProviderError.stderr` unchanged.
  - Gemini-specific: in the envelope-parse-failure branch of `GeminiProvider.invoke`, when `extractResponse` fails and stderr is non-empty, the error message becomes `summarizeStderr(stderr)` with the envelope failure appended as context, not the envelope failure alone.
  - Add a known-error table in `gemini.ts`: `IneligibleTierError` / `UNSUPPORTED_CLIENT` maps to a message that states only what was observed: `gemini CLI rejected this account (IneligibleTierError: UNSUPPORTED_CLIENT). Provider reason: <reasonMessage verbatim>. To keep reviewing now, set reviewer.provider to claude or codex.` No claims about which account tiers work or about Google's policy beyond the provider's own reason text, since our evidence is one account's rejection.
  - Codex-specific: add `extractCodexError(stdout)` next to `extractCodexThreadId` in `codex.ts`. Scan `--json` JSONL events for `type: "turn.failed"` (`error.message`) or `type: "error"` (`message`); if the message is itself a JSON string with `error.message`, unwrap it. When present, it becomes the `ProviderError.message` (stderr summary appended). Also surface `item.completed` items of `type: "error"` whose message starts with `Model metadata for` as a warning line, since that is codex's only hint that a model slug is unknown. Tests use the captured `gpt-5.3-codex` event sequence as a fixture.
  - **Codex success path must not accept the event stream as output.** Today `CodexProvider.invoke` falls back to `result.stdout` when the `-o` file is missing, and returns `ok: true` for any non-empty content before any classification. With `--json` always on, stdout is JSONL events, so a `turn.failed` run with no output file returns the event stream as "model output" and the failure surfaces later as a parse error (and can mark the provider non-capable). New order in `invoke`: (1) `extractCodexError(stdout)`; if it finds a terminal failure (`turn.failed` or a top-level `error` event), return `ok: false` classified from the combined evidence, regardless of any output. (2) Read the `-o` file; if present and non-empty, success. (3) If absent or empty, recover the final message from the last `item.completed` event with `item.type === "agent_message"`; if found, success. (4) Otherwise failure. Raw stdout is never returned as output. Tests: failure events + no file; failure events + empty file; success with file; success without file but with an `agent_message` event; neither.
  - **Claude error envelopes are classified, not assumed capability.** Today any JSON envelope without `structured_output` returns `capability` directly (`claude.ts`), so an `is_error: true` envelope (auth failure, rate limit, API error) triggers a prompted retry and marks the provider non-capable for the session. New order when `jsonSchema` is set: parse the envelope; if `is_error === true` or `subtype` starts with `error`, build evidence from `result`, any `error` field, and stderr, and return `ok: false` through `classifyError` (fatal unless it matches the capability patterns). Only a successful envelope (`is_error` false) lacking `structured_output` stays `capability`. Tests: auth-error envelope → `fatal`, no downgrade, capability cache untouched; success envelope without `structured_output` → `capability` (unchanged).
  - **Classification and display use the same evidence.** Each provider builds one `failureEvidence` string from every stream the CLI may report errors on: codex = `extractCodexError(stdout)` + stderr; gemini = envelope `error.message` or non-JSON stdout + stderr; claude = error-envelope `result`/`error` fields, or non-envelope stdout, + stderr. `classifyError(evidence, exitCode)` takes that combined text (full, unsummarized); `summarizeStderr` is applied only to the displayed `message`. This prevents a stdout-only capability error (e.g. codex rejecting `--output-schema` in a JSON event) from being classified `fatal` off an unrelated stderr, and the reverse.
  - Planpong's state machine has two outcomes only: `capability` downgrades structured to prompted once, `fatal` is terminal (`operations.ts` `invokeWithStateMachine`; there is no transient retry). Tests assert the outcome per fixture, not just the message: (a) codex invalid-model 400 in stdout events → `fatal`, message contains the 400 reason; (b) codex schema rejection appearing only in stdout events → `capability`; (c) gemini tier rejection → `fatal` with provider reason; (d) claude unknown-option on stderr with empty stdout → `capability` (unchanged behavior).
  - Classification of the invalid-model 400: confirm the codex capability patterns (flag and schema wording only) do not match `invalid_request_error ... model is not supported`, and keep the test from (a).
  - Update this repo's `planpong.yaml`: `reviewer.model` from `gpt-5.3-codex` to a current slug (or remove the pin to follow the codex CLI default), and `planner.model` from `claude-opus-4-6` to the `opus` alias (or remove). Decide with the user in the PR; the dogfood config should not pin dead or aging slugs.
  - Verify the message reaches the MCP client: `operations.ts:628` already formats `response.error.message` into the thrown error, so the fix at the provider layer is sufficient. Add a test in `operations.test.ts` that a gemini provider stub returning this error yields a thrown message containing `UNSUPPORTED_CLIENT`.
- [ ] **Step 4: Model catalog interface**
  - In `src/providers/types.ts`, add:
    ```ts
    export interface ModelInfo { id: string; efforts: string[]; defaultEffort?: string; }
    export interface ModelCatalog { source: "live" | "static"; models: ModelInfo[]; efforts: string[]; note?: string; }
    ```
    `efforts` at the catalog level is the **intersection** across list-visible models: the levels safe for whatever model the CLI resolves by default. For the current codex catalog that is `low, medium, high, xhigh` (`gpt-5.5` has no `max`). A union would offer `max` on the default-model path and could produce a config the default model rejects.
    Add `allEfforts: string[]` (the union) used only for soft validation on `config set`, so a valid-for-some-model value like `max` doesn't warn as unknown when no model is pinned; the warning instead says `max is not supported by every codex model; pin reviewer.model to one that supports it`.
  - Add `getModelCatalog(): Promise<ModelCatalog>` to `Provider`. Keep `getModels()` and `getEffortLevels()` as the static fallback source (sync), so existing tests and any external consumer keep working; they are no longer called by the CLI surfaces.
  - Cache the catalog per provider instance (same pattern as `capabilityCache`).
- [ ] **Step 5: Codex live discovery**
  - `getModelCatalog()` runs `codex debug models` (5s timeout, `reject: false`), parses stdout with a zod schema that accepts `{ models: [...] }` or a bare array and requires only `slug: string`; `visibility`, `supported_reasoning_levels[].effort`, `default_reasoning_level` optional. Unknown fields are ignored (`.passthrough()` not needed; `.strip()` default).
  - Keep models with `visibility !== "hide"` (missing visibility counts as visible).
  - Any failure (non-zero exit, timeout, JSON or schema error, zero models) returns the static catalog with `note: "codex model discovery failed (<reason>); showing built-in list"`. Never throws.
  - Refresh static `MODELS` to the current list-visible slugs and `EFFORT_LEVELS` to `["low", "medium", "high", "xhigh", "max"]`.
  - `ultra` handling: it is kept in the catalog (so `config set reviewer.effort ultra` does not warn as unknown) but excluded from wizard choices, and `config set` prints an advisory: `ultra enables automatic task delegation; the reviewer may spawn sub-agents, increasing time and cost.` Implemented as a small `EFFORT_ADVISORIES` map in `codex.ts`, surfaced by `config.ts`.
  - Unit tests: parse the real catalog shape (fixture captured from `codex debug models`, trimmed), bare-array shape, hidden filtering, malformed JSON fallback, non-zero exit fallback.
- [ ] **Step 6: Claude effort + models**
  - `MODELS = ["fable", "opus", "sonnet", "haiku"]` (aliases resolve to latest on the CLI side; no discovery command exists). `getModelCatalog()` returns this statically with efforts `["low", "medium", "high", "xhigh", "max"]`, `source: "static"`.
  - `invoke()`: when `options.effort` is set and not `"default"`, push `--effort <level>`, gated on a help probe. Extend the existing `--help` probe in `checkStructuredOutputSupport` into a shared `probeHelp()` that caches the help text once and answers both `--json-schema` and `--effort`. If `--effort` is unsupported, omit the flag and write one stderr warning per process: `[planpong] claude CLI does not support --effort; ignoring effort=<level>. Upgrade claude to enable.`
  - Why a probe and not error classification: an unknown-flag failure is classified `capability` (`claude.ts` `classifyError`), which the state machine treats as "structured output unsupported" and downgrades to prompted mode with the same bad flag, failing twice and poisoning the structured-output cache. The probe avoids that misclassification.
  - **Value compatibility (verified 2026-09-25 on claude 2.1.282):** an unrecognized value does not fail. `claude -p --effort bogus` exits 0, answers, and prints `Warning: Unknown --effort value 'bogus' ... ignoring it and using the default effort. Valid values: low, medium, high, xhigh, max.` (abridged) to stderr. `--model haiku --effort max` also exits 0. So on current CLIs, turning effort on cannot break a working config; the risk is the reverse: a bad value is silently ignored, which is the bug this step fixes.
    - Parse the advertised values from the cached help text (`--effort <level> ... (low, medium, high, xhigh, max)`). If `options.effort` is not in that list, omit the flag and emit one warning naming the valid values; don't forward a value we know is ignored.
    - On success, scan stderr for `Unknown --effort value` and forward it as a planpong stderr warning, covering values that the help text lists but a model or version rejects.
    - An effort problem is never allowed to reach `classifyError` as a failure: it either passes (the CLI tolerates it) or the flag is dropped before invocation. So effort cannot mark the provider non-capable for structured output. Add a test: claude stdout present + effort warning on stderr → `ok: true`, capability cache untouched.
    - Older CLIs without `--effort` are covered by the help probe (flag omitted + warning). The implementer checks one pinned older claude version (`npx @anthropic-ai/claude-code@<version from before effort shipped> --help`) to confirm the probe reads absence correctly, and records the version used in the PR.
  - `getEffortLevels()` returns the new list (so existing callers and soft validation match).
  - Tests: args include `--effort high` when set; omitted for `"default"` and unset; omitted with warning when probe says unsupported; omitted with warning when the value is not advertised; probe runs once for both checks.
- [ ] **Step 7: Wire CLI surfaces to the catalog**
  - `init.ts`: before building choices, `await provider.getModelCatalog()` for planner and reviewer. Model choices from `catalog.models`; effort choices from the selected model's `efforts` if a model was chosen, else `catalog.efforts` (the intersection) with a hint: `pin a model to see its full effort range`; filter out advisory-flagged efforts (`ultra`). If `catalog.note` is set, print it once above the prompt.
  - **Add a "CLI default" choice; it does not exist today.** `init.ts` model and effort selects offer only enumerated values, `WizardAnswers` requires model strings, `answersToPicks` stringifies with `String(answer)` (an `undefined` becomes the literal `"undefined"`), and `setConfigValuesBatch` in `mutate.ts` can only set keys. Changes:
    - Model select gets a first choice `CLI default (follow <provider>'s own configured model)`; effort select gets `CLI default`. Their values are a module-private sentinel symbol, never a string, so it cannot collide with a model name or be serialized.
    - `WizardAnswers.plannerModel` / `reviewerModel` / efforts become `string | typeof CLI_DEFAULT`.
    - `mutate.ts`: `BatchPick` gains `{ key, unset: true }`. `setConfigValuesBatch` deletes the key from the YAML document (`doc.deleteIn([role, field])`), and removes the role map only if it becomes empty. `provider` is never removed by a model or effort unset.
    - `answersToPicks`: sentinel with a disk value → unset pick; sentinel with no disk value → no pick. Choosing the CLI-default model also unsets that role's effort only if the pinned effort is outside the new effort choices (intersection), and the summary shows it.
    - **Snapshot and writer must target the same file.** Existing bug: `readDiskSnapshot` (`init.ts:78`) reads only `cwd`, while `setConfigValuesBatch` resolves the file with `findConfigPath` (`loader.ts:42`), which walks parent directories. Run from a subdirectory, the wizard sees an empty snapshot but writes into the parent's file, so "sentinel with no disk value → no pick" would leave a parent's pins active. Fix: `readDiskSnapshot` resolves via `findConfigPath(cwd)` and returns `{ path, snapshot }`; the wizard passes that same `path` to the writer (add an optional explicit-path parameter to `setConfigValuesBatch` rather than letting it re-resolve), and prints which file it is editing. Test: parent dir has `reviewer.model` + `reviewer.effort`; run the wizard from a child dir, choose CLI default; the parent file loses both keys and no child file is created.
    - Wizard default selection, keyed on whether the role's provider changed:
      - **Provider unchanged:** if the disk has no model, CLI default is preselected; if the disk model is not in the catalog, add it as `<model> (current, not in catalog)` and preselect it, so re-running the wizard never silently changes a pin. The disk effort is preselected if it is in the chosen model's effort choices, else CLI default.
      - **Provider changed:** the old model and effort are never offered or preselected. CLI default is preselected for both, and `answersToPicks` emits unset picks for the old `model` and `effort` unless the user picks new values. This prevents a `provider: claude` + `model: gpt-6-sol` combination.
      - Tests: provider switch accepting defaults yields no stale model/effort keys; provider switch picking an explicit model writes that model and no stale effort; unchanged provider re-run preserves an unknown model.
    - Add `planpong config unset <key>` using the same writer path, with `KEY_METADATA` help text, for parity with `set`. The MCP `planpong_set_config` tool is unchanged in this plan.
    - Tests: fresh config choosing CLI default writes no model or effort keys; an existing pin switched to CLI default removes `model` (and an incompatible `effort`) and leaves `provider`; unknown on-disk model is preserved when re-running; `config unset reviewer.model` removes only that key; no output file ever contains `undefined`.
  - `config.ts` `getUnknownValueWarning`: becomes async; for `*.effort`, validate against the configured model's efforts when that model is in the catalog; with no pinned model, unknown only if outside `allEfforts`, and a model-dependent warning if outside the intersection. Append the advisory for flagged efforts. Wording stays soft ("may still accept it").
  - `config.ts` `printProvidersTable`: show `source` per provider (`live` / `built-in`), per-model effort lists for live catalogs, and the `note` when present.
  - Gemini: `getModelCatalog()` wraps its static lists (`source: "static"`), no discovery.
  - Update tests in `init.test.ts`, `config.test.ts`, `mutate.test.ts` fixtures. Per memory, tsconfig excludes tests, so run `npm test`, not only typecheck, after the interface change.
- [ ] **Step 8: Inline planner label (#54)**
  - Add `formatPlannerLabel(config, plannerMode, inlineClient?: string)`: returns `formatProviderLabel(config.planner)` for `external`; for `inline` returns `inline` or `inline(<client>)`.
  - `inlineClient` comes from the MCP client's `initialize` handshake: `server.server.getClientVersion()?.name` in `src/mcp/server.ts` (e.g. `claude-code`, a codex client name). Capture it once at connection and thread it into `initReviewSession` via a new optional field on the start-review input path, then persist it on the session (`session.inlineClient?: string`, optional in the zod schema so older session files still parse) so later `buildStatusLine` calls read it from the session, not from process state.
  - Use it in `buildStatusLine` (`operations.ts:295`) and `initReviewSession` (`operations.ts:403`).
  - **Fix CLI sessions persisting the wrong mode first.** Both CLI paths run the external planner but persist `plannerMode: "inline"`: `loop.ts:137` calls `createSession` without a mode (defaults to `inline`), and `runReviewLoop` calls `initReviewSession(planPath, cwd, config)` with the unchanged config whose `planner_mode` defaults to `inline`. Once the status line trusts `session.plannerMode`, CLI runs would read `inline`. Fix: the generate path passes `"external"` to `createSession`; `runReviewLoop` passes `{ ...config, planner_mode: "external" }` to `initReviewSession`. `loop.ts:131` switches to `formatPlannerLabel` too, so every label goes through one function. Tests: with `DEFAULT_CONFIG`, both CLI paths persist `external` and render `claude(...) → ...` on the initial and a subsequent status line; MCP inline sessions render `inline(...)`.
  - The MCP protocol does not expose the client's model, so the label names the client, not the model. The issue asked for the actual model "if the MCP client exposes it"; it does not.
  - Tests: status line reads `inline(claude-code) → codex(...)` for inline sessions; unchanged for external; sessions without `inlineClient` render `inline`.

### Release

- [ ] Docs gate (per project convention, docs are release-blocking): README provider section (claude effort now honored; gemini: state that some accounts are now rejected by the gemini CLI and planpong surfaces the provider's reason, without asserting which tiers work; `config providers` shows live codex models), `planpong config --help` / `config providers` help text, and the MCP server instructions if they mention models.
- [ ] `npm version minor` → 0.7.0, push with tags.

## Risks and mitigations

- **`codex debug models` is a debug command; its shape can change without notice.** Mitigation: tolerant schema requiring only `slug`, total fallback to the static list, and the `note` makes the fallback visible rather than silent. Discovery affects only suggestions and warnings, never what gets invoked.
- **Discovery adds latency to wizard and `config set`.** Measured ~0.1s for `codex debug models`. The 5s timeout bounds the worst case. Not called on any review path.
- **Claude effort changes behavior for existing configs.** Anyone who set `effort` on a claude role was getting CLI default; they now get the level they asked for (possibly slower/costlier at `max`). Called out in release notes.
- **stderr heuristics pick the wrong line.** Mitigation: fall back to the tail, and the full stderr is still on `ProviderError.stderr` and in the debug log line.
- **`getClientVersion()` returns undefined or an unhelpful name.** Label degrades to `inline`, which is still correct (the fix's core claim is "not opus").
- **CI matrix exposes a Node 20 incompatibility we don't know about.** That is the gate working; fix before merging PR 1.

## Follow-up (not in this plan)

- Node engines: `>=18` came from the initial extraction commit (`facf628`) with no recorded rationale. Source uses no APIs above Node 18; runtime deps floor is 18.19 (execa 9). Node 18 EOL 2025-04-30, Node 20 EOL 2026-04-30. Next majors of execa, chalk, commander, vitest require Node 22+. Propose `>=22` together with those bumps once CI is in place.
- Reviewer context strategy (full plan vs changed sections plus context): separate brainstorm and plan.
