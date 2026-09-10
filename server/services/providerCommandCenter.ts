import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  CanonicalModel,
  ConnectionTestEvidence,
  ProviderAdapterKind,
  ProviderSessionSummary,
  ProviderSummary,
  ProviderType,
} from "../../shared/providerCommandCenter";
import { createCredentialVault, credentialDisplay, maskWithSuffix, migrateLegacyPlaintextSecrets } from "./credentialVault";
import { getAdapter, type AdapterContext } from "./providerAdapters";

export interface CustomProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  organization?: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  streaming?: boolean;
  modelsEndpoint?: string;
  chatEndpoint?: string;
}

interface StoredProvider {
  id: string;
  name: string;
  kind: ProviderAdapterKind;
  type: ProviderType;
  baseUrl: string | null;
  organization: string | null;
  customHeaderNames: string[];
  modelsEndpointOverride: string | null;
  chatEndpointOverride: string | null;
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

interface ProviderFile {
  providers: StoredProvider[];
}

interface DiscoveryFile {
  models: CanonicalModel[];
  discoveredAt: string;
  durationMs?: number;
  source?: string;
}

const BUILTIN: Array<{ id: string; name: string; kind: ProviderAdapterKind; type: ProviderType; baseUrl: string }> = [
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

async function ensureMigrated(root: string) {
  try {
    return await migrateLegacyPlaintextSecrets(root);
  } catch {
    return { outcome: "MIGRATION_FAILED" as const, migrated: 0, detail: "Legacy secret migration could not be completed." };
  }
}

function vaultSourceLabel(source: "OS_VAULT" | "ENVIRONMENT" | "EPHEMERAL" | "NONE"): ProviderSummary["credentialSource"] {
  if (source === "OS_VAULT") return "os-vault";
  if (source === "ENVIRONMENT") return "server-environment";
  if (source === "EPHEMERAL") return "ephemeral-memory";
  return "none";
}

function defaultStoredProvider(source: { id: string; name: string; kind: ProviderAdapterKind; type: ProviderType; baseUrl: string }): StoredProvider {
  const now = new Date().toISOString();
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    type: source.type,
    baseUrl: source.baseUrl,
    organization: null,
    customHeaderNames: [],
    modelsEndpointOverride: null,
    chatEndpointOverride: null,
    timeoutMs: 30_000,
    streaming: true,
    favoriteModel: null,
    discoveryState: "NEVER_RUN",
    modelsDiscovered: 0,
    lastVerifiedAt: null,
    lastSuccessfulAuthAt: null,
    health: "NOT_EVALUATED",
    createdAt: now,
    updatedAt: now,
  };
}

export async function credentialStatus(root: string, providerId: string) {
  await ensureMigrated(root);
  return credentialDisplay(root, providerId);
}

export async function listProviderSummaries(root: string): Promise<ProviderSummary[]> {
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const stored = new Map(file.providers.map((entry) => [entry.id, entry]));
  const result: ProviderSummary[] = [];
  for (const builtin of BUILTIN) {
    const config = stored.get(builtin.id);
    const display = await credentialDisplay(root, builtin.id);
    const noCredentialRequired = builtin.type === "local";
    result.push({
      id: builtin.id,
      name: config?.name || builtin.name,
      kind: config?.kind || builtin.kind,
      type: config?.type || builtin.type,
      baseUrl: config?.baseUrl ?? builtin.baseUrl,
      authState: display.configured || noCredentialRequired ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialState: display.configured ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialSource: vaultSourceLabel(display.source),
      modelsDiscovered: config?.modelsDiscovered ?? 0,
      favoriteModel: config?.favoriteModel ?? null,
      health: config?.health ?? (display.configured || noCredentialRequired ? "NOT_EVALUATED" : "NOT_CONFIGURED"),
      lastVerifiedAt: config?.lastVerifiedAt ?? null,
      lastSuccessfulAuthAt: config?.lastSuccessfulAuthAt ?? null,
      maskedKey: display.configured ? maskWithSuffix(display.suffix) : null,
      discoveryState: config?.discoveryState ?? "NEVER_RUN",
      customHeaders: config?.customHeaderNames ?? [],
      streaming: config ? (config.streaming ? "SUPPORTED" : "UNSUPPORTED") : "UNKNOWN",
      timeoutMs: config?.timeoutMs ?? 30_000,
    });
  }
  for (const config of file.providers.filter((entry) => !BUILTIN.some((builtin) => builtin.id === entry.id))) {
    const display = await credentialDisplay(root, config.id);
    result.push({
      id: config.id,
      name: config.name,
      kind: config.kind,
      type: config.type,
      baseUrl: config.baseUrl,
      authState: display.configured ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialState: display.configured ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialSource: vaultSourceLabel(display.source),
      modelsDiscovered: config.modelsDiscovered,
      favoriteModel: config.favoriteModel,
      health: config.health,
      lastVerifiedAt: config.lastVerifiedAt,
      lastSuccessfulAuthAt: config.lastSuccessfulAuthAt,
      maskedKey: display.configured ? maskWithSuffix(display.suffix) : null,
      discoveryState: config.discoveryState,
      customHeaders: config.customHeaderNames,
      streaming: config.streaming ? "SUPPORTED" : "UNSUPPORTED",
      timeoutMs: config.timeoutMs,
    });
  }
  return result;
}

export function headerVaultKey(providerId: string, headerName: string) {
  return `headers.${providerId}.${headerName.trim().toLowerCase()}`;
}

export async function customHeadersFor(root: string, providerId: string, names: string[]) {
  const vault = createCredentialVault(root);
  const headers: Record<string, string> = {};
  for (const name of names) {
    const value = await vault.reveal(headerVaultKey(providerId, name));
    if (value) headers[name] = value;
  }
  return headers;
}

function validateHttpUrl(value: string, label: string) {
  if (!/^https?:\/\//i.test(value)) return `${label} must be an http(s) URL.`;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return `${label} must not embed credentials.`;
    return null;
  } catch {
    return `${label} is not a valid URL.`;
  }
}

function validateCustomInput(input: CustomProviderInput) {
  if (!input.name.trim()) return "Provider name is required.";
  const baseError = validateHttpUrl(input.baseUrl.trim(), "Base URL");
  if (baseError) return baseError;
  if (!input.apiKey.trim() || input.apiKey.trim().length < 8) return "API key must include at least 8 characters.";
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1_000 || input.timeoutMs > 120_000)) return "Timeout must be between 1000 and 120000 ms.";
  for (const [label, value] of [["Models endpoint", input.modelsEndpoint], ["Generation endpoint", input.chatEndpoint]] as const) {
    if (!value?.trim()) continue;
    const error = validateHttpUrl(value.trim(), label);
    if (error) return error;
  }
  if (Object.keys(input.customHeaders || {}).length > 12) return "At most 12 protected custom headers are allowed.";
  return null;
}

export async function upsertCustomProvider(root: string, input: CustomProviderInput, _fetcher: typeof fetch = fetch): Promise<{ provider: ProviderSummary; verified: boolean }> {
  const error = validateCustomInput(input);
  if (error) throw new Error(error);
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const vault = createCredentialVault(root);
  const id = `custom-${Buffer.from(input.name.trim().toLowerCase()).toString("base64url").slice(0, 16)}-${randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const customHeaderNames = Object.keys(input.customHeaders || {}).map((name) => name.trim()).filter(Boolean).slice(0, 12);
  const stored: StoredProvider = {
    id,
    name: input.name.trim().slice(0, 80),
    kind: "openai-compatible",
    type: "custom",
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    organization: input.organization?.trim() ? input.organization.trim().slice(0, 120) : null,
    customHeaderNames,
    modelsEndpointOverride: input.modelsEndpoint?.trim() || null,
    chatEndpointOverride: input.chatEndpoint?.trim() || null,
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
  await vault.set(id, input.apiKey.trim());
  for (const [name, value] of Object.entries(input.customHeaders || {})) {
    if (typeof value === "string" && value.trim()) await vault.set(headerVaultKey(id, name), value.trim());
  }
  file.providers = [...file.providers.filter((entry) => entry.id !== id), stored];
  await writeJson(providersPath(root), file);
  const provider = (await listProviderSummaries(root)).find((entry) => entry.id === id);
  if (!provider) throw new Error("Provider registration failed.");
  return { provider, verified: false };
}

async function ensureProviderMetadata(root: string, providerId: string) {
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const existing = file.providers.find((entry) => entry.id === providerId);
  if (existing) return { file, existing };
  const builtin = BUILTIN.find((entry) => entry.id === providerId);
  if (!builtin) throw new Error("Unknown provider.");
  const created = defaultStoredProvider(builtin);
  file.providers.push(created);
  return { file, existing: created };
}

export async function replaceProviderKey(root: string, providerId: string, apiKey: string): Promise<ProviderSummary> {
  if (!apiKey.trim() || apiKey.trim().length < 8) throw new Error("Replacement key must include at least 8 characters.");
  await ensureMigrated(root);
  const { file } = await ensureProviderMetadata(root, providerId);
  await createCredentialVault(root).set(providerId, apiKey.trim());
  const now = new Date().toISOString();
  file.providers = file.providers.map((entry) => entry.id === providerId ? { ...entry, updatedAt: now, health: "NOT_EVALUATED", lastVerifiedAt: null } : entry);
  await writeJson(providersPath(root), file);
  const next = (await listProviderSummaries(root)).find((entry) => entry.id === providerId);
  if (!next) throw new Error("Credential replacement failed.");
  return next;
}

export async function deleteProviderKey(root: string, providerId: string, confirmed: boolean): Promise<ProviderSummary> {
  if (confirmed !== true) throw new Error("Deleting a credential is destructive and requires explicit confirmation.");
  await ensureMigrated(root);
  const { file, existing } = await ensureProviderMetadata(root, providerId);
  const vault = createCredentialVault(root);
  await vault.delete(providerId);
  for (const name of existing.customHeaderNames) await vault.delete(headerVaultKey(providerId, name));
  file.providers = file.providers.map((entry) => entry.id === providerId ? { ...entry, health: entry.type === "local" ? "NOT_EVALUATED" : "NOT_CONFIGURED", lastVerifiedAt: null, lastSuccessfulAuthAt: null, updatedAt: new Date().toISOString() } : entry);
  await writeJson(providersPath(root), file);
  const next = (await listProviderSummaries(root)).find((entry) => entry.id === providerId);
  if (!next) throw new Error("Unknown provider.");
  return next;
}

export async function revealProviderKey(root: string, providerId: string, confirmed: boolean): Promise<{ masked: string; value?: string; expiresInMs: number }> {
  if (confirmed !== true) throw new Error("Full key reveal requires explicit confirmation.");
  await ensureMigrated(root);
  const value = await createCredentialVault(root).reveal(providerId);
  if (!value) throw new Error("NOT_CONFIGURED: no credential is stored for this provider.");
  return { masked: maskWithSuffix(value.slice(-4)) || "••••••••", value, expiresInMs: 15_000 };
}

export async function providerAdapterContext(root: string, providerId: string): Promise<{ ctx: AdapterContext; kind: ProviderAdapterKind; type: ProviderType; provider: ProviderSummary }> {
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const stored = file.providers.find((entry) => entry.id === providerId);
  const builtin = BUILTIN.find((entry) => entry.id === providerId);
  if (!stored && !builtin) throw new Error("Unknown provider.");
  const provider = (await listProviderSummaries(root)).find((entry) => entry.id === providerId);
  if (!provider) throw new Error("Unknown provider.");
  const kind = stored?.kind || builtin?.kind || "openai-compatible";
  const type = stored?.type || builtin?.type || "custom";
  const baseUrl = stored?.baseUrl || builtin?.baseUrl || "";
  const credential = (await createCredentialVault(root).reveal(providerId)) || "";
  const customHeaders = await customHeadersFor(root, providerId, stored?.customHeaderNames || []);
  return {
    kind,
    type,
    provider,
    ctx: {
      baseUrl,
      credential,
      organization: stored?.organization || null,
      customHeaders,
      timeoutMs: stored?.timeoutMs ?? 30_000,
      modelsEndpointOverride: stored?.modelsEndpointOverride || null,
      chatEndpointOverride: stored?.chatEndpointOverride || null,
    },
  };
}

export interface ProviderRuntimeConfig {
  baseUrl: string;
  kind: ProviderAdapterKind;
  type: ProviderType;
  organization: string | null;
  headerNames: string[];
  timeoutMs: number;
}

export async function providerRuntimeConfig(root: string, providerId: string): Promise<ProviderRuntimeConfig> {
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const stored = file.providers.find((entry) => entry.id === providerId);
  const builtin = BUILTIN.find((entry) => entry.id === providerId);
  if (!stored && !builtin) throw new Error("Unknown provider.");
  return {
    baseUrl: stored?.baseUrl || builtin?.baseUrl || "",
    kind: stored?.kind || builtin?.kind || "openai-compatible",
    type: stored?.type || builtin?.type || "custom",
    organization: stored?.organization || null,
    headerNames: stored?.customHeaderNames || [],
    timeoutMs: stored?.timeoutMs ?? 30_000,
  };
}

async function markDiscovery(root: string, providerId: string, state: ProviderSummary["discoveryState"], count: number, authOk: boolean) {
  const { file, existing } = await ensureProviderMetadata(root, providerId);
  const now = new Date().toISOString();
  file.providers = file.providers.map((entry) => entry.id === existing.id ? {
    ...entry,
    discoveryState: state,
    modelsDiscovered: count,
    lastVerifiedAt: now,
    lastSuccessfulAuthAt: authOk ? now : entry.lastSuccessfulAuthAt,
    health: state === "SUCCEEDED" ? "HEALTHY" : state === "PARTIAL" ? "DEGRADED" : state === "FAILED" ? "UNREACHABLE" : entry.health,
    updatedAt: now,
  } : entry);
  await writeJson(providersPath(root), file);
}

export async function discoverProviderModels(root: string, providerId: string, fetcher: typeof fetch = fetch): Promise<{ models: CanonicalModel[]; discoveryState: ProviderSummary["discoveryState"]; cached: boolean }> {
  const { ctx, kind } = await providerAdapterContext(root, providerId);
  const adapter = getAdapter(kind);
  const validation = await adapter.validateConfiguration(ctx);
  if (!validation.ok) throw new Error(validation.reason);
  const cached = await readJson<DiscoveryFile>(discoveryPath(root, providerId), { models: [], discoveredAt: "" });
  const started = Date.now();
  try {
    const models = (await adapter.listModels(ctx, fetcher)).map((model) => ({ ...model, providerId }));
    const now = new Date().toISOString();
    await writeJson(discoveryPath(root, providerId), { models, discoveredAt: now, durationMs: Date.now() - started, source: kind });
    await markDiscovery(root, providerId, models.length ? "SUCCEEDED" : "PARTIAL", models.length, true);
    return { models, discoveryState: models.length ? "SUCCEEDED" : "PARTIAL", cached: false };
  } catch (error: unknown) {
    await markDiscovery(root, providerId, "FAILED", cached.models.length, false);
    if (cached.models.length) return { models: cached.models, discoveryState: "PARTIAL", cached: true };
    const detail = error instanceof Error ? error.message : "Discovery request failed.";
    const failure = new Error(detail.startsWith("NOT_CONFIGURED") ? detail : `PROVIDER_ERROR: ${detail}`) as Error & { errorKind?: string };
    failure.errorKind = adapter.normalizeError(null, detail);
    throw failure;
  }
}

export async function refreshProviderModels(root: string, providerId: string, fetcher: typeof fetch = fetch) {
  await fs.rm(discoveryPath(root, providerId), { force: true });
  return discoverProviderModels(root, providerId, fetcher);
}

export async function listDiscoveredModels(root: string, providerId: string): Promise<CanonicalModel[]> {
  return (await readJson<DiscoveryFile>(discoveryPath(root, providerId), { models: [], discoveredAt: "" })).models;
}

export async function testProviderConnection(root: string, providerId: string, kind: ConnectionTestEvidence["kind"] = "connection", modelId: string | null = null, fetcher: typeof fetch = fetch): Promise<ConnectionTestEvidence> {
  const { ctx, kind: adapterKind } = await providerAdapterContext(root, providerId);
  const adapter = getAdapter(adapterKind);
  const validation = await adapter.validateConfiguration(ctx);
  if (!validation.ok) throw new Error(validation.reason);
  const summaries = await listProviderSummaries(root);
  const summary = summaries.find((entry) => entry.id === providerId);
  const startedAt = new Date().toISOString();
  const baseEvidence: ConnectionTestEvidence = {
    providerId,
    modelId,
    kind,
    startedAt,
    finishedAt: startedAt,
    latencyMs: 0,
    httpStatus: null,
    ok: false,
    streamingOutcome: "NOT_TESTED",
    toolOutcome: "NOT_TESTED",
    tokenEvidence: null,
    providerRequestId: null,
    errorKind: null,
    errorDetail: null,
  };

  if (kind === "connection") {
    const evidence = await adapter.testConnection(ctx, fetcher);
    await markDiscovery(root, providerId, evidence.ok ? summary?.discoveryState || "NEVER_RUN" : "FAILED", summary?.modelsDiscovered || 0, evidence.ok);
    return { ...baseEvidence, finishedAt: new Date().toISOString(), latencyMs: evidence.latencyMs, httpStatus: evidence.httpStatus, ok: evidence.ok, providerRequestId: evidence.requestId, errorKind: evidence.errorKind, errorDetail: evidence.errorDetail ? `${evidence.errorDetail} No project code was sent.` : null };
  }

  const model = modelId?.trim() || (await listDiscoveredModels(root, providerId))[0]?.id || "";
  if (!model) throw new Error("Select a discovered model before running model, stream or tool tests.");
  if (kind === "model") {
    const evidence = await adapter.testModel(ctx, model, fetcher);
    return {
      ...baseEvidence,
      modelId: model,
      finishedAt: new Date().toISOString(),
      latencyMs: evidence.latencyMs,
      httpStatus: evidence.httpStatus,
      ok: evidence.ok,
      providerRequestId: evidence.requestId,
      errorKind: evidence.errorKind,
      errorDetail: evidence.errorDetail ? `${evidence.errorDetail} No project code was sent.` : null,
      tokenEvidence: evidence.usage.input !== null || evidence.usage.output !== null || evidence.usage.total !== null ? { input: evidence.usage.input, output: evidence.usage.output, total: evidence.usage.total } : null,
    };
  }
  if (kind === "stream") {
    const evidence = await adapter.testStreaming(ctx, model, fetcher);
    return {
      ...baseEvidence,
      modelId: model,
      finishedAt: new Date().toISOString(),
      latencyMs: evidence.latencyMs,
      httpStatus: evidence.httpStatus,
      ok: evidence.ok,
      streamingOutcome: evidence.ok ? "SUPPORTED" : evidence.errorKind ? "FAILED" : evidence.eventCount > 0 ? "UNKNOWN" : "UNSUPPORTED",
      providerRequestId: evidence.requestId,
      errorKind: evidence.errorKind,
      errorDetail: evidence.errorDetail ? `${evidence.errorDetail} No project code was sent. Observed ${evidence.eventCount} streamed event(s), terminal=${evidence.terminalOk}.` : null,
    };
  }
  const evidence = await adapter.testTools(ctx, model, fetcher);
  return {
    ...baseEvidence,
    modelId: model,
    finishedAt: new Date().toISOString(),
    latencyMs: evidence.latencyMs,
    httpStatus: evidence.httpStatus,
    ok: evidence.verdict === "SUPPORTED",
    toolOutcome: evidence.errorKind ? "FAILED" : evidence.verdict,
    errorKind: evidence.errorKind,
    errorDetail: `${evidence.detail} No project code was sent; only the kforge_capability_probe schema was transmitted.`,
  };
}

function emptyTelemetry(): ProviderSessionSummary["telemetry"] {
  return {
    ttftMs: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedTokens: null,
    totalTokens: null,
    costSource: "UNKNOWN",
    estimatedCost: null,
    toolCalls: 0,
    filesChanged: 0,
    testState: null,
    buildState: null,
    previewState: null,
    retries: 0,
    providerRequestId: null,
    finishReason: null,
  };
}

export async function createProviderSession(root: string, input: { projectId?: string | null; providerId: string; modelId: string; mode: ProviderSessionSummary["mode"]; task: string; contextScope: string; disclosureConfirmed: boolean; autonomy?: string }): Promise<ProviderSessionSummary> {
  const provider = (await listProviderSummaries(root)).find((entry) => entry.id === input.providerId);
  if (!provider) throw new Error("Unknown provider.");
  if (!input.modelId.trim() || !input.task.trim()) throw new Error("Model and task are required.");
  const isCloud = provider.type !== "local";
  if (input.projectId && isCloud && input.disclosureConfirmed !== true) throw new Error("Cloud disclosure confirmation is required before project content leaves this machine.");
  const sessions = await readJson<{ sessions: ProviderSessionSummary[] }>(sessionsPath(root), { sessions: [] });
  const now = new Date().toISOString();
  const session: ProviderSessionSummary = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    providerId: provider.id,
    modelId: input.modelId.trim().slice(0, 180),
    mode: input.mode,
    status: "READY",
    task: input.task.trim().slice(0, 4_000),
    contextScope: input.contextScope || "Repository",
    createdAt: now,
    updatedAt: now,
    disclosureConfirmed: input.disclosureConfirmed,
    disclosureDestination: isCloud ? provider.baseUrl : "local runtime",
    cloudDisclosure: isCloud,
    checkpointId: null,
    previewSessionId: null,
    autonomy: input.autonomy || "SAFE IMPLEMENTATION",
    pendingApproval: null,
    telemetry: emptyTelemetry(),
    error: null,
  };
  sessions.sessions = [session, ...sessions.sessions].slice(0, 200);
  await writeJson(sessionsPath(root), sessions);
  return session;
}

export async function listProviderSessions(root: string): Promise<ProviderSessionSummary[]> {
  return (await readJson<{ sessions: ProviderSessionSummary[] }>(sessionsPath(root), { sessions: [] })).sessions;
}

export async function getProviderSession(root: string, sessionId: string): Promise<ProviderSessionSummary | null> {
  return (await listProviderSessions(root)).find((entry) => entry.id === sessionId) || null;
}

export async function updateProviderSession(root: string, sessionId: string, patch: Partial<ProviderSessionSummary>): Promise<ProviderSessionSummary> {
  const store = await readJson<{ sessions: ProviderSessionSummary[] }>(sessionsPath(root), { sessions: [] });
  const existing = store.sessions.find((entry) => entry.id === sessionId);
  if (!existing) throw new Error("Session not found.");
  const next: ProviderSessionSummary = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
  store.sessions = [next, ...store.sessions.filter((entry) => entry.id !== sessionId)].slice(0, 200);
  await writeJson(sessionsPath(root), store);
  return next;
}

export function sessionsFilePath(root: string) {
  return sessionsPath(root);
}

export function providersFilePath(root: string) {
  return providersPath(root);
}
