# Phase-Specific Feedback Schemas + Report Tool

**Status:** Shipped (PR [#16](https://github.com/andrewhml/planpong/pull/16), commit `16228ff`, v0.2.0) — planpong-approved after 4 rounds.

## Problem

All three review phases use the same flat `{verdict, summary, issues[]}` schema. This loses phase-specific signal: direction review should surface confidence/alternatives/assumptions, risk review should produce a structured risk register. The `round < 3` convergence guard is a band-aid — it overrides the reviewer's verdict rather than constraining the output space.

Users see only status lines during the review loop, with full detail available on demand after completion via a new `planpong_get_report` tool.

## Design

### Phase-specific schemas

**Direction feedback** (round 1) adds:
- `confidence`: `"high" | "medium" | "low"` — overall confidence in the approach
- `approach_assessment`: string — why the approach works or doesn't
- `alternatives`: `{approach, tradeoff}[]` — approaches the reviewer considered
- `assumptions`: `string[]` — unstated assumptions the plan relies on
- `verdict`: `"needs_revision" | "blocked"` — direction phase cannot approve; `blocked` for fundamentally non-viable plans (external constraints, missing dependencies, policy violations)

**Risk feedback** (round 2) adds:
- `risk_level`: `"high" | "medium" | "low"` — overall risk assessment
- `risks`: structured risk register entries, each with:
  - `id`, `category` (`"dependency" | "integration" | "operational" | "assumption" | "external"`), `likelihood` (`"high" | "medium" | "low"`), `impact` (`"high" | "medium" | "low"`), `title`, `description`, `mitigation`
- `verdict`: `"needs_revision" | "blocked"` — risk phase cannot approve; `blocked` when risks are unmitigable hard-stops
- Reviewer decides which risks become issues — `risks[]` is the full register, `issues[]` is the actionable subset

**Detail feedback** (round 3+): unchanged. All three verdicts available (`needs_revision`, `approved`, `approved_with_notes`).

### Blocked verdict semantics

`blocked` is a terminal state. When a direction or risk review returns `blocked`:
- The loop terminates immediately (no revision round, no further phases)
- The status line shows `blocked` with the phase: `**planpong:** R1/10 | claude → codex | direction | BLOCKED | 1P1 | 12s`
- The session status is set to `blocked`
- The plan file's status line reflects the blocked state
- The report tool includes the blocking rationale from `approach_assessment` (direction) or `risks[]` (risk)

Use cases: plan depends on a deprecated/unavailable API, violates a hard organizational constraint, requires resources that don't exist, or has a fundamental logical flaw that revision can't address.

**Blocked rationale validation:** A `blocked` verdict is only accepted if it includes non-empty rationale — `approach_assessment` for direction phase, at least one entry in `risks[]` for risk phase. If a `blocked` verdict arrives without rationale, it is coerced to `needs_revision` with a warning logged (rationale: a bare `blocked` without justification is likely model noise, not a legitimate hard-stop).

**Fallback parsing and blocked rationale:** When phase-specific parsing fails and fallback parsing yields a `blocked` verdict, the rationale fields (`approach_assessment`, `risks[]`) will be absent from the fallback-parsed feedback object. To avoid incorrectly coercing legitimate `blocked` verdicts, `parseFeedbackForPhase` performs a secondary rationale extraction from the raw content before running blocked-rationale validation:

1. Phase-specific parser runs first. If it succeeds, proceed normally.
2. If it fails, fallback parser runs against the base schema.
3. If fallback yields `blocked`, attempt to extract rationale fields from the raw content via targeted JSON field extraction (regex for `approach_assessment` string value or `risks` array from the raw model output).
4. Run blocked-rationale validation against the extracted fields (not the fallback feedback object).
5. If rationale is found, preserve `blocked` and attach the extracted rationale to the feedback object. If rationale is not found, coerce to `needs_revision` with warning.

This ensures legitimate `blocked` verdicts survive fallback parsing when the model produced valid rationale but the phase-specific parser failed on other fields (e.g., missing `alternatives` or `assumptions`).

### Convergence

Remove the `round < 3` guard from `isConverged`. Phase-gated convergence is enforced through two mechanisms:

1. **Schema constraint:** Direction and risk schemas only allow `needs_revision` or `blocked` verdicts. Terminal approval verdicts (`approved`, `approved_with_notes`) are structurally absent.

2. **Verdict coercion invariant:** The phase-aware parse dispatcher coerces verdicts after parsing, including fallback parsing. If direction or risk phase parsing falls back to the base schema (which allows `approved`/`approved_with_notes`), the dispatcher coerces the verdict to `needs_revision`. This ensures the invariant holds even when the model produces non-compliant output.

```ts
// In parseFeedbackForPhase:
const feedback = phaseParser(content) ?? fallbackParse(content);
if (phase !== 'detail' && feedback.verdict !== 'blocked') {
  feedback.verdict = 'needs_revision';
}
return feedback;
```

`isConverged` becomes:
```ts
return feedback.verdict === 'approved' 
    || feedback.verdict === 'approved_with_notes'
    || feedback.verdict === 'blocked';
```

### Status line changes

Phase-specific signals in the status line:

- Direction: `**planpong:** R1/10 | claude → codex | direction | confidence: medium | 1P2 | 12s`
- Direction (blocked): `**planpong:** R1/10 | claude → codex | direction | BLOCKED | 1P1 | 12s`
- Risk: `**planpong:** R2/10 | claude → codex | risk | risk: high | 3 risks (2 promoted) | 1P1 1P2 | 15s`
- Risk (blocked): `**planpong:** R2/10 | claude → codex | risk | BLOCKED | 2 unmitigable risks | 15s`
- Detail: unchanged from today

### MCP tool response during loop (get-feedback)

Status line as first content block (unchanged). JSON response stays lean — same fields as today plus phase-specific signals needed for the status line only:
- Direction: adds `confidence` field
- Risk: adds `risk_level`, `risk_count`, `risks_promoted` fields
- Detail: unchanged

When `blocked`: adds `is_blocked: true` to the response so the orchestrator knows to stop without calling revise.

The full phase-specific data (alternatives, assumptions, risk register) is persisted to `R{n}.feedback.json` but NOT included in the tool response. It's consumed via the report tool.

### New tool: `planpong_get_report`

Reads all `R*.feedback.json` files for a completed (or in-progress) session. Assembles the full phase-specific detail view.

Input: `session_id`, optional `cwd`

Output: structured JSON with per-phase sections:
```json
{
  "session": { "id": "...", "status": "approved", "rounds_completed": 3, "complete": true, "fallback_count": 0 },
  "direction": {
    "confidence": "medium",
    "approach_assessment": "...",
    "alternatives": [{ "approach": "...", "tradeoff": "..." }],
    "assumptions": ["..."],
    "issues": ["..."],
    "revision_responses": ["..."],
    "fallback_used": false
  },
  "risk": {
    "risk_level": "high",
    "risks": [{ "id": "R1", "category": "dependency", "likelihood": "medium", "impact": "high", "title": "...", "description": "...", "mitigation": "..." }],
    "issues": ["..."],
    "revision_responses": ["..."],
    "fallback_used": false
  },
  "detail_rounds": [
    {
      "round": 3,
      "verdict": "approved_with_notes",
      "summary": "...",
      "issues": ["..."],
      "revision_responses": ["..."],
      "fallback_used": false
    }
  ],
  "trajectory": "1P2 → 1P1 1P2 → 1P3"
}
```

For blocked sessions, the report shows which phase blocked and the blocking rationale, with subsequent phases marked as "not reached".

**File pairing rules:** Report assembly pairs files by round index (`R{n}.feedback.json` ↔ `R{n}.response.json`). Expected patterns: blocked rounds have feedback but no response file; in-progress sessions may have feedback without a corresponding response for the latest round. Missing files are tolerated — the report marks those rounds as incomplete rather than failing. For in-progress sessions, `complete: false` is set in the session info.

Register as MCP prompt `report` for slash-command access.

## Changes

### Schema layer (`src/schemas/feedback.ts`)

1. Add `DirectionExtras` schema: `confidence`, `approach_assessment`, `alternatives[]`, `assumptions[]`
2. Add `RiskEntry` schema: `id`, `category`, `likelihood`, `impact`, `title`, `description`, `mitigation`
3. Add `RiskExtras` schema: `risk_level`, `risks[]`
4. Add `DirectionFeedbackSchema` = base feedback fields + direction extras, verdict locked to `z.enum(["needs_revision", "blocked"])`
5. Add `RiskFeedbackSchema` = base feedback fields + risk extras, verdict locked to `z.enum(["needs_revision", "blocked"])`
6. Update `ReviewFeedbackSchema` verdict enum to include `blocked`: `z.enum(["needs_revision", "approved", "approved_with_notes", "blocked"])` — this ensures the fallback parser can accept `blocked` verdicts from direction/risk phases when phase-specific parsing fails
7. Export a union type `PhaseFeedback = DirectionFeedback | RiskFeedback | ReviewFeedback`

### Prompt layer (`src/prompts/reviewer.ts`)

8. Update `buildDirectionReviewInstructions` — remove "approve the plan" language, add instruction to produce `confidence`, `approach_assessment`, `alternatives`, `assumptions` fields. Add `blocked` verdict guidance: use only when the plan is fundamentally non-viable due to hard external constraints, not for fixable issues.
9. Update `buildRiskReviewInstructions` — remove "approve it" language, add instruction to produce `risk_level`, `risks[]` fields. Instruct reviewer that `risks[]` is the full register and `issues[]` is the subset needing plan changes. Add `blocked` verdict guidance: use only when unmitigable risks make the plan non-viable.
10. Update `buildReviewPrompt` — use phase-specific JSON schema examples in the prompt for direction and risk phases

### Parse/convergence layer (`src/core/convergence.ts`)

11. Add `parseDirectionFeedback` — extracts JSON, validates against `DirectionFeedbackSchema`
12. Add `parseRiskFeedback` — extracts JSON, validates against `RiskFeedbackSchema`
13. Update `parseFeedback` to remain the detail-phase parser (or rename for clarity)
14. Add `parseFeedbackForPhase(content, phase)` dispatcher that:
    - Calls the phase-specific parser first
    - Falls back to base `parseFeedback` if phase-specific parse fails (base schema now includes `blocked` in verdict enum per step 6)
    - **Verdict coercion invariant:** For direction/risk phases, if verdict is not `blocked`, coerce to `needs_revision` — regardless of which parser produced the result
    - **Blocked rationale validation (primary path):** For direction phase, reject `blocked` if `approach_assessment` is empty/missing (coerce to `needs_revision` with warning). For risk phase, reject `blocked` if `risks[]` is empty/missing (coerce to `needs_revision` with warning).
    - **Blocked rationale validation (fallback path):** When fallback parsing yields `blocked`, rationale fields are absent from the parsed object. Before coercing, perform secondary extraction from the raw `content` string: regex/JSON extraction for `approach_assessment` (direction) or `risks` array (risk). If rationale is found in raw content, preserve `blocked` and attach extracted rationale to the feedback object. If not found, coerce to `needs_revision` with warning.
    - Records `fallback_used: true` and `missing_phase_fields: string[]` on the feedback object when fallback parsing is used
    - Logs a warning when fallback is used (phase-specific fields will be missing from the feedback file, except rationale fields recovered via secondary extraction)
15. Update `isConverged` — remove `round < 3` guard, return `verdict !== "needs_revision"` (covers `approved`, `approved_with_notes`, and `blocked`)

### Operations layer (`src/core/operations.ts`)

16. Update `runReviewRound` — call `parseFeedbackForPhase(content, phase)` instead of `parseFeedback(content)`
17. Update `buildStatusLine` — accept optional phase-specific extras (`confidence`, `risk_level`, `risk_count`, `risks_promoted`, `is_blocked`) and include them after the phase label
18. Update `writeStatusLineToPlan` — pass phase-specific extras from the parsed feedback
19. Update `severityFromFeedback` to work with all feedback types (the `issues` field is common to all, so this may already work)
20. Handle `blocked` verdict in `runReviewRound` — set session status to `blocked`, skip revision round
21. Persist `fallback_used` and `missing_phase_fields` to the feedback JSON file when writing `R{n}.feedback.json`

### MCP get-feedback tool (`src/mcp/tools/get-feedback.ts`)

22. Add phase-specific summary fields to the JSON response:
    - Direction: `confidence`, and `is_blocked` if blocked
    - Risk: `risk_level`, `risk_count`, `risks_promoted`, and `is_blocked` if blocked
    - Detail: unchanged
23. Full phase-specific data (alternatives, assumptions, risk register) is persisted to disk only — NOT in tool response
24. When blocked, set `is_converged: true` in the response so the orchestrator terminates the loop

### New MCP tool (`src/mcp/tools/get-report.ts`)

25. Implement `planpong_get_report` tool
26. Read all `R*.feedback.json` and `R*.response.json` files for the session, paired by round index
27. Assemble phase-specific sections (direction, risk, detail_rounds); tolerate missing response files for blocked rounds and in-progress sessions
28. Include revision responses alongside each phase's issues
29. Handle blocked sessions: show blocking phase and rationale, mark subsequent phases as "not reached"
30. Include per-phase `fallback_used` and top-level `fallback_count` in the report
31. Set `complete: false` for in-progress sessions
32. Return structured JSON

### Server registration (`src/mcp/server.ts`)

33. Import and register `planpong_get_report`
34. Add MCP prompt `report` for slash-command access
35. Update server instructions to mention the report tool for post-review detail and blocked session inspection

### Session layer (`src/core/session.ts`)

36. Add `blocked` to the session status enum (alongside `in_progress`, `approved`, `approved_with_notes`)

### Tests

37. `src/schemas/feedback.test.ts` — new file: validate direction/risk schemas, verdict locking (only `needs_revision`/`blocked`), risk entry validation, rejection of `approved` verdicts in direction/risk schemas, verify base schema accepts `blocked` verdict
38. `src/core/convergence.test.ts` — update: remove round-guard tests, add phase-specific parsing tests, add verdict coercion tests (verify `approved` from fallback is coerced to `needs_revision` in direction/risk), add `blocked` convergence test, **add fallback-blocked tests: (a) direction-phase output with valid `blocked` verdict + rationale in raw content but missing other phase fields → phase parser fails → fallback parser accepts `blocked` → secondary extraction recovers `approach_assessment` → `blocked` preserved; (b) risk-phase equivalent: fallback `blocked` + secondary extraction recovers `risks[]` → `blocked` preserved; (c) fallback `blocked` with no rationale in raw content → coerced to `needs_revision`**, add blocked-without-rationale coercion test
39. `src/mcp/tools/get-report.test.ts` — new file: test report assembly from mock feedback/response files, test blocked session report, test in-progress session with missing response file, test `fallback_used` surfacing
40. `src/prompts/reviewer.test.ts` — update: verify phase-specific JSON schema appears in prompts, verify `blocked` guidance appears in direction/risk prompts
41. End-to-end blocked flow test: `blocked` verdict → parse → session status set to `blocked` → get-feedback returns `is_blocked: true` + `is_converged: true` → report shows blocking rationale

## Risks

- **Reviewer models may not reliably produce the extended schema.** Mitigation: the phase-specific fields are additive — `parseFeedbackForPhase` falls back to base schema if extras are missing, logging a warning. The base schema now includes `blocked` in its verdict enum (step 6), so `blocked` verdicts survive fallback parsing. For `blocked` verdicts under fallback, secondary extraction from raw content recovers rationale fields before blocked-rationale validation runs (see "Fallback parsing and blocked rationale" in Design). Verdict coercion ensures the phase invariant holds even under fallback. The status line just omits the phase signal. Fallback usage is tracked (`fallback_used`, `missing_phase_fields`) in feedback files and surfaced in the report tool.
- **Breaking change to feedback JSON files.** Old sessions with flat feedback won't have phase-specific fields. The report tool handles missing fields gracefully (show "N/A" or skip the section).
- **`blocked` verdict could be overused by aggressive reviewers.** Mitigation: prompt guidance explicitly restricts `blocked` to hard external constraints (unavailable dependencies, policy violations) — not fixable design issues. Parse-time validation rejects bare `blocked` verdicts without rationale, coercing them to `needs_revision`. The status line makes blocked state highly visible, so misuse is easy to catch. Recovery path: start a new review session.
- **Enum expansion for `blocked` in base schema.** Adding `blocked` to the base `ReviewFeedbackSchema` verdict enum means the detail-phase parser technically accepts `blocked`. This is safe because: (1) detail-phase prompts don't mention `blocked`, (2) if a detail-phase model hallucinated `blocked`, `isConverged` would correctly terminate — which is appropriate since the orchestrator can inspect the report and restart if needed.