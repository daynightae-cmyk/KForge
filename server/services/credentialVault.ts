import { promises as fs } from "fs";
import path from "path";
import { execFileSync } from "child_process";

export type CredentialVaultAvailability = "AVAILABLE" | "UNAVAILABLE" | "ENVIRONMENT_ONLY";
export type CredentialVaultBackend = "WINDOWS_DPAPI_CURRENT_USER" | "EPHEMERAL_MEMORY" | "ENVIRONMENT" | "UNAVAILABLE";
export type CredentialSource = "OS_VAULT" | "ENVIRONMENT" | "EPHEMERAL" | "NONE";
export type LegacyMigrationOutcome = "MIGRATION_SUCCESS" | "MIGRATION_FAILED" | "MIGRATION_BLOCKED" | "NOT_REQUIRED";

interface StoredCredentialRecord {
  providerId: string;
  protectedValue: string;
  suffix: string;
  backend: "WINDOWS_DPAPI_CURRENT_USER";
  updatedAt: string;
}

interface VaultFile {
  version: 1;
  credentials: Record<string, StoredCredentialRecord>;
}

interface LegacySecretStore {
  values?: Record<string, unknown>;
}

export interface CredentialDisplay {
  configured: boolean;
  source: CredentialSource;
  backend: CredentialVaultBackend;
  suffix: string | null;
  updatedAt: string | null;
}

export interface LegacyMigrationResult {
  outcome: LegacyMigrationOutcome;
  migrated: number;
  detail: string;
}

export interface CredentialVault {
  availability(): Promise<CredentialVaultAvailability>;
  backend(): Promise<CredentialVaultBackend>;
  set(providerId: string, secret: string): Promise<void>;
  has(providerId: string): Promise<boolean>;
  reveal(providerId: string): Promise<string | null>;
  delete(providerId: string): Promise<void>;
  metadata(providerId: string): Promise<CredentialDisplay>;
}

interface VaultRuntime {
  platform: NodeJS.Platform;
  protect?: (plaintext: string) => string;
  unprotect?: (protectedValue: string) => string;
}

const ephemeralByRoot = new Map<string, Map<string, { value: string; updatedAt: string }>>();

const environmentNames: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function vaultPath(root: string) {
  return path.join(root, ".kforge", "provider-vault.json");
}

export function legacySecretsPath(root: string) {
  return path.join(root, ".kforge", "provider-secrets.json");
}

function normalizeId(providerId: string) {
  const value = providerId.trim();
  if (!value || value.length > 220 || /[\0\r\n]/.test(value)) throw new Error("Invalid credential identifier.");
  return value;
}

function validateSecret(secret: string) {
  const value = secret.trim();
  if (value.length < 8) throw new Error("Credential must include at least 8 characters.");
  if (value.length > 16_384) throw new Error("Credential exceeds the secure-storage size limit.");
  return value;
}

function suffixOf(value: string) {
  return value.length >= 4 ? value.slice(-4) : "";
}

async function readVault(root: string): Promise<VaultFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(vaultPath(root), "utf8")) as Partial<VaultFile>;
    if (parsed.version !== 1 || typeof parsed.credentials !== "object" || parsed.credentials === null) {
      return { version: 1, credentials: {} };
    }
    return { version: 1, credentials: parsed.credentials as Record<string, StoredCredentialRecord> };
  } catch {
    return { version: 1, credentials: {} };
  }
}

async function writeVault(root: string, value: VaultFile) {
  await fs.mkdir(path.dirname(vaultPath(root)), { recursive: true });
  await fs.writeFile(vaultPath(root), `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await fs.chmod(vaultPath(root), 0o600).catch(() => undefined);
}

function powershellBinary() {
  return process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
}

function protectWithDpapi(plaintext: string) {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$plain = [Console]::In.ReadToEnd()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($plain)",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($protected)",
  ].join("; ");
  return execFileSync(powershellBinary(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    input: plaintext,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024,
    timeout: 10_000,
  }).trim();
}

function unprotectWithDpapi(protectedValue: string) {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$encoded = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Convert]::FromBase64String($encoded)",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
  ].join("; ");
  return execFileSync(powershellBinary(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    input: protectedValue,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024,
    timeout: 10_000,
  });
}

function runtimeDefaults(): VaultRuntime {
  return process.platform === "win32"
    ? { platform: process.platform, protect: protectWithDpapi, unprotect: unprotectWithDpapi }
    : { platform: process.platform };
}

export function environmentSecret(providerId: string) {
  const envName = environmentNames[providerId];
  const value = envName ? process.env[envName]?.trim() : "";
  return value || "";
}

function ephemeralStore(root: string) {
  const key = path.resolve(root);
  let store = ephemeralByRoot.get(key);
  if (!store) {
    store = new Map();
    ephemeralByRoot.set(key, store);
  }
  return store;
}

export function createCredentialVault(root: string, runtime: VaultRuntime = runtimeDefaults()): CredentialVault {
  const resolvedRoot = path.resolve(root);
  const dpapiAvailable = runtime.platform === "win32" && typeof runtime.protect === "function" && typeof runtime.unprotect === "function";

  async function storedRecord(providerId: string) {
    const file = await readVault(resolvedRoot);
    return file.credentials[normalizeId(providerId)] || null;
  }

  return {
    async availability() {
      if (dpapiAvailable) return "AVAILABLE";
      return Object.keys(environmentNames).some((id) => Boolean(environmentSecret(id))) ? "ENVIRONMENT_ONLY" : "AVAILABLE";
    },
    async backend() {
      return dpapiAvailable ? "WINDOWS_DPAPI_CURRENT_USER" : "EPHEMERAL_MEMORY";
    },
    async set(providerId, secret) {
      const id = normalizeId(providerId);
      const value = validateSecret(secret);
      if (dpapiAvailable) {
        const protectedValue = runtime.protect!(value);
        if (!protectedValue || protectedValue.includes(value)) throw new Error("Credential protection did not produce a valid protected payload.");
        const file = await readVault(resolvedRoot);
        file.credentials[id] = {
          providerId: id,
          protectedValue,
          suffix: suffixOf(value),
          backend: "WINDOWS_DPAPI_CURRENT_USER",
          updatedAt: new Date().toISOString(),
        };
        await writeVault(resolvedRoot, file);
        const roundTrip = await this.reveal(id);
        if (roundTrip !== value) throw new Error("Credential vault verification failed after write.");
        return;
      }
      ephemeralStore(resolvedRoot).set(id, { value, updatedAt: new Date().toISOString() });
    },
    async has(providerId) {
      const id = normalizeId(providerId);
      if (environmentSecret(id)) return true;
      if (dpapiAvailable && await storedRecord(id)) return true;
      return ephemeralStore(resolvedRoot).has(id);
    },
    async reveal(providerId) {
      const id = normalizeId(providerId);
      const record = dpapiAvailable ? await storedRecord(id) : null;
      if (record) {
        try {
          return runtime.unprotect!(record.protectedValue);
        } catch {
          throw new Error("OS credential decryption failed for the current Windows user.");
        }
      }
      const ephemeral = ephemeralStore(resolvedRoot).get(id)?.value;
      if (ephemeral) return ephemeral;
      return environmentSecret(id) || null;
    },
    async delete(providerId) {
      const id = normalizeId(providerId);
      ephemeralStore(resolvedRoot).delete(id);
      if (dpapiAvailable) {
        const file = await readVault(resolvedRoot);
        if (file.credentials[id]) {
          delete file.credentials[id];
          await writeVault(resolvedRoot, file);
        }
      }
    },
    async metadata(providerId) {
      const id = normalizeId(providerId);
      const record = dpapiAvailable ? await storedRecord(id) : null;
      if (record) return { configured: true, source: "OS_VAULT", backend: "WINDOWS_DPAPI_CURRENT_USER", suffix: record.suffix || null, updatedAt: record.updatedAt };
      const ephemeral = ephemeralStore(resolvedRoot).get(id);
      if (ephemeral) return { configured: true, source: "EPHEMERAL", backend: "EPHEMERAL_MEMORY", suffix: suffixOf(ephemeral.value), updatedAt: ephemeral.updatedAt };
      const env = environmentSecret(id);
      if (env) return { configured: true, source: "ENVIRONMENT", backend: "ENVIRONMENT", suffix: suffixOf(env), updatedAt: null };
      return { configured: false, source: "NONE", backend: dpapiAvailable ? "WINDOWS_DPAPI_CURRENT_USER" : "EPHEMERAL_MEMORY", suffix: null, updatedAt: null };
    },
  };
}

export async function credentialDisplay(root: string, providerId: string) {
  return createCredentialVault(root).metadata(providerId);
}

export function maskWithSuffix(suffix: string | null) {
  return suffix ? `••••••••••••••••••••••••${suffix}` : null;
}

export async function migrateLegacyPlaintextSecrets(root: string, runtime?: VaultRuntime): Promise<LegacyMigrationResult> {
  const legacyPath = legacySecretsPath(root);
  let legacy: LegacySecretStore;
  try {
    legacy = JSON.parse(await fs.readFile(legacyPath, "utf8")) as LegacySecretStore;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT") {
      return { outcome: "NOT_REQUIRED", migrated: 0, detail: "No legacy plaintext provider secret file exists." };
    }
    return { outcome: "MIGRATION_FAILED", migrated: 0, detail: "Legacy credential file could not be parsed safely." };
  }

  const values = Object.entries(legacy.values || {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length >= 8);
  if (values.length === 0) {
    await fs.rm(legacyPath, { force: true });
    return { outcome: "NOT_REQUIRED", migrated: 0, detail: "Legacy credential file contained no migratable credential values and was removed." };
  }

  const vault = createCredentialVault(root, runtime || runtimeDefaults());
  if (await vault.backend() !== "WINDOWS_DPAPI_CURRENT_USER" && !runtime?.protect) {
    return { outcome: "MIGRATION_BLOCKED", migrated: 0, detail: "Legacy plaintext credentials remain in place until Windows OS-protected storage is available. No plaintext fallback was created." };
  }

  let migrated = 0;
  try {
    for (const [providerId, secret] of values) {
      await vault.set(providerId, secret);
      const verified = await vault.reveal(providerId);
      if (verified !== secret.trim()) throw new Error("Protected credential round-trip verification failed.");
      migrated += 1;
    }
    await fs.rm(legacyPath, { force: true });
    return { outcome: "MIGRATION_SUCCESS", migrated, detail: `Migrated ${migrated} credential(s) into OS-protected storage and removed the legacy plaintext file.` };
  } catch {
    return { outcome: "MIGRATION_FAILED", migrated, detail: "Credential migration failed before the legacy plaintext source could be removed." };
  }
}

export function __clearEphemeralCredentialVaultForTests(root?: string) {
  if (root) ephemeralByRoot.delete(path.resolve(root));
  else ephemeralByRoot.clear();
}
