import { describe, it, expect } from "vitest";
import { CodexProvider } from "./codex.js";

describe("CodexProvider.invoke", () => {
  it("throws when both newSessionId and resumeSessionId are set", async () => {
    const provider = new CodexProvider();
    await expect(
      provider.invoke("hi", {
        cwd: "/tmp",
        newSessionId: "11111111-1111-1111-1111-111111111111",
        resumeSessionId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(
      "codex provider: newSessionId and resumeSessionId are mutually exclusive",
    );
  });
});
