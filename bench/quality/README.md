# bench/quality/

Defect-injection benchmark. For each known defect, runs two reviews against the same fixture codebase — one through the full planpong pipeline and one through a naive single-pass invocation — then asks an LLM judge whether each catch substantively flagged the defect.

Answers two questions:

1. Does the reviewer catch known-bad things?
2. Does the **planpong** scaffolding (multi-phase, structured prompts, state machine) actually add signal over running the same model with no scaffolding?

Without the second question, all we can say is "the reviewer finds bugs," which is not the same claim as "planpong improves outcomes."

## Layout

```
bench/quality/
  fixture-repo/         # small commander-based notes CLI seeded into each
                        # review's tmpdir so the reviewer can read source.
  defects/              # defective variants of bench/plans/small.md
    D1-hallucinated-file.md
    D2-internal-contradiction.md
    D3-missing-step.md
    D4-hallucinated-function.md
    D5-wrong-binary-name.md
    D6-hallucinated-import.md
    D7-scope-drift.md
    D8-tsconfig-incompatibility.md
    D9-verification-mismatch.md
    D10-wrong-directory.md
  defects.ts            # defect catalog with ground-truth descriptions for the judge
  baseline.ts           # naive single-pass review — no planpong scaffolding
  judge.ts              # LLM-judge: does any issue substantively flag the defect?
  run.ts                # orchestrator
  results/              # gitignored — per-run JSON output
```

## Run

```sh
# Both modes (default), claude as judge.
npx tsx bench/quality/run.ts

# Only the planpong path.
npx tsx bench/quality/run.ts --mode planpong

# Only the baseline path.
npx tsx bench/quality/run.ts --mode baseline

# Use codex as judge instead of claude.
npx tsx bench/quality/run.ts --judge codex

# Single defect, fast iteration.
npx tsx bench/quality/run.ts --defect D5-wrong-binary-name --mode baseline
```

Output: `bench/quality/results/<iso>-<commit>/results.json`. Each defect record has both modes' issues + judge verdicts side-by-side.

## How "catch" is defined

The judge is given the defect's `groundTruth` (a precise description of what the defect is) plus the issues raised by a single mode. It returns:

```json
{
  "caught": true | false,
  "matched_issue_id": "F1" | null,
  "reasoning": "<one or two sentences>"
}
```

Strictness is enforced in the judge prompt: an issue counts only if it directly identifies the corrupted aspect, not adjacent concerns. Generic findings ("plan should be more specific") never count.

The judge runs in a separate provider invocation. **The judge MUST be a different provider than the one being judged** (default config: codex reviews, claude judges). Same-model self-validation is the circular trap we explicitly want to avoid.

## What single-pass-baseline gets

The baseline runs the same reviewer provider, same fixture access, same structured-output JSON shape — and a single, deliberately-naive prompt:

> Here's a plan. Here's the codebase. Find issues like wrong file paths, hallucinated functions, contradictions, missing steps, scope drift… Output JSON.

It does NOT get:
- Phase-specific scaffolding (no detail-phase "verify file references via your tools" nudge)
- Prior-decisions context
- A state machine that retries on failure
- The planpong reviewer prompt's strict severity guide and review framing

Anything the baseline catches that planpong also catches → no scaffolding signal.
Anything planpong catches that the baseline doesn't → scaffolding adds value, in the magnitude of the delta.
Anything the baseline catches that planpong misses → scaffolding actively hurts, surface and investigate.

## Add a new defect

1. Copy `bench/plans/small.md` to `bench/quality/defects/D<N>-<slug>.md` and inject one defect.
2. Add a `Defect` entry to `DEFECTS` in `defects.ts` with a precise `groundTruth` — describe exactly what the defect is and what counts as catching it.
3. Run with `--defect D<N>-<slug>` and verify the judge returns reasonable verdicts on both modes.

A good `groundTruth` is the difference between a useful and a noisy bench. Be specific about what the corrupted aspect is and what does NOT count as a catch (e.g., "generic 'consider edge cases' does not count"). The defect file itself should differ from `small.md` in exactly one observable way.

## Configuration knobs

The bench uses the repo's `planpong.yaml` config (planner + reviewer providers/models). Default is codex as reviewer, claude as judge — swap the judge with `--judge codex` if you want the inverse.

Detail-phase review is hardcoded (`session.currentRound = 3`) for the planpong mode because direction phase explicitly skips file-level concerns and risk phase is pre-mortem.

## What this bench is and isn't

**Is:**
- Per-defect catch rate for both planpong and a naive baseline, judged by a third model
- Comparison of the *same* reviewer model with vs without planpong scaffolding
- A way to detect scaffolding regressions: if planpong's catch rate drops below baseline on any defect class, something broke

**Isn't:**
- Iteration value (does the planner FIX what the reviewer flagged across rounds — currently single-shot review only)
- Multi-base-plan coverage (N=10 defects on N=1 base plan; medium.md not yet exercised)
- Cost-normalized: planpong mode runs more provider machinery than baseline. If wall time matters as much as catch rate, read both fields.
- Statistically rigorous: each defect runs once. A real claim needs N≥3 runs per defect to characterize judge variance.
