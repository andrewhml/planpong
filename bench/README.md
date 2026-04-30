# bench/

A tiny harness to measure whether changes to planpong are actually making it faster (or at least not slower). Not shipped in the npm package — `files: ["dist/"]` in `package.json` excludes this directory from publishes.

## What it measures

Per run, against a fixed plan, with the repo's configured models:

- `total_wall_ms` — end-to-end wall clock from `runReviewLoop` start to return
- `sum_round_wall_ms` — sum of each round's in-state-machine duration (should closely match total_wall_ms minus orchestration overhead)
- `total_prompt_chars` / `total_output_chars` — aggregate input + generated characters across every attempt in every round
- `total_attempts` — number of provider invocations (≈ rounds × 1 on the happy path; > that means downgrades happened)
- `downgrades` — count of rounds where attempt 1 failed and attempt 2 was needed
- `rounds`, `outcome`, `accepted/rejected/deferred` — loop shape, so we can tell whether a "faster" run is faster because it converged in fewer rounds (different behavior) vs. because each round is faster (real improvement)

All of this comes straight from the per-round `.planpong/sessions/<id>/round-*-*-metrics.json` files that planpong writes today.

## Reference plans

`bench/plans/` holds checked-in, domain-agnostic plans:

- `small.md` — a one-feature plan, expected to converge in 1–2 rounds
- `medium.md` — a realistic multi-step plan (~200 lines), expected to converge in 3–5 rounds

They're tuned to give the reviewer something real to critique without being so underspecified that convergence is accidental.

## Run

```sh
# Build first (the runner imports from src/ via tsx, but the providers shell
# out to installed CLIs — make sure `claude` and `codex` are on PATH and
# authed).
npm install

# Run one plan. Uses the repo's planpong.yaml for models.
npx tsx bench/run.ts bench/plans/small.md

# Force a particular revision_mode for A/B testing (overrides planpong.yaml).
npx tsx bench/run.ts bench/plans/small.md --revision-mode edits
npx tsx bench/run.ts bench/plans/small.md --revision-mode full

# Output lands in bench/results/<iso>-<commit>/<plan>.json (gitignored).
```

## Compare two runs

```sh
# Single run — print its summary.
npx tsx bench/summarize.ts bench/results/2026-04-24T21-02-11-ac41a58/medium.json

# Baseline vs latest — print delta.
npx tsx bench/summarize.ts bench/baseline.json bench/results/<latest>/medium.json
```

The delta output calls out caveats when runs aren't directly comparable — different outcome, different round count, different models — so a "30% faster" number that's actually just "converged in fewer rounds" gets flagged.

## Comparisons

`bench/comparisons/<name>/` holds frozen "after" runs from completed
optimization experiments, paired with a README explaining the delta vs the
baseline. Unlike `bench/results/` (gitignored, ephemeral), comparisons are
checked in so the result of each architectural change is auditable.

See `bench/comparisons/persistent-sessions/README.md` for the first one.

## Committing a baseline

1. Run each reference plan 3× (variance is real — model response times can swing 2–3×).
2. Pick the median run per plan.
3. Copy the median JSON to `bench/baseline-<plan>.json` (or aggregate into `bench/baseline.json` if you prefer one file with multiple plans).
4. Commit. Note the commit SHA in the baseline — the baseline is intentionally frozen until you want to reset it after a significant change.

## Gotchas

- **Codex requires a git repo.** The runner `git init`s the scratch directory and creates a baseline commit so Codex's trusted-directory check passes. If you see `Not inside a trusted directory and --skip-git-repo-check was not specified`, the init step probably failed — check the stderr warning and your local `git` install.
- **Providers shell out to installed CLIs.** The runner doesn't authenticate anything — whatever state `claude` and `codex` have when you run the bench is what the bench uses. Re-authenticate them separately if calls start failing.

## What this doesn't measure

- **Model quality.** Faster is not the same as better. If a change makes the reviewer miss issues, `accepted` may rise and `rejected` may fall, but the plan itself could be worse. Eyeball the plan output on real runs; don't trust the aggregates alone.
- **Cost.** Nothing here reads provider billing. Use `total_output_chars` as a rough proxy (output tokens dominate cost for reasoning models).
- **Cold-start.** First run of a day may be slower due to CLI auth refresh, prompt cache misses, etc. Warm up with one throwaway run if measurements look off.
