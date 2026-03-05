# planpong

Multi-model adversarial plan review. Sends a plan to a reviewer model for critique, then to a planner model for revision, looping until convergence.

## Status

Migrating from CLI tool to MCP server. See the `src/` directory for the core logic being refactored.

## Architecture

```
Interview → Seed → Execute → Evaluate
    ↑                           ↓
    └─── Adversarial Loop ──────┘
```

**Planner** (e.g., Claude) generates/revises plans. **Reviewer** (e.g., Codex) critiques them. The loop continues until the reviewer approves or max rounds are reached.

## Prior Art

Originally built as a CLI tool inside the [kitted](https://github.com/andrewhml/kitted) project. Session data from those runs is archived in `.planpong-sessions-archive/`.
