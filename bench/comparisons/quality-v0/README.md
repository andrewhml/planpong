# Quality v0 — Defect-Injection Benchmark

First measured signal of whether planpong's review actually catches things. Inject known defects into a base plan, run a single detail-phase review against a real fixture codebase, score whether the reviewer flagged each defect.

## Setup

- **Base plan:** `bench/plans/small.md` (a 24-line plan to add `--version` to a CLI)
- **Fixture:** `bench/quality/fixture-repo/` — small commander-based notes CLI seeded into the review scratch dir so the reviewer can read real source via tools
- **Review:** single round, detail phase (`getReviewPhase(round=3)`)
- **Reviewer:** codex(gpt-5.3-codex/xhigh)
- **Reviewer prompt nudge:** `src/prompts/reviewer.ts` detail-phase block instructs the reviewer to verify file references and symbols using its tools (Read/Grep/Glob/Bash)

## Defects + ground truth

| ID | Defect | Expected to flag |
|---|---|---|
| D1 | File path typo: `src/cli/idnex.ts` instead of `src/cli/index.ts` | "the file does not exist" / wrong path / typo |
| D2 | Steps say "use a custom handler" but Key Decisions says "use commander's built-in" | contradiction / conflict between sections |
| D3 | Missing step: no instruction that says how `program.version()` receives the version string from `package.json` | missing step / how is version loaded / data flow gap |
| control | Original plan, no defect | (catch rate should be 0) |

## Result

**3/3 real catches, 0 false positive on control.**

Each catch was on-target — the reviewer's findings name the actual injected defect, not boilerplate concerns. D1 specifically demonstrates filesystem tool use: *"`src/cli/idnex.ts` does not exist; the repository contains `src/cli/index.ts` as the actual CLI entrypoint."* Only verifiable by reading the fixture's filesystem.

Full per-defect issues in `results.json`. Sample:

```
D1: P1 "CLI file path is incorrect (src/cli/idnex.ts does not exist)"
D2: P1 "Conflicting implementation directives for --version"
D3: P2 "Missing explicit step to source version from package metadata.
       There is no explicit step describing how that value is loaded."
control: P3 "Manual help update is likely unnecessary with Commander"
         (minor, unrelated, not a false positive on injected defect categories)
```

## What this benchmark proves and doesn't

**Proves:** the reviewer, given fixture access and a tool-use nudge, catches three distinct classes of plan defect (filesystem-verifiable references, internal contradictions, missing data flow) with precision. Control's only finding is a minor stylistic note, not a noise-level defect-class match.

**Doesn't prove yet:**
- *Iteration value.* This bench tests a single review round, not the full planpong loop. The question "does the planner actually FIX the flagged issue?" is a separate measurement.
- *Generalization.* N=3 defects on N=1 base plan. Real coverage needs more defect classes (wrong API, hallucinated function, scope drift, etc.) and multiple base plans of different complexity.
- *Single-pass-review baseline.* We didn't compare to "just one LLM, no review loop, no fixture." Without that control, we can't say planpong specifically helps — just that the reviewer catches things.
- *Score robustness.* Keyword-matching scoring is brittle. An LLM-judge ("did the reviewer's feedback substantively flag the injected defect?") would be more reliable but adds cost.

## Reproduce

```sh
# Bench directly drops the fixture into a tmpdir + runs review.
npx tsx bench/quality/run.ts

# Output lands in bench/quality/results/<iso>-<commit>/results.json (gitignored).
```

## Caveats this run revealed

1. The bench's first iteration (without fixture, round-1 direction phase) caught only ~33% of defects. Both fixes mattered:
   - **Fixture access** lets the reviewer verify real claims against real source.
   - **Detail phase** is the only phase where file-level issues get scrutinized; direction phase explicitly skips them.

2. Initial run also surfaced an unrelated bug — `bench/plans/small.md` referenced a CLI named `cli` while the fixture's binary is `notes`. Every plan got flagged for this. Plans were updated to match. Lesson: a quality bench is only as good as the correspondence between its base plans and the fixture they run against.

## Next-step priorities

- Add 10-15 more defect classes (wrong API signatures, hallucinated function names, broken import paths, scope drift, contradictory verification criteria)
- Add a single-pass-LLM-review baseline (no planpong loop) and an LLM-judge scoring layer
- Measure iteration value separately: "does the planner address the flagged issue in its revision?"
