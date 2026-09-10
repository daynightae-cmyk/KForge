import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export interface CredentialBackendContract {
  kind: "windows-dpapi" | "ephemeral" | "environment" | "in-memory";
  store(providerId: string, secret: string): Promise<void>;
  read(providerId: string): Promise<string | null>;
  delete(providerId: string): Promise<void>;
  exists(providerId: string): Promise<boolean>;
  capability(): Promise<"AVAILABLE" | "UNAVAILABLE" | "ENVIRONMENT_ONLY">;
}

export type CredentialBackend = "OS_DPAPI" | "EPHEMERAL" | "ENVIRONMENT";
export type VaultAvailability = "AVAILABLE" | "UNAVAILABLE" | "ENVIRONMENT_ONLY";
export type MigrationOutcome = "MIGRATION_SUCCESS" | "MIGRATION_FAILED" | "NOT_REQUIRED";

export interface CredentialVault {
  availability(): Promise<VaultAvailability>;
  backend(): Promise<CredentialBackend | "NONE">;
  set(providerId: string, secret: string): Promise<void>;
  has(providerId: string): Promise<boolean>;
  reveal(providerId: string): Promise<string | null>;
  delete(providerId: string): Promise<void>;
  source(providerId: string): Promise<"OS_VAULT" | "ENVIRONMENT" | "EPHEMERAL" | "NONE">;
}

interface VaultMeta {
  entries: Record<string, { backend: CredentialBackend; updatedAt: string; suffix: string }>;
}

interface DpapiBlobFile {
  version: 1;
  blobs: Record<string, string>;
}

const ephemeralMemory = new Map<string, Map<string, string>>();

function metaPath(root: string) {
  return path.join(root, ".kforge", "provider-credential-meta.json");
}

function dpapiPath(root: string) {
  return path.join(root, ".kforge", "provider-vault.dpapi.json");
}

function legacyPath(root: string) {
  return path.join(root, ".kforge", "provider-secrets.json");
}

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(target: string, value: unknown) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

function validId(providerId: string) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(providerId);
}

let dpapiProbe: boolean | null = null;

async function dpapiRoundTrip(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (dpapiProbe !== null) return dpapiProbe;
  try {
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$probe = [Text.Encoding]::UTF8.GetBytes('kforge-vault-probe')",
      "$protected = [Security.Cryptography.ProtectedData]::Protect($probe, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "$unprotected = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "if ([Text.Encoding]::UTF8.GetString($unprotected) -eq 'kforge-vault-probe') { 'DPAPI_OK' } else { 'DPAPI_MISMATCH' }",
    ].join("\n");
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15_000 });
    dpapiProbe = result.stdout.trim().includes("DPAPI_OK");
  } catch {
    dpapiProbe = false;
  }
  return dpapiProbe;
}

async function dpapiProtect(plaintext: string): Promise<string> {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($env:KFORGE_VAULT_PLAINTEXT)",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($protected)",
  ].join("\n");
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 15_000,
    env: { ...process.env, KFORGE_VAULT_PLAINTEXT: plaintext },
  });
  const blob = result.stdout.trim();
  if (!blob) throw new Error("OS vault protection returned no data.");
  return blob;
}

async function dpapiUnprotect(blob: string): Promise<string> {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$protected = [Convert]::FromBase64String($env:KFORGE_VAULT_BLOB)",
    "$unprotected = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Text.Encoding]::UTF8.GetString($unprotected)",
  ].join("\n");
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 15_000,
    env: { ...process.env, KFORGE_VAULT_BLOB: blob },
  });
  return result.stdout.replace(/\r?\n$/, "");
}

function ephemeralMap(root: string): Map<string, string> {
  let scoped = ephemeralMemory.get(root);
  if (!scoped) {
    scoped = new Map();
    ephemeralMemory.set(root, scoped);
  }
  return scoped;
}

const ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function environmentSecret(providerId: string): string {
  const base = providerId.startsWith("headers.") ? null : ENV_KEYS[providerId];
  if (base && process.env[base]?.trim()) return process.env[base].trim();
  return "";
}

export function createCredentialVault(root: string, backend?: CredentialBackendContract): CredentialVault {
  const forcedTest = process.env.KFORGE_TEST_BACKEND ? createInMemoryCredentialBackend() : undefined;
  const backendImpl = backend || forcedTest;
  return {
    async availability(): Promise<VaultAvailability> {
      if (backendImpl) {
        const cap = await backend.capability();
        if (cap === "AVAILABLE") return "AVAILABLE";
        if (cap === "ENVIRONMENT_ONLY") return "ENVIRONMENT_ONLY";
        return "UNAVAILABLE";
      }
      if (await dpapiRoundTrip()) return "AVAILABLE";
      if (process.platform === "win32") return "UNAVAILABLE";
      return "ENVIRONMENT_ONLY";
    },
    async backend(): Promise<CredentialBackend | "NONE"> {
      if (backendImpl) {
        if (backendImpl.kind === "in-memory") return "EPHEMERAL";
        if (backendImpl.kind === "windows-dpapi") return "OS_DPAPI";
        if (backendImpl.kind === "ephemeral") return "EPHEMERAL";
        return "ENVIRONMENT";
      }
      const availability = await this.availability();
      if (availability === "AVAILABLE") return "OS_DPAPI";
      if (availability === "ENVIRONMENT_ONLY") return "ENVIRONMENT";
      return "NONE";
    },
    async set(providerId: string, secret: string): Promise<void> {
      if (!validId(providerId)) throw new Error("Invalid credential identifier.");
      if (!secret.trim() || secret.trim().length < 8) throw new Error("Replacement key must include at least 8 characters.");
      if (backendImpl) {
        await backendImpl.store(providerId, secret.trim());
        const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
        const suffix = secret.trim().slice(-4);
        meta.entries[providerId] = { backend: "EPHEMERAL", updatedAt: new Date().toISOString(), suffix };
        await writeJson(metaPath(root), meta);
        return;
      }
      const availability = await this.availability();
      const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
      const suffix = secret.trim().slice(-4);
      if (availability === "AVAILABLE") {
        const blob = await dpapiProtect(secret.trim());
        const file = await readJson<DpapiBlobFile>(dpapiPath(root), { version: 1, blobs: {} });
        file.blobs[providerId] = blob;
        await writeJson(dpapiPath(root), file);
        meta.entries[providerId] = { backend: "OS_DPAPI", updatedAt: new Date().toISOString(), suffix };
        await writeJson(metaPath(root), meta);
        return;
      }
      if (availability === "ENVIRONMENT_ONLY") {
        ephemeralMap(root).set(providerId, secret.trim());
        meta.entries[providerId] = { backend: "EPHEMERAL", updatedAt: new Date().toISOString(), suffix };
        await writeJson(metaPath(root), meta);
        return;
      }
      throw new Error("OS credential protection is UNAVAILABLE on this host; refusing plaintext fallback. Configure an environment credential instead.");
    },
    async has(providerId: string): Promise<boolean> {
      if (!validId(providerId)) return false;
      if (backendImpl) return await backendImpl.exists(providerId);
      const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
      if (meta.entries[providerId]) return true;
      return Boolean(environmentSecret(providerId));
    },
    async reveal(providerId: string): Promise<string | null> {
      if (!validId(providerId)) return null;
      if (backendImpl) return await backendImpl.read(providerId);
      const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
      const entry = meta.entries[providerId];
      if (entry?.backend === "OS_DPAPI") {
        const file = await readJson<DpapiBlobFile>(dpapiPath(root), { version: 1, blobs: {} });
        const blob = file.blobs[providerId];
        if (!blob) return environmentSecret(providerId) || null;
        return dpapiUnprotect(blob);
      }
      if (entry?.backend === "EPHEMERAL") {
        return ephemeralMap(root).get(providerId) || null;
      }
      return environmentSecret(providerId) || null;
    },
    async delete(providerId: string): Promise<void> {
      if (!validId(providerId)) throw new Error("Invalid credential identifier.");
      if (backendImpl) {
        await backendImpl.delete(providerId);
        const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
        delete meta.entries[providerId];
        await writeJson(metaPath(root), meta);
        return;
      }
      const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
      delete meta.entries[providerId];
      await writeJson(metaPath(root), meta);
      const file = await readJson<DpapiBlobFile>(dpapiPath(root), { version: 1, blobs: {} });
      if (file.blobs[providerId]) {
        delete file.blobs[providerId];
        await writeJson(dpapiPath(root), file);
      }
      ephemeralMap(root).delete(providerId);
    },
    async source(providerId: string): Promise<"OS_VAULT" | "ENVIRONMENT" | "EPHEMERAL" | "NONE"> {
      if (backendImpl) {
        const exists = await backendImpl.exists(providerId);
        if (exists) return backendImpl.kind === "in-memory" ? "EPHEMERAL" : (backendImpl.kind === "windows-dpapi" ? "OS_VAULT" : "ENVIRONMENT");
        return "NONE";
      }
      const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
      const entry = meta.entries[providerId];
      if (entry?.backend === "OS_DPAPI") return "OS_VAULT";
      if (entry?.backend === "EPHEMERAL" && ephemeralMap(root).has(providerId)) return "EPHEMERAL";
      if (environmentSecret(providerId)) return "ENVIRONMENT";
      return "NONE";
    },
  };
}

export async function migrateLegacyPlaintextSecrets(root: string): Promise<{ outcome: MigrationOutcome; migrated: number; detail: string }> {
  const legacy = legacyPath(root);
  let raw: string;
  try {
    raw = await fs.readFile(legacy, "utf8");
  } catch {
    return { outcome: "NOT_REQUIRED", migrated: 0, detail: "No legacy plaintext secret file exists." };
  }
  let values: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = typeof parsed === "object" && parsed !== null ? (parsed as { values?: unknown }) : null;
    if (!record || typeof record.values !== "object" || record.values === null) {
      return { outcome: "NOT_REQUIRED", migrated: 0, detail: "Legacy file has no credential values." };
    }
    values = Object.fromEntries(
      Object.entries(record.values as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return { outcome: "MIGRATION_FAILED", migrated: 0, detail: "Legacy file is not valid JSON; left untouched for manual inspection." };
  }
  const ids = Object.keys(values).filter(validId);
  if (ids.length === 0) {
    await secureRemove(legacy);
    return { outcome: "MIGRATION_SUCCESS", migrated: 0, detail: "Legacy file held no valid entries; removed." };
  }
  const vault = createCredentialVault(root);
  const availability = await vault.availability();
  if (availability !== "AVAILABLE" && availability !== "ENVIRONMENT_ONLY") {
    return { outcome: "MIGRATION_FAILED", migrated: 0, detail: "OS vault UNAVAILABLE; refusing to migrate into plaintext. Configure environment credentials." };
  }
  let migrated = 0;
  for (const id of ids) {
    const secret = values[id];
    if (!secret || secret.length < 8) continue;
    try {
      await vault.set(id, secret);
      const check = await vault.reveal(id);
      if (check !== secret) throw new Error("retrieval mismatch");
      migrated += 1;
    } catch {
      return { outcome: "MIGRATION_FAILED", migrated, detail: `Migration stopped at entry ${migrated + 1}; legacy file preserved.` };
    }
  }
  await secureRemove(legacy);
  return { outcome: "MIGRATION_SUCCESS", migrated, detail: `Migrated ${migrated} credential(s) into ${availability === "AVAILABLE" ? "OS_DPAPI" : "EPHEMERAL"} vault; legacy plaintext file removed.` };
}

async function secureRemove(target: string) {
  try {
    const stat = await fs.stat(target);
    const size = Math.min(stat.size, 1_048_576);
    await fs.writeFile(target, Buffer.alloc(size, 0));
  } catch {
    /* best-effort overwrite before unlink */
  }
  await fs.rm(target, { force: true });
}

export function legacySecretPath(root: string) {
  return legacyPath(root);
}

const inMemoryStore = new Map<string, string>();

export function createInMemoryCredentialBackend(): CredentialBackendContract {
  return {
    kind: "in-memory",
    async store(providerId: string, secret: string) {
      inMemoryStore.set(providerId, secret.trim());
    },
    async read(providerId: string) {
      return inMemoryStore.get(providerId) || null;
    },
    async delete(providerId: string) {
      inMemoryStore.delete(providerId);
    },
    async exists(providerId: string) {
      return inMemoryStore.has(providerId);
    },
    async capability() {
      return "AVAILABLE";
    },
  };
}

export interface CredentialDisplay {
  configured: boolean;
  source: "OS_VAULT" | "ENVIRONMENT" | "EPHEMERAL" | "NONE";
  backend: CredentialBackend | "NONE";
  suffix: string | null;
  updatedAt: string | null;
}

export async function credentialDisplay(root: string, providerId: string): Promise<CredentialDisplay> {
  const vault = createCredentialVault(root);
  const source = await vault.source(providerId);
  const meta = await readJson<VaultMeta>(metaPath(root), { entries: {} });
  const entry = meta.entries[providerId];
  return {
    configured: source !== "NONE",
    source,
    backend: entry?.backend || (source === "ENVIRONMENT" ? "ENVIRONMENT" : "NONE"),
    suffix: entry?.suffix || null,
    updatedAt: entry?.updatedAt || null,
  };
}

export function maskWithSuffix(suffix: string | null): string | null {
  if (!suffix) return null;
  return `sk-••••••••••••••••••••••••${suffix}`;
}
