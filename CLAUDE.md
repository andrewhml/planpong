# CLAUDE.md — Planpong

## What This Is

Adversarial plan review tool. Two AI models (planner + reviewer) iterate on a plan until it converges. Planner revises, reviewer critiques, repeat.

## Architecture

```
src/
  core/           # Business logic
    operations.ts  # Single-round functions (review, revise, finalize)
    loop.ts        # CLI full-loop wrapper over operations
    session.ts     # Session CRUD (.planpong/sessions/)
    convergence.ts # Feedback/revision parsing, convergence check
  mcp/            # MCP server (primary interface)
    server.ts      # Tool + prompt registration, server instructions
    tools/         # One file per MCP tool
  providers/      # AI CLI wrappers (claude, codex)
  prompts/        # Prompt templates for planner + reviewer
  schemas/        # Zod schemas (session, feedback, revision, config)
  config/         # Config loading (planpong.yaml discovery)
  cli/            # CLI commands (backward compat)
bin/
  planpong.ts      # CLI entrypoint
  planpong-mcp.ts  # MCP server entrypoint
```

## Key Design Decisions

- **MCP server is the primary interface.** Claude Code orchestrates the review loop via tool calls. CLI is kept for non-MCP tools.
- **Step-by-step tools** over full-loop tools. Each MCP tool does one thing (start, get-feedback, revise, status). Claude controls the loop.
- **Providers shell out to CLIs** (`claude -p`, `codex exec`). No API keys in planpong — uses the user's installed CLI auth.
- **Status line in plan file.** `**planpong:**` line is written/updated by the tools after each round, not by the planner model.

## Development

```sh
npm install          # install deps + configure git hooks
npm run build        # compile TypeScript to dist/
npm run typecheck    # tsc --noEmit
npx tsx bin/planpong.ts  # run CLI in dev mode
```

**Pre-commit hook** auto-rebuilds `dist/` when `.ts` files are staged. No manual rebuild needed.

## Publishing

Fully automated via GitHub Actions + npm trusted publishing (OIDC). No tokens needed.

```sh
npm version patch    # or minor/major — bumps version + creates git tag
git push && git push --tags   # triggers .github/workflows/publish.yml → npm publish
```

## Provider Gotchas

- `claude -p` can exit with code 1 but still produce valid output on stdout. Always try to parse before checking exit code.
- `CLAUDECODE` env var must be removed when spawning `claude -p` from inside Claude Code (see `providers/claude.ts:cleanEnv`).
- `codex exec` writes output to a temp file to avoid parsing header/footer noise.

## Config

Optional `planpong.yaml` in project root. Defaults: claude (planner) + codex (reviewer), 10 rounds.

## Conventions

- Feature branches, squash-merge PRs
- Commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`
- TypeScript strict mode

## Planning workflow

**Always run `/pong-review` on a plan before implementing it.** This is the dogfooding rule for this project — every plan in `docs/plans/` should go through planpong's own review loop before any code is written against it. The whole point of planpong is to catch plan-level defects early; skipping the review on planpong's *own* plans defeats the premise.

- New plan drafted → run `/pong-review docs/plans/<plan>.md` → iterate to convergence → only then start implementation.
- Use `/pong-interactive` instead when the plan is large or ambiguous and you want to approve each round step-by-step.
- If a plan ships unreviewed (e.g., trivial fix, urgent hotfix), note that explicitly in the PR description so it's an intentional exception rather than an oversight.
