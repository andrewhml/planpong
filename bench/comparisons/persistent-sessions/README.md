# Persistent Reviewer Sessions — Benchmark Comparison

Frozen result files measuring the wall-time impact of edits-mode revisions and reviewer-side persistent CLI sessions vs. the original baseline.

All runs use the same plan (`bench/plans/medium.md`), the same model config (`claude(claude-opus-4-6/high)` planner + `codex(gpt-5.3-codex/xhigh)` reviewer), and the same machine. Single-run measurements — variance across runs is real (see `bench/baseline/README.md` for the noise floor).

## The three configurations

| File | Config | When |
|---|---|---|
| `bench/baseline/medium/run-1/medium.json` | full revision mode, 300s provider timeout, no persistent sessions | commit `ac41a58` (pre-change) |
| `medium-edits-only.json` | `revision_mode: edits`, 600s timeout, no persistent sessions | After plan 2 + timeout bump |
| `medium-edits-and-sessions.json` | `revision_mode: edits`, 600s timeout, **reviewer-side persistent sessions** (codex `thread.started.thread_id` capture + `codex exec resume`) | After persistent-sessions work |

## Headline numbers

| | baseline run-1 | edits only | **edits + sessions** |
|---|---|---|---|
| Wall clock | **17m03s** | 15m41s | **8m52s** |
| Rounds to converge | 4 | 5 | **3** |
| Outcome | approved | approved_with_notes | **approved (clean)** |
| Total prompt chars | 50,341 | 126,454 | 73,810 |
| Total output chars | 36,061 | 46,346 | 35,153 |
| Total attempts | 7 | 9 | 6 (1 capability downgrade) |

## Per-round breakdown

Reviewer wall, where the persistent-session win shows up most:

| Round | baseline reviewer wall | edits + sessions reviewer wall | delta |
|---|---|---|---|
| R1 review (direction) | 81s | 50s | −38% |
| R2 review (risk) | 286s | 80s (incl. capability retry) | **−72%** |
| R3 review (detail) | 149s | **28s** | **−81%** |

R3 collapsed to 28 seconds because the codex reviewer had R1+R2's plan content and its own prior critique already in conversation memory. The round-3 prompt was a small "diff since last round" instead of re-loading the full ~16K-char plan from cold context.

Planner wall is roughly unchanged across configurations — planner-side persistent sessions were tested and reverted (they made the model do more work per round, not faster work).

## What changed in the code

See `feat/diff-only-revisions` branch:

- `src/schemas/revision.ts` — split `PlannerRevisionSchema` into direction (full plan) + edits revisions
- `src/core/apply-edits.ts` — section-scoped edit applier with whitespace tolerance + status-line protection (14 unit tests)
- `src/providers/claude.ts` — `--session-id` (create) / `--resume` (continue) wired to `InvokeOptions.newSessionId` / `resumeSessionId`
- `src/providers/codex.ts` — `--json` event parsing for `thread_id` capture; `codex exec resume <id>` for resume; "unexpected argument" classified as capability error so resume mode auto-downgrades to legacy when the codex resume subcommand rejects `--output-schema`
- `src/core/operations.ts` — `runReviewRound` thread-state machine returns captured sessionId; reviewer session is initialized on first call, resumed on subsequent calls; round plan snapshots persist for diff-since-last-round prompts
- `src/prompts/reviewer.ts` — new `buildIncrementalReviewPrompt` for resumed reviewer turns
- `src/core/plan-diff.ts` — line-level LCS diff helper for the incremental prompts
- Provider timeouts: 300s → 600s (`claude.ts`, `codex.ts`)

## Caveats

- **Single-run measurements.** The baseline directory has 3 runs to characterize variance; these new configurations have one each. Need 2–3 more runs of `medium-edits-and-sessions` before treating the 8m52s figure as representative.
- **Capability downgrade is per-session.** When codex's resume subcommand rejects `--output-schema`, `markNonCapable()` flips structured output off for the rest of the session. This is correct in our flow (R1 is the only fresh codex call) but means a session that does multiple fresh-then-resume sequences would lose structured output prematurely. Not a problem in current architecture.
- **Reviewer-side wins do not generalize to the planner.** Tested with claude on both sides; planner persistent sessions added wall time. The architectural lesson is in the comparison, not just the win.

## Reproduce

```sh
# Pre-change baseline (already pinned in bench/baseline/medium/run-1/)
git checkout main
npx tsx bench/run.ts bench/plans/medium.md

# Edits-only checkpoint
git checkout feat/diff-only-revisions <commit-before-persistent-sessions>
npx tsx bench/run.ts bench/plans/medium.md --revision-mode edits

# Final state
git checkout feat/diff-only-revisions
npx tsx bench/run.ts bench/plans/medium.md --revision-mode edits
```
