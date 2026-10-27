import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCredentialVault, credentialDisplay, environmentVariableFor } from "./credentialVault";

/**
 * The Environment & model linking surface shows a developer which variable an
 * adapter reads. That name is safe to show; the value never is. These tests lock
 * both halves of that boundary.
 */
describe("credential vault environment conventions", () => {
  let root = "";

  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "kforge-vault-env-")); });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("names the variable each built-in cloud adapter reads", () => {
    expect(environmentVariableFor("openai")).toBe("OPENAI_API_KEY");
    expect(environmentVariableFor("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(environmentVariableFor("gemini")).toBe("GEMINI_API_KEY");
    expect(environmentVariableFor("openrouter")).toBe("OPENROUTER_API_KEY");
  });

  it("reports no convention for adapters that do not read an environment variable", () => {
    expect(environmentVariableFor("ollama")).toBeNull();
    expect(environmentVariableFor("lm-studio")).toBeNull();
    expect(environmentVariableFor("not-a-provider")).toBeNull();
  });

  it("stores a credential without ever surfacing its value through the name accessor", () => {
    const secret = "sk-vault-boundary-must-not-leak";
    process.env.OPENAI_API_KEY = secret;
    try {
      const name = environmentVariableFor("openai");
      expect(name).toBe("OPENAI_API_KEY");
      expect(name).not.toContain(secret);
      expect(JSON.stringify({ name })).not.toContain(secret);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("keeps an ephemeral credential behind a masked display rather than plaintext", async () => {
    const vault = createCredentialVault(root, { platform: "linux" });
    await vault.set("openai", "sk-local-development-value-1234");
    const display = await credentialDisplay(root, "openai");
    expect(display.configured).toBe(true);
    expect(display.source).toBe("EPHEMERAL");
    expect(JSON.stringify(display)).not.toContain("sk-local-development-value-1234");
  });
});
