# Planpong

Adversarial plan review for AI-assisted development. Two AI models play ping-pong with your plan — one critiques, the other revises — until the plan converges or you stop them.

Plans go through three review phases, each with a different lens:

| Round | Phase         | What the reviewer looks for                                                                      |
| ----- | ------------- | ------------------------------------------------------------------------------------------------ |
| 1     | **Direction** | Is this the right problem? Is the approach sound? Is the scope appropriate?                      |
| 2     | **Risk**      | Pre-mortem — assume the plan fails. Surface hidden assumptions, dependencies, and failure modes. |
| 3+    | **Detail**    | Implementation completeness — missing steps, edge cases, gaps, verification criteria.            |

The planner model evaluates each piece of feedback independently — accepting, rejecting, or deferring with rationale — then rewrites the plan. This continues until the reviewer approves or the round limit is reached.

## Prerequisites

You need at least **one AI CLI** installed and authenticated:

- **Claude Code** — `npm install -g @anthropic-ai/claude-code` (Anthropic API key or Max subscription)
- **Codex CLI** — `npm install -g @openai/codex` (OpenAI API key)
- **Gemini CLI** — `npm install -g @google/gemini-cli` (Google account auth — run `gemini` once to authenticate)

If multiple are installed, planpong uses one for planning and a different one for reviewing (configurable). If only one is available, it auto-fallbacks to using that CLI for both roles.

> **Note on gemini as reviewer:** the gemini CLI does not expose a stable session-resume mechanism, so reviewer rounds run without persistent context. Expect noticeably slower per-round wall time than claude or codex when gemini is the reviewer. The first time you load a config that selects gemini as reviewer, planpong prints a one-line warning to stderr.

Verify your CLI works:

```sh
claude --version   # or
codex --version    # or
gemini --version
```

Planpong shells out to these CLIs — no API keys are configured in planpong itself.

## Install

```sh
npm install -g planpong
```

Then run the interactive setup wizard:

```sh
planpong init
```

The wizard auto-detects which AI CLIs you have installed, lets you pick a planner + reviewer, and writes a working `planpong.yaml` for the current project. You can re-run it any time to tweak settings — only changed keys are written.

## Setup (Claude Code MCP)

Add planpong as an MCP server so Claude Code can use it as a native tool:

```sh
claude mcp add planpong -- planpong-mcp
```

Allow the tools in your Claude Code settings (`.claude/settings.json`):

```json
{
  "permissions": {
    "allow": ["mcp__planpong"]
  }
}
```

Restart Claude Code. The `planpong` tools should appear in your tool list.

## Usage

### Via Claude Code (recommended)

Ask Claude to review a plan:

```
Review my plan at docs/plans/my-feature.md using planpong
```

Or use the slash commands (auto-installed with the MCP server):

```
/planpong:review docs/plans/my-feature.md              # autonomous — runs to completion
/planpong:review_interactive docs/plans/my-feature.md   # pauses between rounds for your input
```

### Via CLI

```sh
planpong review docs/plans/my-feature.md
```

## Configuration

Optional. Run `planpong init` to generate this interactively, or create `planpong.yaml` in your project root by hand:

```yaml
planner:
  provider: claude # claude, codex, or gemini
  model: claude-opus-4-6 # provider-specific model name
  effort: high # reasoning effort level
reviewer:
  provider: codex
  model: gpt-5.3-codex
  effort: xhigh
max_rounds: 10
plans_dir: docs/plans
revision_mode: full # full or edits
planner_mode: external # external or inline
```

All fields are optional. Defaults: claude (planner) + codex (reviewer), 10 rounds, `docs/plans/` directory.

### Viewing and changing config

```sh
planpong config              # show resolved config with source annotations
planpong config path         # print path to active config file
planpong config set <key> <value>   # set a config value
```

Examples:

```sh
planpong config set reviewer.model gpt-5.3-codex
planpong config set max_rounds 5
planpong config set planner_mode inline
```

Valid keys: `planner.provider`, `planner.model`, `planner.effort`, `reviewer.provider`, `reviewer.model`, `reviewer.effort`, `plans_dir`, `max_rounds`, `human_in_loop`, `revision_mode`, `planner_mode`.

### Config via MCP

Two MCP tools are available for programmatic config access:

- **`planpong_get_config`** — returns resolved config, file path, version, and per-key source provenance
- **`planpong_set_config`** — dry-run by default (`confirm: false`); pass `confirm: true` to write

## What it produces

Planpong updates your plan file in-place and adds a status line tracking the review:

```
**planpong:** R3/10 | claude → codex | 2P2 1P3 → 1P3 → 0 | Accepted: 4 | +32/-8 lines | 5m 23s | Approved after 3 rounds
```

Reading left to right: round 3 of 10, claude planned / codex reviewed, issue trajectory across rounds, total accepted issues, line delta from original, elapsed time, and outcome.

Session data is stored in `.planpong/sessions/` (add to `.gitignore`).

## Development

```sh
git clone https://github.com/andrewhml/planpong.git
cd planpong
npm install        # installs deps + configures git hooks
npm run build      # compile TypeScript
npm run typecheck  # type-check without emitting
```

A pre-commit hook automatically rebuilds `dist/` when TypeScript files are staged.

### Publishing

Automated via GitHub Actions with npm trusted publishing (OIDC). No tokens needed.

```sh
npm version patch   # bumps version + creates git tag
git push && git push --tags   # triggers publish to npm
```

## License

MIT
