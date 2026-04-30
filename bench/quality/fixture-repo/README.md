# notes-cli

A small Node CLI for managing local notes. Used as a fixture for planpong's quality benchmark — a semi-real-world repo a reviewer can read source files in, verify import paths, and grep for symbols.

## Commands

- `notes add <title> [-b <body>]` — create a note
- `notes list` — list all notes
- `notes delete <id>` — delete a note by id

Notes are stored as markdown files in `~/.notes/`.

## Why this exists

Planpong's quality benchmark injects known defects into plans (typos in file paths, internal contradictions, missing steps) and measures whether the reviewer model catches them. Without a real codebase to read, the reviewer can't verify ground truth — `src/cli/idnex.ts` looks plausible if there's no `src/` directory to refute it. This fixture gives the reviewer a real file tree to check claims against.

The fixture is intentionally minimal — three commands, one entrypoint, no business logic worth speaking of. Just enough surface area for a plan to reference real files and symbols.
