import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { __injectCredentialVaultRuntimeForTests, createCredentialVault } from "./credentialVault";

const enabled = process.platform === "win32" && process.env.KFORGE_REAL_DPAPI === "1";

describe.skipIf(!enabled)("Windows ProtectedData vault acceptance (real OS DPAPI)", () => {
  let workspace = "";

  afterAll(async () => {
    __injectCredentialVaultRuntimeForTests(null);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("stores, reveals, and deletes a credential through the real OS vault round trip", { timeout: 120_000, retry: 0 }, async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "kforge-vault-dpapi-"));
    const vault = createCredentialVault(workspace);
    expect(await vault.backend()).toBe("WINDOWS_DPAPI_CURRENT_USER");
    expect(await vault.availability()).toBe("AVAILABLE");
    const secret = "sk-real-dpapi-roundtrip-20261102";
    const setStarted = Date.now();
    await vault.set("openai", secret);
    const setElapsed = Date.now() - setStarted;
    const display = await vault.metadata("openai");
    expect(display.configured).toBe(true);
    expect(display.source).toBe("OS_VAULT");
    expect(display.backend).toBe("WINDOWS_DPAPI_CURRENT_USER");
    expect(display.suffix).toBe(secret.slice(-4));
    expect(JSON.stringify(display)).not.toContain(secret);
    const revealStarted = Date.now();
    expect(await vault.reveal("openai")).toBe(secret);
    const revealElapsed = Date.now() - revealStarted;
    await vault.delete("openai");
    expect(await vault.has("openai")).toBe(false);
    console.info(`[dpapi-acceptance] set=${setElapsed}ms reveal=${revealElapsed}ms platform=${process.platform}`);
    expect(setElapsed).toBeLessThan(120_000);
    expect(revealElapsed).toBeLessThan(120_000);
  });

  it("keeps failure truth when an unprotect payload cannot be opened", { timeout: 60_000 }, async () => {
    workspace = workspace || (await mkdtemp(path.join(tmpdir(), "kforge-vault-dpapi-")));
    const vault = createCredentialVault(workspace);
    const { promises: fs } = await import("node:fs");
    const vaultPath = path.join(workspace, ".kforge", "provider-vault.json");
    await fs.mkdir(path.dirname(vaultPath), { recursive: true });
    await fs.writeFile(vaultPath, JSON.stringify({
      version: 1,
      credentials: { corrupted: { providerId: "corrupted", protectedValue: "not-base64-$$", suffix: "abcd", backend: "WINDOWS_DPAPI_CURRENT_USER", updatedAt: new Date().toISOString() } },
    }, null, 2), "utf8");
    await expect(vault.reveal("corrupted")).rejects.toThrow("OS credential decryption failed");
    await vault.delete("corrupted");
  });
});
