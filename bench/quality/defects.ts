/**
 * Defect catalog for the quality benchmark.
 *
 * Each entry describes a deliberate corruption injected into a base plan,
 * along with the ground-truth description an LLM judge uses to score whether
 * the reviewer's feedback substantively flagged the defect.
 *
 * The `groundTruth` field is the *only* signal the judge sees about what
 * "catching" means — keep it precise. It should describe what the defect
 * actually is, not paraphrase the keywords a reviewer might use.
 */

export interface Defect {
  id: string;
  planFile: string; // path relative to repo root
  description: string; // short human-readable summary for logs
  groundTruth: string; // detailed defect description used by the LLM judge
  isControl?: boolean;
}

export const DEFECTS: Defect[] = [
  {
    id: "D1-hallucinated-file",
    planFile: "bench/quality/defects/D1-hallucinated-file.md",
    description: "File path typo: idnex.ts instead of index.ts",
    groundTruth:
      "The plan instructs edits in `src/cli/idnex.ts`, but the file does not exist in the repository — the correct path is `src/cli/index.ts`. The defect is a typo in the filename. A correct catch identifies that `idnex.ts` is wrong (typo, missing file, or path mismatch) — not adjacent concerns like 'the plan should mention more files'.",
  },
  {
    id: "D2-internal-contradiction",
    planFile: "bench/quality/defects/D2-internal-contradiction.md",
    description:
      "Step contradicts Key Decisions (custom handler vs commander built-in)",
    groundTruth:
      "Step 1 instructs writing a CUSTOM `--version` handler that bypasses Commander's built-in version support, while Key Decisions mandates using Commander's built-in `.version()`. The two sections give mutually exclusive directives. A correct catch identifies the contradiction or conflict between Steps and Key Decisions on this specific point — not generic concerns about ambiguity.",
  },
  {
    id: "D3-missing-step",
    planFile: "bench/quality/defects/D3-missing-step.md",
    description:
      "Missing step: how does program.version() receive the version string?",
    groundTruth:
      "The plan calls `program.version()` but contains no step describing HOW the version string is obtained from `package.json` (no read, import, or load step). There is a missing data-flow step between 'register --version' and 'pass version from package.json'. A correct catch identifies the missing load/read/import step OR the missing connection between package.json and `program.version()`.",
  },
  {
    id: "D4-hallucinated-function",
    planFile: "bench/quality/defects/D4-hallucinated-function.md",
    description:
      "Calls Commander's `program.versionString()` — method does not exist",
    groundTruth:
      "The plan instructs calling `program.versionString()` on the Commander program. This method does not exist on Commander; the actual API is `program.version(string, flags?, description?)`. A correct catch identifies that `versionString` is not a Commander API, is hallucinated, or is the wrong method name. Generic 'use program.version() instead' counts only if it explicitly notes the called method is invalid.",
  },
  {
    id: "D5-wrong-binary-name",
    planFile: "bench/quality/defects/D5-wrong-binary-name.md",
    description: "Plan refers to binary `cli` but fixture's bin is `notes`",
    groundTruth:
      "The plan's Context and Verification Criteria refer to the CLI binary as `cli` (e.g., `cli --version`, `cli --help`). The actual fixture's `package.json` declares the bin as `notes`. The plan is inconsistent with the fixture's declared binary name. A correct catch identifies the binary-name mismatch with the fixture's `package.json` — i.e., the reviewer noted the bin should be `notes`, not `cli`.",
  },
  {
    id: "D6-hallucinated-import",
    planFile: "bench/quality/defects/D6-hallucinated-import.md",
    description:
      "Imports `readPackageVersion` from `node:os` — does not exist there",
    groundTruth:
      "The plan instructs `import { readPackageVersion } from \"node:os\"`. `readPackageVersion` is not exported from `node:os` — it is not a real Node.js API. A correct catch identifies that `readPackageVersion` is not a member of `node:os`, is hallucinated, or that this import will fail at runtime. Generic 'consider how to load version' does NOT count unless it explicitly questions this import.",
  },
  {
    id: "D7-scope-drift",
    planFile: "bench/quality/defects/D7-scope-drift.md",
    description:
      "Plan adds unrelated --config flag work to a --version-only goal",
    groundTruth:
      "The plan's stated goal in Context is adding a `--version` flag, but the Steps section also adds extensive work for an unrelated `--config` flag (config loader, `notes config init` subcommand, README docs). This is out-of-scope work bundled into the plan. A correct catch identifies the scope drift, scope creep, or out-of-scope additions related to the `--config` work — not generic comments like 'plan is too long'.",
  },
  {
    id: "D8-tsconfig-incompatibility",
    planFile: "bench/quality/defects/D8-tsconfig-incompatibility.md",
    description:
      "Uses JSON import attributes but tsconfig has no resolveJsonModule",
    groundTruth:
      "The plan uses `import pkg from \"../../package.json\" with { type: \"json\" }` to load the version. The fixture's `tsconfig.json` does not enable `resolveJsonModule` (and does not include `package.json` in the rootDir/include patterns), so this import will fail to compile under the current TypeScript config. A correct catch identifies that this import requires `resolveJsonModule: true` (or equivalent tsconfig change) which is not enabled, OR that the import is otherwise incompatible with the fixture's TS config. Generic 'consider how to read package.json' does NOT count.",
  },
  {
    id: "D9-verification-mismatch",
    planFile: "bench/quality/defects/D9-verification-mismatch.md",
    description:
      "Verification expects `-v` short alias and -V disabled, but Steps use Commander defaults",
    groundTruth:
      "The Verification Criteria expects `notes -v` to print the version and `notes -V` to NOT print it. The Steps section calls `program.version(...)` with Commander's defaults — Commander's built-in default short alias for `--version` is uppercase `-V`, not lowercase `-v`. With the steps as written, `-V` will print the version (contradicting verification) and `-v` will NOT (also contradicting verification). A correct catch identifies the mismatch between Verification Criteria and Steps regarding the short alias (`-v` vs `-V`), or that Commander's default short flag is `-V` not `-v`.",
  },
  {
    id: "D10-wrong-directory",
    planFile: "bench/quality/defects/D10-wrong-directory.md",
    description: "Plan targets `src/index.ts` but CLI lives at `src/cli/index.ts`",
    groundTruth:
      "The plan instructs edits to `src/index.ts`, but the fixture's CLI entrypoint is `src/cli/index.ts` (not at `src/`). The plan targets the wrong directory. A correct catch identifies that `src/index.ts` is the wrong path — the file does not exist or the entrypoint is at `src/cli/index.ts`. Distinct from D1 (which is a TYPO in the filename); this is a wrong DIRECTORY.",
  },
  {
    id: "control",
    planFile: "bench/plans/small.md",
    description: "Original plan, no defect",
    groundTruth:
      "This is the unmodified base plan. No defect is present. The judge MUST mark this as not-caught regardless of what issues the reviewer raises (any issues here are real-but-unrelated stylistic or scope concerns, not catches of an injected defect).",
    isControl: true,
  },
];
