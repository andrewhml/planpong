import { describe, it, expect } from "vitest";
import { ClaudeProvider } from "./claude.js";

describe("ClaudeProvider.invoke", () => {
  it("throws when both newSessionId and resumeSessionId are set", async () => {
    const provider = new ClaudeProvider();
    await expect(
      provider.invoke("hi", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(
      "claude provider: newSessionId and resumeSessionId are mutually exclusive",
    );
  });
});
