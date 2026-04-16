/**
 * Smoke test: verify that structured output works end-to-end for each
 * provider × schema combination. This is the manual pre-merge gate
 * documented in docs/plans/structured-output-schemas.md (F6 mitigation).
 *
 * Run with: npx tsx scripts/smoke-structured-output.ts
 *
 * For each combination, this script:
 * 1. Invokes the provider with the JSON Schema
 * 2. Parses output as JSON
 * 3. Validates against the corresponding Zod schema
 * 4. Reports pass/fail with details
 */

import { ClaudeProvider } from "../src/providers/claude.js";
import { CodexProvider } from "../src/providers/codex.js";
import {
  DirectionFeedbackJsonSchema,
  RiskFeedbackJsonSchema,
  ReviewFeedbackJsonSchema,
  PlannerRevisionJsonSchema,
} from "../src/schemas/json-schema.js";
import {
  DirectionFeedbackSchema,
  RiskFeedbackSchema,
  ReviewFeedbackSchema,
} from "../src/schemas/feedback.js";
import { PlannerRevisionSchema } from "../src/schemas/revision.js";
import type { ZodTypeAny } from "zod";
import type { Provider } from "../src/providers/types.js";

interface TestCase {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: ZodTypeAny;
  prompt: string;
}

const samplePlan = `# Sample Plan

**Status:** Draft

## Context
Add a button to the page.

## Steps
- [ ] Create button component
- [ ] Wire up onClick handler

## Verification
- Button renders and click works
`;

const jsonOnlyInstruction = `Output ONLY a single JSON object. The first character must be \`{\` and the last must be \`}\`. No prose, no markdown, no code fences, no preamble, no trailing text.`;

const cases: TestCase[] = [
  {
    schemaName: "DirectionFeedback",
    jsonSchema: DirectionFeedbackJsonSchema,
    zodSchema: DirectionFeedbackSchema,
    prompt: `Review this plan at a high level (direction phase). Use verdict "needs_revision". ${jsonOnlyInstruction}\n\n${samplePlan}`,
  },
  {
    schemaName: "RiskFeedback",
    jsonSchema: RiskFeedbackJsonSchema,
    zodSchema: RiskFeedbackSchema,
    prompt: `Conduct a risk pre-mortem on this plan (risk phase). Use verdict "needs_revision". ${jsonOnlyInstruction}\n\n${samplePlan}`,
  },
  {
    schemaName: "ReviewFeedback",
    jsonSchema: ReviewFeedbackJsonSchema,
    zodSchema: ReviewFeedbackSchema,
    prompt: `Review this plan for implementation completeness (detail phase). Use verdict "needs_revision". ${jsonOnlyInstruction}\n\n${samplePlan}`,
  },
  {
    schemaName: "PlannerRevision",
    jsonSchema: PlannerRevisionJsonSchema,
    zodSchema: PlannerRevisionSchema,
    prompt: `Revise this plan to add a third step "Add tests for the button". The updated_plan field must contain the FULL plan markdown (with realistic content including some \`\`\`js\nconst x = "hello";\n\`\`\` code fence to verify escaping). ${jsonOnlyInstruction}\n\n${samplePlan}`,
  },
];

interface Result {
  provider: string;
  schema: string;
  status: "PASS" | "FAIL";
  detail?: string;
  preview?: string;
}

async function runOne(
  provider: Provider,
  testCase: TestCase,
): Promise<Result> {
  const supported = await provider.checkStructuredOutputSupport();
  if (!supported) {
    return {
      provider: provider.name,
      schema: testCase.schemaName,
      status: "FAIL",
      detail: "Provider reports structured output not supported",
    };
  }

  const response = await provider.invoke(testCase.prompt, {
    cwd: process.cwd(),
    jsonSchema: testCase.jsonSchema,
    timeout: 180_000,
  });

  if (!response.ok) {
    return {
      provider: provider.name,
      schema: testCase.schemaName,
      status: "FAIL",
      detail: `Provider error (${response.error.kind}): ${response.error.message.slice(0, 300)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (e) {
    return {
      provider: provider.name,
      schema: testCase.schemaName,
      status: "FAIL",
      detail: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      preview: response.output.slice(0, 300),
    };
  }

  const zodResult = testCase.zodSchema.safeParse(parsed);
  if (!zodResult.success) {
    return {
      provider: provider.name,
      schema: testCase.schemaName,
      status: "FAIL",
      detail: `Zod validation failed: ${zodResult.error.message.slice(0, 500)}`,
      preview: JSON.stringify(parsed).slice(0, 300),
    };
  }

  return {
    provider: provider.name,
    schema: testCase.schemaName,
    status: "PASS",
    preview: JSON.stringify(parsed).slice(0, 200),
  };
}

async function main() {
  const providers: Provider[] = [new ClaudeProvider(), new CodexProvider()];
  const results: Result[] = [];

  for (const provider of providers) {
    const available = await provider.isAvailable();
    if (!available) {
      console.log(`\n[skip] ${provider.name} CLI not available`);
      continue;
    }
    console.log(`\n=== ${provider.name} ===`);
    for (const testCase of cases) {
      process.stdout.write(`  ${testCase.schemaName}... `);
      const result = await runOne(provider, testCase);
      results.push(result);
      console.log(result.status);
      if (result.status === "FAIL") {
        console.log(`    ${result.detail}`);
        if (result.preview) console.log(`    preview: ${result.preview}`);
      } else if (result.preview) {
        console.log(`    ${result.preview}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`${passed} passed, ${failed} failed (${results.length} total)`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
