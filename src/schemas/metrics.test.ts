import { describe, it, expect } from "vitest";
import { InvocationAttemptSchema, RoundMetricsSchema } from "./metrics.js";

describe("InvocationAttemptSchema mode field", () => {
  const baseAttempt = {
    provider: "claude",
    model: "opus",
    effort: null,
    prompt_chars: 100,
    prompt_lines: 5,
    output_chars: 200,
    output_lines: 10,
    duration_ms: 1234,
    ok: true,
    error_kind: null,
    error_exit_code: null,
  };

  it("accepts the canonical 'structured' value", () => {
    const parsed = InvocationAttemptSchema.parse({ ...baseAttempt, mode: "structured" });
    expect(parsed.mode).toBe("structured");
  });

  it("accepts the canonical 'prompted' value", () => {
    const parsed = InvocationAttemptSchema.parse({ ...baseAttempt, mode: "prompted" });
    expect(parsed.mode).toBe("prompted");
  });

  it("normalizes the historical 'legacy' value to 'prompted' for back-compat", () => {
    // Metrics files written before the rename used mode: "legacy".
    // The schema must keep parsing those without error and surface the
    // canonical name to in-memory consumers.
    const parsed = InvocationAttemptSchema.parse({ ...baseAttempt, mode: "legacy" });
    expect(parsed.mode).toBe("prompted");
  });

  it("rejects unknown mode values", () => {
    expect(() =>
      InvocationAttemptSchema.parse({ ...baseAttempt, mode: "freestyle" }),
    ).toThrow();
  });
});

describe("RoundMetricsSchema with legacy mode entries", () => {
  it("parses a full metrics file that contains a 'legacy' attempt", () => {
    const onDisk = {
      schema_version: 1,
      session_id: "sess-1",
      round: 2,
      phase: "detail",
      role: "review",
      started_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:01:00.000Z",
      total_duration_ms: 60_000,
      attempts: [
        {
          mode: "structured",
          provider: "claude",
          model: "opus",
          effort: null,
          prompt_chars: 100,
          prompt_lines: 5,
          output_chars: null,
          output_lines: null,
          duration_ms: 50,
          ok: false,
          error_kind: "capability",
          error_exit_code: 2,
        },
        {
          mode: "legacy",
          provider: "claude",
          model: "opus",
          effort: null,
          prompt_chars: 110,
          prompt_lines: 6,
          output_chars: 200,
          output_lines: 10,
          duration_ms: 1000,
          ok: true,
          error_kind: null,
          error_exit_code: null,
        },
      ],
    };

    const parsed = RoundMetricsSchema.parse(onDisk);
    expect(parsed.attempts[0].mode).toBe("structured");
    expect(parsed.attempts[1].mode).toBe("prompted");
  });
});
