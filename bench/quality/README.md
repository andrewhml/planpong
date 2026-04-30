# bench/quality/

Defect-injection benchmark: takes a base plan, injects known defects, runs a single planpong review round against a real fixture codebase, scores whether the reviewer flagged each defect.

Answers the "is planpong actually catching things?" question without needing a downstream coding-agent pipeline.

## Layout

```
bench/quality/
  fixture-repo/         # small commander-based notes CLI used as the
                        # review's working directory. seeds into the bench's
                        # tmpdir so the reviewer can read real source.
  defects/              # defective variants of bench/plans/small.md
    D1-hallucinated-file.md       # filename typo (idnex.ts vs index.ts)
    D2-internal-contradiction.md  # steps contradict Key Decisions
    D3-missing-step.md            # missing data-flow step
  run.ts                # bench runner
  results/              # gitignored — per-run JSON output
```

## Run

```sh
npx tsx bench/quality/run.ts
```

Each defect runs in its own tmpdir with the fixture-repo seeded in, then a detail-phase review round, then keyword-scoring of the feedback against expected ground-truth phrases.

## Add a new defect

1. Copy `bench/plans/small.md` to `bench/quality/defects/D<N>-<slug>.md` and modify it to inject a single defect.
2. Add a `Defect` entry to `DEFECTS` in `run.ts` with `expectedKeywords` — the AND-of-OR keyword groups the reviewer's feedback must contain to count as a catch.
3. Run; iterate on keywords until ground-truth scoring matches what the reviewer is actually saying.

Single-keyword scoring is brittle (a finding that mentions "package.json" in passing matches "package.json" keyword), so keep keywords narrow to the specific defect concept.

## Configuration knobs

The bench uses the repo's `planpong.yaml` config (planner + reviewer providers/models). To test against a different reviewer, change `planpong.yaml` for the run.

The review phase is hardcoded to detail (`session.currentRound = 3`) because:

- direction phase is explicitly told NOT to focus on file paths or implementation specifics
- risk phase is pre-mortem — useful but not the right venue for "does this file exist"
- detail phase is where file-level verification happens

If you want to measure earlier-phase catch rates, change the `currentRound` assignment in `run.ts`.

## What this bench is not

- Not a downstream-outcome benchmark (does the resulting plan actually produce working code).
- Not a comparison vs single-pass LLM review (reviewer alone, no planpong scaffolding).
- Not an iteration-value benchmark (does the planner fix what the reviewer flagged).
- Not LLM-judge scored (uses keyword matching, which is brittle).

Each of those is a follow-on. See `bench/comparisons/quality-v0/README.md` for what the v0 result actually measures and the limitations.
