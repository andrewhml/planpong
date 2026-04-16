# Multi-Provider Architecture

**Status:** Draft

## Context

Planpong currently supports two AI CLIs — Claude (`claude -p`) and Codex (`codex exec`). Each is hardcoded with its own provider class that knows specific CLI flags, schema dialects, and error-classification heuristics. The structured output work in #23 revealed that the ecosystem of LLM CLIs is much broader than two (Ollama, Kimi via OpenAI-compat, Gemini, `llm`, llama.cpp, LM Studio, OpenRouter, vLLM, LiteLLM, Groq, Mistral, DeepSeek, Qwen, and more), and that structured output varies wildly across them along two independent axes: **constraint strength** (strict / advisory / none) and **schema dialect** (OpenAI-strict / JSON Schema 7 / Gemini / grammar).

The current `Provider` interface treats structured output as a binary capability (`checkStructuredOutputSupport(): boolean`), which doesn't capture either axis and forces every new provider to re-implement the same CLI plumbing. This plan proposes a layered refactor that makes adding new providers additive and lets the state machine adapt its behavior to real capabilities.

## Steps

- [ ] Extend `Provider` interface with a `capabilities` property
  - Define `ProviderCapabilities` type: `{ structuredOutput: "strict" | "advisory" | "none"; schemaDialect: "openai-strict" | "json-schema-7" | "gemini" | "grammar"; }`
  - Existing `checkStructuredOutputSupport()` becomes a lazy init that populates `capabilities.structuredOutput`
  - `markNonCapable()` downgrades `capabilities.structuredOutput` to `"none"` rather than flipping a boolean
- [ ] Make schema transformation pluggable by dialect
  - Move the `toOpenAIStrict` transformer out of `json-schema.ts` into a dialect-keyed map
  - `transformSchema(canonical, dialect)` dispatches to the right transformer
  - Dialects: `openai-strict` (implemented), `json-schema-7` (identity), `gemini` (strip unsupported keywords), `grammar` (convert to GBNF for llama.cpp — future)
  - The state machine calls `transformSchema(canonical, provider.capabilities.schemaDialect)` before invocation
- [ ] Make the state machine capability-aware
  - `structuredOutput: "strict"`: expect success on first attempt, fallback only as safety net (one-shot path)
  - `structuredOutput: "advisory"`: current behavior — try structured, fall back to legacy on parse failure, cache non-capable
  - `structuredOutput: "none"`: skip structured mode entirely, go straight to legacy (no wasted attempt)
- [ ] Add `OpenAICompatibleProvider` class
  - Generic provider for any OpenAI-compatible CLI or API
  - Configurable via `planpong.yaml`: CLI command, base URL, API key env var, model, dialect
  - Covers Codex (as a special-case subclass with `codex exec`), OpenRouter, vLLM, Groq, Together, Kimi (via Moonshot API), etc.
- [ ] Add `OllamaProvider` class
  - Shells out to `ollama run <model>` with `--format <schema>` for strict mode (when supported by the Ollama version)
  - Probes for `--format` flag via `ollama run --help`
  - Dialect: `json-schema-7` (Ollama accepts standard form)
- [ ] Add `LlmCliProvider` class
  - Shells out to Simon Willison's `llm` CLI
  - Uses `--schema` flag for structured output (varies per `llm` plugin — treat as advisory by default)
  - Instant coverage for ~50+ models via `llm`'s plugin ecosystem
  - Dialect: probe-determined per backend model
- [ ] Add `CommandProvider` for the long tail
  - Generic "run any shell command, pipe in prompt, read stdout" provider
  - No structured output (`"none"`), user provides everything
  - Escape hatch for experimental or custom setups
- [ ] Update config schema to support new provider types
  - `planpong.yaml` gains provider-specific config blocks
  - Example: `provider: openai-compat` with `endpoint`, `api_key_env`, `dialect`
- [ ] Update provider registry with discovery and fallback for the expanded set
  - `availability` probe per provider type (different CLIs to check)
  - Fallback preference ordering (user-configured first, then Claude/Codex, then Ollama if installed, then `llm` if installed)
- [ ] Update the main README and `planpong.yaml` example with the new provider options
- [ ] Add provider-specific tests
  - Unit tests for each new provider's arg construction, capability probing, error classification
  - Integration: mock CLI executions to verify each provider follows the `Provider` interface contract

## File References

| File | Action | Description |
|------|--------|-------------|
| `src/providers/types.ts` | Modify | Add `ProviderCapabilities`, update `Provider` interface |
| `src/providers/claude.ts` | Modify | Implement `capabilities` getter, `schemaDialect: "json-schema-7"` (Claude accepts loose; its advisory behavior is captured by `structuredOutput: "advisory"`) |
| `src/providers/codex.ts` | Modify | `capabilities = { structuredOutput: "strict", schemaDialect: "openai-strict" }` |
| `src/providers/openai-compatible.ts` | Create | Generic OpenAI-compatible provider |
| `src/providers/ollama.ts` | Create | Ollama provider |
| `src/providers/llm-cli.ts` | Create | `llm` CLI provider |
| `src/providers/command.ts` | Create | Generic shell-command provider |
| `src/providers/registry.ts` | Modify | Add new provider types to discovery/fallback |
| `src/schemas/dialects.ts` | Create | Dialect registry with `transformSchema(canonical, dialect)` dispatch |
| `src/schemas/json-schema.ts` | Modify | Extract strict transformer into dialects module |
| `src/core/operations.ts` | Modify | State machine reads `provider.capabilities`, adapts behavior per `structuredOutput` level |
| `src/schemas/config.ts` | Modify | Support new provider types and their config blocks |
| `src/providers/*.test.ts` | Create | Tests for each new provider |
| `planpong.yaml` | Modify | Document new provider options |
| `README.md` | Modify | Document provider ecosystem |

## Verification Criteria

- `npm run typecheck` and `npm test` pass
- Adding a new provider does not require changes to `operations.ts` (only to the registry and provider file itself)
- The state machine uses the same code path for `strict` and `advisory` providers, differing only in expected failure rate
- Each provider declares its `capabilities` statically; runtime probing only overrides when the CLI proves incapable
- Config changes are backward-compatible — existing `planpong.yaml` with `provider: claude`/`provider: codex` continues to work
- Users can configure Kimi/OpenRouter/etc. without writing code — just `planpong.yaml` changes

## Key Decisions

### Two-axis capability model

Structured output support is not a binary property. Two orthogonal axes capture real-world behavior:

- **Constraint strength:** Can the CLI force the model to produce conforming JSON (strict, via token-level constrained decoding), or does it only validate after the fact (advisory), or does it not support schemas at all (none)?
- **Schema dialect:** Does the provider expect OpenAI-strict (additionalProperties, all-required, nullable optionals), JSON Schema 7 (looser), Gemini's subset, or a custom grammar format?

Treating these independently lets the schema transformer and state machine compose correctly across the ecosystem. For example: OpenRouter and Groq are both OpenAI-compatible (strict + openai-strict); Ollama is strict + json-schema-7; Claude is advisory + json-schema-7; llama.cpp is strict + grammar.

### Keep CLI shell-out as the integration model

Planpong's existing design — shell out to user-installed CLIs rather than embedding API clients — has real benefits: no API key management, user's CLI auth works, no network/auth code in planpong. Adding an `OpenAICompatibleProvider` that takes a CLI command and base URL preserves this model while covering the entire OpenAI-compatible ecosystem. We don't embed the OpenAI SDK; we shell out to whatever CLI the user has (could be `codex exec`, could be a custom script wrapping LiteLLM, could be OpenRouter's CLI).

### Don't embed LiteLLM or a universal proxy

LiteLLM and similar routers would give us ~100 providers in one shot but add operational complexity (separate Python process or proxy server), contradict the CLI-shell-out principle, and couple planpong's release cadence to an external project. Preferring narrow first-class adapters (OpenAI-compat, Ollama, llm-cli) plus a `CommandProvider` escape hatch keeps the design simple and explicit.

### Prefer `llm` CLI as the breadth play

Simon Willison's `llm` CLI has a plugin ecosystem covering ~50 models across Anthropic, OpenAI, Gemini, Mistral, Ollama, and others. A single `LlmCliProvider` gives planpong broad coverage with one well-maintained dependency. Structured output quality varies per plugin (most are advisory), which is fine — the state machine handles advisory providers correctly.

### Capability declaration over runtime probing when possible

Runtime probing (the `checkStructuredOutputSupport()` pattern) is useful when the CLI version matters, but it adds latency and complexity. Prefer static `capabilities` declaration on each provider class, with probing only as a refinement (e.g., Ollama probes `--format` because it was added in a specific version). Providers declare what they support; the state machine adapts.

### Config is the primary extension mechanism

Adding a new provider shouldn't require TypeScript changes. `planpong.yaml` entries like:

```yaml
reviewer:
  provider: openai-compat
  endpoint: https://api.moonshot.ai/v1
  api_key_env: MOONSHOT_API_KEY
  model: moonshot-v1-32k
  dialect: openai-strict
```

...should be enough to wire up Kimi as a reviewer. This follows the same principle as the Provider abstraction: push variation to configuration, keep the code paths uniform.

### Deprecate `checkStructuredOutputSupport(): boolean`

This method was the stepping stone introduced in #23. It returns a binary where reality needs a ternary (`strict` / `advisory` / `none`). Migrate to `capabilities.structuredOutput` as the single source of truth. Keep the method as a deprecated wrapper for one release cycle, then remove.
