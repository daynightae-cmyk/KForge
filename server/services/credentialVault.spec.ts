import { mkdtemp, readFile, rm } from "node:fs/promises";
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

/**
 * The Windows OS vault is reached through PowerShell, whose cold start is slow
 * enough that a synchronous call used to freeze the entire local API server for
 * the duration of every credential read or write. These cases lock the seam
 * that made the operation asynchronous: the vault must await the runtime, must
 * let independent operations overlap instead of serialising behind one child
 * process, and must still tell the truth when the runtime rejects.
 */
describe("credential vault OS runtime seam", () => {
  let workspace = "";

  beforeAll(async () => { workspace = await mkdtemp(path.join(tmpdir(), "kforge-vault-runtime-")); });
  afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

  function delayedRuntime(latencyMs: number) {
    const calls: string[] = [];
    const runtime = {
      platform: "win32" as NodeJS.Platform,
      protect: async (plaintext: string) => {
        calls.push(`protect:start`);
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        calls.push("protect:end");
        return Buffer.from(`protected:${plaintext}`, "utf8").toString("base64");
      },
      unprotect: async (protectedValue: string) => {
        calls.push("unprotect:start");
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        calls.push("unprotect:end");
        return Buffer.from(protectedValue, "base64").toString("utf8").replace(/^protected:/, "");
      },
    };
    return { calls, runtime };
  }

  it("awaits an asynchronous OS protector instead of demanding a synchronous return", async () => {
    const { calls, runtime } = delayedRuntime(40);
    const vault = createCredentialVault(workspace, runtime);
    await vault.set("anthropic", "sk-ant-runtime-seam-000111");
    const revealed = await vault.reveal("anthropic");
    expect(revealed).toBe("sk-ant-runtime-seam-000111");
    expect(calls).toContain("protect:start");
    expect(calls).toContain("protect:end");
    expect(await vault.backend()).toBe("WINDOWS_DPAPI_CURRENT_USER");
  });

  it("does not serialise independent credential writes behind one runtime call", async () => {
    const { runtime } = delayedRuntime(300);
    const first = createCredentialVault(path.join(workspace, "provider-a"), runtime);
    const second = createCredentialVault(path.join(workspace, "provider-b"), runtime);
    const started = Date.now();
    await Promise.all([
      first.set("openai", "sk-first-credential-000000"),
      second.set("openai", "sk-second-credential-000000"),
    ]);
    const elapsed = Date.now() - started;
    // One protect plus the reveal verification per write: serialised behaviour
    // would need four 300 ms calls, so the overlap has to be visible here.
    expect(elapsed, `credential writes serialised again (${elapsed} ms)`).toBeLessThan(3 * 300);
    expect(await first.reveal("openai")).toBe("sk-first-credential-000000");
    expect(await second.reveal("openai")).toBe("sk-second-credential-000000");
  });

  it("refuses to report a stored credential it cannot read back through the OS", async () => {
    const plaintext = "sk-unreadable-runtime-445566";
    const target = path.join(workspace, "rejecting");
    const vault = createCredentialVault(target, {
      platform: "win32" as NodeJS.Platform,
      protect: async () => Buffer.from(`protected:${plaintext}`, "utf8").toString("base64"),
      unprotect: async () => { throw new Error("Cannot decrypt the payload because the current user profile changed."); },
    });
    // `set` verifies its own write, so an OS that cannot open the payload it
    // just produced must fail the save rather than report success.
    await expect(vault.set("openai", plaintext)).rejects.toThrow("OS credential decryption failed for the current Windows user.");
    await expect(vault.reveal("openai")).rejects.toThrow("OS credential decryption failed for the current Windows user.");

    // The stored record is a protected payload only: neither the vault file nor
    // the metadata surface may carry the credential in the clear.
    const stored = await readFile(path.join(target, ".kforge", "provider-vault.json"), "utf8");
    expect(stored).not.toContain(plaintext);
    expect(Buffer.from(stored).toString("base64")).not.toContain(Buffer.from(plaintext).toString("base64"));
    const display = await vault.metadata("openai");
    expect(JSON.stringify(display)).not.toContain(plaintext);
  });

  it("fails the write when the OS protector rejects rather than storing plaintext", async () => {
    const vault = createCredentialVault(path.join(workspace, "protect-fails"), {
      platform: "win32" as NodeJS.Platform,
      protect: async () => { throw new Error("PowerShell DPAPI operation exceeded the 10000 ms deadline and was terminated."); },
      unprotect: async () => "",
    });
    await expect(vault.set("openai", "sk-must-never-be-stored-plain")).rejects.toThrow();
    expect(await vault.has("openai")).toBe(false);
    const display = await vault.metadata("openai");
    expect(display.configured).toBe(false);
    expect(JSON.stringify(display)).not.toContain("sk-must-never-be-stored-plain");
  });
});
