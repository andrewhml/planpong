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

If both are installed, planpong uses one for planning and the other for reviewing (configurable). If only one is available, it auto-fallbacks to using that CLI for both roles.

Verify your CLI works:

```sh
claude --version   # or
codex --version
```

Planpong shells out to these CLIs — no API keys are configured in planpong itself.

## Install

```sh
npm install -g planpong
```

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

Optional. Create `planpong.yaml` in your project root:

```yaml
planner:
  provider: claude # claude or codex
  model: opus # provider-specific model name
  effort: high # reasoning effort level
reviewer:
  provider: codex
  model: o3
  effort: high
max_rounds: 10
plans_dir: docs/plans
```

All fields are optional. Defaults: claude (planner) + codex (reviewer), 10 rounds, `docs/plans/` directory.

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
