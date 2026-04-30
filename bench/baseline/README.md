# bench/baseline/

Frozen reference runs used as the "before" side of every improvement experiment. Each numbered run is a single `npx tsx bench/run.ts bench/plans/<plan>.md` result — no averaging, no editing. Variance is real; that's why there are three.

```
bench/baseline/
  small/
    run-1.json
    run-2.json
    run-3.json
  medium/
    run-1/medium.json
    run-2/medium.json
    run-3/medium.json
    run-all.log        # combined stdout from all three runs
```

## What the baseline measures

Captured on commit `ac41a58` with the repo's `planpong.yaml`:

- planner: `claude(claude-opus-4-6/high)`
- reviewer: `codex(gpt-5.3-codex/xhigh)`

## Using it

```sh
# Print one baseline run
npx tsx bench/summarize.ts bench/baseline/small/run-1.json

# Delta between baseline run and a latest run
npx tsx bench/summarize.ts bench/baseline/small/run-1.json bench/results/<stamp>/small.json
```

Variance across the 3 small runs (see the files): 3–5 rounds to converge, 7m–12m wall clock, 17k–35k output chars. Any experimental change producing a swing larger than that on the same plan is real signal; smaller is noise.

## Replacing the baseline

When models or the repo's config change materially, replace rather than edit. Delete the contents of `bench/baseline/<plan>/`, re-run three times, commit fresh files. Record the commit SHA of the code the baseline ran against — it's already in each result JSON as the `commit` field.
