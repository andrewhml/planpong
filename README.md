# Planpong

Adversarial plan review for AI-assisted development. Two AI models play ping-pong with your plan — one critiques, the other revises — until the plan converges or you stop them.

## How it works

1. You write a plan (markdown file)
2. A **reviewer** model finds issues (P1/P2/P3 severity)
3. A **planner** model accepts, rejects, or defers each issue and rewrites the plan
4. Repeat until the reviewer approves or max rounds hit

Default config: Claude revises, Codex reviews. Both are swappable.

## Prerequisites

You need **two AI CLI tools** installed and authenticated:

- **Claude Code** — `npm install -g @anthropic-ai/claude-code` (needs Anthropic API key or Max subscription)
- **Codex CLI** — `npm install -g @openai/codex` (needs OpenAI API key)

Verify both work:

```sh
claude --version
codex --version
```

Planpong shells out to these CLIs. No API keys are configured in planpong itself.

## Install

```sh
npm install -g planpong
```

## Setup (Claude Code MCP)

Add planpong as an MCP server so Claude Code can use it natively:

```sh
claude mcp add planpong -- planpong-mcp
```

Then allow the tools in your Claude Code settings (`.claude/settings.json`):

```json
{
  "permissions": {
    "allow": ["mcp__planpong"]
  }
}
```

Restart Claude Code. You should see `planpong` tools in your tool list.

## Usage

### Via Claude Code (recommended)

Ask Claude to review a plan:

```
Review my plan at docs/plans/my-feature.md using planpong
```

Or use the slash commands (auto-installed with the MCP server):

```
/planpong:review docs/plans/my-feature.md          # autonomous — runs to completion
/planpong:review_interactive docs/plans/my-feature.md  # pauses between rounds
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

## What it writes

Planpong updates your plan file in-place. It adds a status line:

```
**planpong:** R3/10 | claude → codex | 2P2 1P3 → 1P3 → 0 | Accepted: 4 | +32/-8 lines | 5m 23s | Approved after 3 rounds
```

Session data is stored in `.planpong/sessions/` (add to `.gitignore`).

## Development

```sh
git clone https://github.com/andrewhml/planpong.git
cd planpong
npm install        # installs deps + configures git hooks
npm run build      # compile TypeScript
npm run typecheck  # type-check without emitting
```

### Publishing

Automated via GitHub Actions. No tokens or OTP needed.

```sh
npm version patch   # bumps version + creates git tag
git push && git push --tags   # triggers publish to npm
```

## License

MIT
