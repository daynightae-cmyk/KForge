import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  maskApiKey,
  normalizeModelRecord,
  normalizeProviderError,
  type CanonicalModel,
  type ConnectionTestEvidence,
  type NormalizedErrorKind,
  type ProviderAdapterKind,
  type ProviderSummary,
  type ProviderType,
} from "../../shared/providerCommandCenter";

export interface CustomProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  organization?: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  streaming?: boolean;
}

interface StoredProvider {
  id: string;
  name: string;
  kind: ProviderAdapterKind;
  type: ProviderType;
  baseUrl: string | null;
  organization: string | null;
  customHeaderNames: string[];
  timeoutMs: number;
  streaming: boolean;
  favoriteModel: string | null;
  discoveryState: ProviderSummary["discoveryState"];
  modelsDiscovered: number;
  lastVerifiedAt: string | null;
  lastSuccessfulAuthAt: string | null;
  health: ProviderSummary["health"];
  createdAt: string;
  updatedAt: string;
}

interface SecretStore {
  values: Record<string, string>;
}

interface ProviderFile {
  providers: StoredProvider[];
}

const BUILTIN: Array<{ id: string; name: string; kind: ProviderAdapterKind; type: ProviderType; baseUrl: string | null }> = [
  { id: "openai", name: "OpenAI", kind: "openai", type: "builtin-cloud", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", type: "builtin-cloud", baseUrl: "https://api.anthropic.com/v1" },
  { id: "gemini", name: "Gemini", kind: "gemini", type: "builtin-cloud", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "openrouter", name: "OpenRouter", kind: "openrouter", type: "builtin-cloud", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "ollama", name: "Ollama", kind: "ollama", type: "local", baseUrl: "http://127.0.0.1:11434" },
  { id: "lm-studio", name: "LM Studio", kind: "lm-studio", type: "local", baseUrl: "http://127.0.0.1:1234" },
  { id: "llama-cpp", name: "llama.cpp", kind: "llama-cpp", type: "local", baseUrl: "http://127.0.0.1:8080" },
];

function providersPath(root: string) {
  return path.join(root, ".kforge", "provider-studio.json");
}

function secretsPath(root: string) {
  return path.join(root, ".kforge", "provider-secrets.json");
}

function discoveryPath(root: string, providerId: string) {
  return path.join(root, ".kforge", `provider-models-${providerId}.json`);
}

function sessionsPath(root: string) {
  return path.join(root, ".kforge", "provider-sessions.json");
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
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function secretFor(providerId: string, input?: CustomProviderInput): string {
  if (input?.apiKey?.trim()) return input.apiKey.trim();
  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  const envName = envMap[providerId];
  if (envName && process.env[envName]?.trim()) return process.env[envName].trim();
  return "";
}

async function readSecrets(root: string): Promise<SecretStore> {
  return readJson<SecretStore>(secretsPath(root), { values: {} });
}

export async function listProviderSummaries(root: string): Promise<ProviderSummary[]> {
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const secrets = await readSecrets(root);
  const stored = new Map(file.providers.map((entry) => [entry.id, entry]));
  return BUILTIN.map((builtin): ProviderSummary => {
    const custom = stored.get(builtin.id);
    const secret = secrets.values[builtin.id] || secretFor(builtin.id);
    const hasCredential = Boolean(secret);
    return {
      id: builtin.id,
      name: custom?.name || builtin.name,
      kind: custom?.kind || builtin.kind,
      type: custom?.type || builtin.type,
      baseUrl: custom?.baseUrl ?? builtin.baseUrl,
      authState: hasCredential ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialState: hasCredential ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialSource: secrets.values[builtin.id] ? "provider-secret-store" : hasCredential ? "server-environment" : "none",
      modelsDiscovered: custom?.modelsDiscovered ?? 0,
      favoriteModel: custom?.favoriteModel ?? null,
      health: custom?.health ?? (hasCredential ? "NOT_EVALUATED" : "NOT_CONFIGURED"),
      lastVerifiedAt: custom?.lastVerifiedAt ?? null,
      lastSuccessfulAuthAt: custom?.lastSuccessfulAuthAt ?? null,
      maskedKey: hasCredential ? maskApiKey(secret) : null,
      discoveryState: custom?.discoveryState ?? "NEVER_RUN",
      customHeaders: custom?.customHeaderNames ?? [],
      streaming: custom ? (custom.streaming ? "SUPPORTED" : "UNSUPPORTED") : "UNKNOWN",
      timeoutMs: custom?.timeoutMs ?? 30_000,
    };
  }).concat(
    file.providers
      .filter((entry) => !BUILTIN.some((builtin) => builtin.id === entry.id))
      .map((entry) => {
        const secret = secrets.values[entry.id] || "";
        return {
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          type: entry.type,
          baseUrl: entry.baseUrl,
          authState: secret ? "CONFIGURED" as const : "NOT_CONFIGURED" as const,
          credentialState: secret ? "CONFIGURED" as const : "NOT_CONFIGURED" as const,
          credentialSource: secret ? ("provider-secret-store" as const) : ("none" as const),
          modelsDiscovered: entry.modelsDiscovered,
          favoriteModel: entry.favoriteModel,
          health: entry.health,
          lastVerifiedAt: entry.lastVerifiedAt,
          lastSuccessfulAuthAt: entry.lastSuccessfulAuthAt,
          maskedKey: secret ? maskApiKey(secret) : null,
          discoveryState: entry.discoveryState,
          customHeaders: entry.customHeaderNames,
          streaming: entry.streaming ? "SUPPORTED" as const : "UNSUPPORTED" as const,
          timeoutMs: entry.timeoutMs,
        };
      }),
  );
}

function validateCustomInput(input: CustomProviderInput): string | null {
  if (!input.name.trim()) return "Provider name is required.";
  if (!/^https?:\/\/.+/i.test(input.baseUrl.trim())) return "Base URL must be an http(s) URL.";
  try {
    const parsed = new URL(input.baseUrl.trim());
    if (parsed.username || parsed.password) return "Base URL must not embed credentials.";
  } catch {
    return "Base URL is not a valid URL.";
  }
  if (!input.apiKey.trim() || input.apiKey.trim().length < 8) return "API key must include at least 8 characters.";
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 120_000)) {
    return "Timeout must be between 1000 and 120000 ms.";
  }
  return null;
}

export async function upsertCustomProvider(root: string, input: CustomProviderInput, fetcher: typeof fetch = fetch): Promise<{ provider: ProviderSummary; verified: boolean }> {
  void fetcher;
  const error = validateCustomInput(input);
  if (error) throw new Error(error);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const secrets = await readSecrets(root);
  const id = `custom-${Buffer.from(input.name.trim().toLowerCase()).toString("base64url").slice(0, 16)}-${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const stored: StoredProvider = {
    id,
    name: input.name.trim().slice(0, 80),
    kind: "openai-compatible",
    type: "custom",
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    organization: input.organization?.trim() ? input.organization.trim().slice(0, 120) : null,
    customHeaderNames: Object.keys(input.customHeaders || {}).slice(0, 12),
    timeoutMs: input.timeoutMs ?? 30_000,
    streaming: input.streaming ?? true,
    favoriteModel: null,
    discoveryState: "NEVER_RUN",
    modelsDiscovered: 0,
    lastVerifiedAt: null,
    lastSuccessfulAuthAt: null,
    health: "NOT_EVALUATED",
    createdAt: now,
    updatedAt: now,
  };
  file.providers = [...file.providers.filter((entry) => entry.id !== id), stored];
  secrets.values[id] = input.apiKey.trim();
  await writeJson(providersPath(root), file);
  await writeJson(secretsPath(root), secrets);
  const summaries = await listProviderSummaries(root);
  const provider = summaries.find((entry) => entry.id === id);
  if (!provider) throw new Error("Provider registration failed.");
  return { provider, verified: false };
}

export async function replaceProviderKey(root: string, providerId: string, apiKey: string): Promise<ProviderSummary> {
  if (!apiKey.trim() || apiKey.trim().length < 8) throw new Error("Replacement key must include at least 8 characters.");
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const secrets = await readSecrets(root);
  const known = BUILTIN.some((entry) => entry.id === providerId) || file.providers.some((entry) => entry.id === providerId);
  if (!known) throw new Error("Unknown provider.");
  secrets.values[providerId] = apiKey.trim();
  if (!file.providers.some((entry) => entry.id === providerId)) {
    const builtin = BUILTIN.find((entry) => entry.id === providerId);
    if (builtin) {
      const now = new Date().toISOString();
      file.providers.push({
        id: providerId,
        name: builtin.name,
        kind: builtin.kind,
        type: builtin.type,
        baseUrl: builtin.baseUrl,
        organization: null,
        customHeaderNames: [],
        timeoutMs: 30_000,
        streaming: true,
        favoriteModel: null,
        discoveryState: "NEVER_RUN",
        modelsDiscovered: 0,
        lastVerifiedAt: now,
        lastSuccessfulAuthAt: null,
        health: "NOT_EVALUATED",
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    file.providers = file.providers.map((entry) => entry.id === providerId ? { ...entry, updatedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() } : entry);
  }
  await writeJson(providersPath(root), file);
  await writeJson(secretsPath(root), secrets);
  const summaries = await listProviderSummaries(root);
  const next = summaries.find((entry) => entry.id === providerId);
  if (!next) throw new Error("Credential replacement failed.");
  return next;
}

export async function revealProviderKey(root: string, providerId: string, confirmed: boolean): Promise<{ masked: string; value?: string }> {
  if (confirmed !== true) throw new Error("Full key reveal requires explicit confirmation.");
  const secrets = await readSecrets(root);
  const fromStore = secrets.values[providerId];
  const fromEnv = secretFor(providerId);
  const value = fromStore || fromEnv;
  if (!value) throw new Error("NOT_CONFIGURED: no credential is stored for this provider.");
  return { masked: maskApiKey(value), value };
}

export function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

export async function discoverProviderModels(root: string, providerId: string, fetcher: typeof fetch = fetch): Promise<{ models: CanonicalModel[]; discoveryState: ProviderSummary["discoveryState"] }> {
  const summaries = await listProviderSummaries(root);
  const provider = summaries.find((entry) => entry.id === providerId);
  if (!provider) throw new Error("Unknown provider.");
  if (!provider.baseUrl) throw new Error("Provider has no models endpoint.");
  const secrets = await readSecrets(root);
  const credential = secrets.values[providerId] || secretFor(providerId);
  if (!credential) throw new Error("NOT_CONFIGURED: add a credential before discovery.");
  const started = Date.now();
  const timeoutMs = Math.min(30_000, Math.max(2_000, provider.timeoutMs));
  let response: Response;
  try {
    response = await fetcher(modelsEndpoint(provider.baseUrl), {
      headers: { Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    await markDiscovery(root, providerId, "FAILED", 0, false);
    const detail = error instanceof Error ? error.message : "Discovery request failed.";
    const err = new Error(`NETWORK_ERROR: ${detail}`) as Error & { errorKind: NormalizedErrorKind };
    err.errorKind = normalizeProviderError(null, detail);
    throw err;
  }
  if (!response.ok) {
    await markDiscovery(root, providerId, "FAILED", 0, false);
    const detail = `Discovery failed with HTTP ${response.status}.`;
    const err = new Error(detail) as Error & { errorKind: NormalizedErrorKind; httpStatus: number };
    err.errorKind = normalizeProviderError(response.status, detail);
    err.httpStatus = response.status;
    throw err;
  }
  const payload = (await response.json()) as { data?: unknown[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const nowIso = new Date().toISOString();
  const models = rows
    .filter((row) => typeof row === "object" && row !== null)
    .map((row) => normalizeModelRecord(providerId, row, nowIso));
  await writeJson(discoveryPath(root, providerId), { models, discoveredAt: nowIso, durationMs: Date.now() - started });
  await markDiscovery(root, providerId, models.length ? "SUCCEEDED" : "PARTIAL", models.length, true);
  return { models, discoveryState: models.length ? "SUCCEEDED" : "PARTIAL" };
}

async function markDiscovery(root: string, providerId: string, state: ProviderSummary["discoveryState"], count: number, authOk: boolean) {
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const now = new Date().toISOString();
  const builtin = BUILTIN.find((entry) => entry.id === providerId);
  const existing = file.providers.find((entry) => entry.id === providerId);
  if (existing) {
    file.providers = file.providers.map((entry) => entry.id === providerId ? {
      ...entry,
      discoveryState: state,
      modelsDiscovered: count,
      lastVerifiedAt: now,
      lastSuccessfulAuthAt: authOk ? now : entry.lastSuccessfulAuthAt,
      health: state === "SUCCEEDED" ? "HEALTHY" : state === "PARTIAL" ? "DEGRADED" : "UNREACHABLE",
      updatedAt: now,
    } : entry);
  } else if (builtin) {
    file.providers.push({
      id: providerId,
      name: builtin.name,
      kind: builtin.kind,
      type: builtin.type,
      baseUrl: builtin.baseUrl,
      organization: null,
      customHeaderNames: [],
      timeoutMs: 30_000,
      streaming: true,
      favoriteModel: null,
      discoveryState: state,
      modelsDiscovered: count,
      lastVerifiedAt: now,
      lastSuccessfulAuthAt: authOk ? now : null,
      health: state === "SUCCEEDED" ? "HEALTHY" : state === "PARTIAL" ? "DEGRADED" : "UNREACHABLE",
      createdAt: now,
      updatedAt: now,
    });
  }
  await writeJson(providersPath(root), file);
}

export async function listDiscoveredModels(root: string, providerId: string): Promise<CanonicalModel[]> {
  const data = await readJson<{ models: CanonicalModel[] }>(discoveryPath(root, providerId), { models: [] });
  return data.models;
}

export async function testProviderConnection(
  root: string,
  providerId: string,
  kind: ConnectionTestEvidence["kind"] = "connection",
  modelId: string | null = null,
  fetcher: typeof fetch = fetch,
): Promise<ConnectionTestEvidence> {
  const summaries = await listProviderSummaries(root);
  const provider = summaries.find((entry) => entry.id === providerId);
  if (!provider) throw new Error("Unknown provider.");
  if (!provider.baseUrl) throw new Error("Provider has no testable endpoint.");
  const secrets = await readSecrets(root);
  const credential = secrets.values[providerId] || secretFor(providerId);
  if (!credential) throw new Error("NOT_CONFIGURED: add a credential before testing.");
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const response = await fetcher(modelsEndpoint(provider.baseUrl), {
      headers: { Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(10_000),
    });
    const finishedAt = new Date().toISOString();
    const ok = response.ok;
    await markDiscovery(root, providerId, ok ? provider.discoveryState : "FAILED", provider.modelsDiscovered, ok);
    return {
      providerId,
      modelId,
      kind,
      startedAt,
      finishedAt,
      latencyMs: Date.now() - started,
      httpStatus: response.status,
      ok,
      streamingOutcome: "NOT_TESTED",
      toolOutcome: kind === "tools" ? (ok ? "UNKNOWN" : "UNSUPPORTED") : "NOT_TESTED",
      tokenEvidence: null,
      providerRequestId: response.headers.get("x-request-id"),
      errorKind: ok ? null : normalizeProviderError(response.status, `Connection test failed with HTTP ${response.status}.`),
      errorDetail: ok ? null : `Connection test failed with HTTP ${response.status}. No project code was sent.`,
    };
  } catch (error: unknown) {
    const finishedAt = new Date().toISOString();
    const detail = error instanceof Error ? error.message : "Connection test failed.";
    await markDiscovery(root, providerId, "FAILED", provider.modelsDiscovered, false);
    return {
      providerId,
      modelId,
      kind,
      startedAt,
      finishedAt,
      latencyMs: Date.now() - started,
      httpStatus: null,
      ok: false,
      streamingOutcome: "NOT_TESTED",
      toolOutcome: "NOT_TESTED",
      tokenEvidence: null,
      providerRequestId: null,
      errorKind: normalizeProviderError(null, detail),
      errorDetail: `${detail} No project code was sent.`,
    };
  }
}

export interface ProviderSession {
  id: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  mode: "ASK" | "PLAN" | "IMPLEMENT" | "REVIEW" | "DEBUG" | "TEST" | "REFACTOR" | "SECURITY_AUDIT" | "FULL_MISSION";
  status: "READY" | "PLANNING" | "RUNNING" | "WAITING_FOR_APPROVAL" | "VERIFYING" | "PREVIEWING" | "COMPLETED" | "FAILED" | "CANCELLED" | "ROLLED_BACK";
  task: string;
  contextScope: string;
  createdAt: string;
  updatedAt: string;
  disclosureConfirmed: boolean;
  cloudDisclosure: boolean;
}

export async function createProviderSession(root: string, input: { projectId?: string | null; providerId: string; modelId: string; mode: ProviderSession["mode"]; task: string; contextScope: string; disclosureConfirmed: boolean }): Promise<ProviderSession> {
  const summaries = await listProviderSummaries(root);
  const provider = summaries.find((entry) => entry.id === input.providerId);
  if (!provider) throw new Error("Unknown provider.");
  const isCloud = provider.type !== "local";
  if (isCloud && input.disclosureConfirmed !== true) throw new Error("Cloud disclosure confirmation is required before project content leaves this machine.");
  if (!input.modelId.trim() || !input.task.trim()) throw new Error("Model and task are required.");
  const sessions = await readJson<{ sessions: ProviderSession[] }>(sessionsPath(root), { sessions: [] });
  const now = new Date().toISOString();
  const session: ProviderSession = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    providerId: input.providerId,
    modelId: input.modelId.trim().slice(0, 160),
    mode: input.mode,
    status: "READY",
    task: input.task.trim().slice(0, 2_000),
    contextScope: input.contextScope,
    createdAt: now,
    updatedAt: now,
    disclosureConfirmed: input.disclosureConfirmed,
    cloudDisclosure: isCloud,
  };
  sessions.sessions = [session, ...sessions.sessions].slice(0, 200);
  await writeJson(sessionsPath(root), sessions);
  return session;
}

export async function listProviderSessions(root: string): Promise<ProviderSession[]> {
  return (await readJson<{ sessions: ProviderSession[] }>(sessionsPath(root), { sessions: [] })).sessions;
}
