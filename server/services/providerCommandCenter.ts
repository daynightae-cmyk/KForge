import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  type CanonicalModel,
  type ConnectionTestEvidence,
  type ProviderAdapterKind,
  type ProviderSummary,
  type ProviderType,
} from "../../shared/providerCommandCenter";
import { createCredentialVault, credentialDisplay, environmentSecret, maskWithSuffix, migrateLegacyPlaintextSecrets } from "./credentialVault";
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

export interface CustomHeaderValue {
  name: string;
  protected: true;
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

function vaultSourceLabel(source: "OS_VAULT" | "ENVIRONMENT" | "EPHEMERAL" | "NONE"): ProviderSummary["credentialSource"] {
  if (source === "OS_VAULT") return "os-vault";
  if (source === "EPHEMERAL") return "ephemeral-memory";
  if (source === "ENVIRONMENT") return "server-environment";
  return "none";
}

async function ensureMigrated(root: string) {
  try {
    await migrateLegacyPlaintextSecrets(root);
  } catch {
    /* migration is best-effort; explicit failures surface on write paths */
  }
}

export async function credentialStatus(root: string, providerId: string) {
  await ensureMigrated(root);
  return credentialDisplay(root, providerId);
}

export async function listProviderSummaries(root: string): Promise<ProviderSummary[]> {
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const stored = new Map(file.providers.map((entry) => [entry.id, entry]));
  const summaries: ProviderSummary[] = [];
  for (const builtin of BUILTIN) {
    const custom = stored.get(builtin.id);
    const display = await credentialDisplay(root, builtin.id);
    summaries.push({
      id: builtin.id,
      name: custom?.name || builtin.name,
      kind: custom?.kind || builtin.kind,
      type: custom?.type || builtin.type,
      baseUrl: custom?.baseUrl ?? builtin.baseUrl,
      authState: display.configured ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialState: display.configured ? "CONFIGURED" : "NOT_CONFIGURED",
      credentialSource: vaultSourceLabel(display.source),
      modelsDiscovered: custom?.modelsDiscovered ?? 0,
      favoriteModel: custom?.favoriteModel ?? null,
      health: custom?.health ?? (display.configured ? "NOT_EVALUATED" : "NOT_CONFIGURED"),
      lastVerifiedAt: custom?.lastVerifiedAt ?? null,
      lastSuccessfulAuthAt: custom?.lastSuccessfulAuthAt ?? null,
      maskedKey: display.configured ? maskWithSuffix(display.suffix) || "sk-••••••••" : null,
      discoveryState: custom?.discoveryState ?? "NEVER_RUN",
      customHeaders: custom?.customHeaderNames ?? [],
      streaming: custom ? (custom.streaming ? "SUPPORTED" : "UNSUPPORTED") : "UNKNOWN",
      timeoutMs: custom?.timeoutMs ?? 30_000,
    });
  }
  for (const entry of file.providers.filter((candidate) => !BUILTIN.some((builtin) => builtin.id === candidate.id))) {
    const display = await credentialDisplay(root, entry.id);
    summaries.push({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      type: entry.type,
      baseUrl: entry.baseUrl,
      authState: display.configured ? "CONFIGURED" as const : "NOT_CONFIGURED" as const,
      credentialState: display.configured ? "CONFIGURED" as const : "NOT_CONFIGURED" as const,
      credentialSource: vaultSourceLabel(display.source),
      modelsDiscovered: entry.modelsDiscovered,
      favoriteModel: entry.favoriteModel,
      health: entry.health,
      lastVerifiedAt: entry.lastVerifiedAt,
      lastSuccessfulAuthAt: entry.lastSuccessfulAuthAt,
      maskedKey: display.configured ? maskWithSuffix(display.suffix) || "sk-••••••••" : null,
      discoveryState: entry.discoveryState,
      customHeaders: entry.customHeaderNames,
      streaming: entry.streaming ? "SUPPORTED" as const : "UNSUPPORTED" as const,
      timeoutMs: entry.timeoutMs,
    });
  }
  return summaries;
}

export function headerVaultKey(providerId: string, headerName: string) {
  return `headers.${providerId}.${headerName.trim().toLowerCase()}`;
}

export async function customHeadersFor(root: string, providerId: string, names: string[]): Promise<Record<string, string>> {
  const vault = createCredentialVault(root);
  const resolved: Record<string, string> = {};
  for (const name of names) {
    const value = await vault.reveal(headerVaultKey(providerId, name));
    if (value) resolved[name] = value;
  }
  return resolved;
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
  for (const override of [input.modelsEndpoint, input.chatEndpoint]) {
    if (override?.trim() && !/^https?:\/\/.+/i.test(override.trim())) return "Endpoint overrides must be http(s) URLs.";
  }
  return null;
}

async function adapterContextFor(root: string, providerId: string): Promise<{ ctx: AdapterContext; stored: StoredProvider | undefined; kind: ProviderAdapterKind; baseUrl: string }> {
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const stored = file.providers.find((entry) => entry.id === providerId);
  const builtin = BUILTIN.find((entry) => entry.id === providerId);
  if (!stored && !builtin) throw new Error("Unknown provider.");
  const kind = stored?.kind || builtin?.kind || "openai-compatible";
  const baseUrl = stored?.baseUrl || builtin?.baseUrl || "";
  const credential = (await createCredentialVault(root).reveal(providerId)) || "";
  const customHeaders = await customHeadersFor(root, providerId, stored?.customHeaderNames || []);
  return {
    ctx: {
      baseUrl,
      credential,
      organization: stored?.organization,
      customHeaders,
      timeoutMs: stored?.timeoutMs ?? 30_000,
      modelsEndpointOverride: stored?.modelsEndpointOverride,
      chatEndpointOverride: stored?.chatEndpointOverride,
    },
    stored,
    kind,
    baseUrl,
  };
}

export async function upsertCustomProvider(root: string, input: CustomProviderInput, fetcher: typeof fetch = fetch): Promise<{ provider: ProviderSummary; verified: boolean }> {
  void fetcher;
  const error = validateCustomInput(input);
  if (error) throw new Error(error);
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const vault = createCredentialVault(root);
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
  file.providers = [...file.providers.filter((entry) => entry.id !== id), stored];
  await vault.set(id, input.apiKey.trim());
  for (const [name, value] of Object.entries(input.customHeaders || {})) {
    if (typeof value === "string" && value.trim()) await vault.set(headerVaultKey(id, name), value.trim());
  }
  await writeJson(providersPath(root), file);
  const summaries = await listProviderSummaries(root);
  const provider = summaries.find((entry) => entry.id === id);
  if (!provider) throw new Error("Provider registration failed.");
  return { provider, verified: false };
}

export async function replaceProviderKey(root: string, providerId: string, apiKey: string): Promise<ProviderSummary> {
  if (!apiKey.trim() || apiKey.trim().length < 8) throw new Error("Replacement key must include at least 8 characters.");
  await ensureMigrated(root);
  const file = await readJson<ProviderFile>(providersPath(root), { providers: [] });
  const known = BUILTIN.some((entry) => entry.id === providerId) || file.providers.some((entry) => entry.id === providerId);
  if (!known) throw new Error("Unknown provider.");
  await createCredentialVault(root).set(providerId, apiKey.trim());
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
        modelsEndpointOverride: null,
        chatEndpointOverride: null,
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
  const summaries = await listProviderSummaries(root);
  const next = summaries.find((entry) => entry.id === providerId);
  if (!next) throw new Error("Credential replacement failed.");
  return next;
}

export async function deleteProviderKey(root: string, providerId: string, confirmed: boolean): Promise<ProviderSummary> {
  if (confirmed !== true) throw new Error("Deleting a credential is destructive and requires explicit confirmation.");
  await ensureMigrated(root);
  await createCredentialVault(root).delete(providerId);
  const summaries = await listProviderSummaries(root);
  const next = summaries.find((entry) => entry.id === providerId);
  if (!next) throw new Error("Unknown provider.");
  return next;
}

export async function revealProviderKey(root: string, providerId: string, confirmed: boolean): Promise<{ masked: string; value?: string; expiresInMs: number }> {
  if (confirmed !== true) throw new Error("Full key reveal requires explicit confirmation.");
  await ensureMigrated(root);
  const value = await createCredentialVault(root).reveal(providerId);
  if (!value) throw new Error("NOT_CONFIGURED: no credential is stored for this provider.");
  return { masked: `sk-••••••••••••••••••••••••${value.slice(-4)}`, value, expiresInMs: 15_000 };
}

export function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

export async function discoverProviderModels(root: string, providerId: string, fetcher: typeof fetch = fetch): Promise<{ models: CanonicalModel[]; discoveryState: ProviderSummary["discoveryState"]; cached: boolean }> {
  const { ctx, kind } = await adapterContextFor(root, providerId);
  if (!ctx.baseUrl) throw new Error("Provider has no models endpoint.");
  const adapter = getAdapter(kind);
  const validation = await adapter.validateConfiguration(ctx);
  if (!validation.ok) throw new Error(validation.reason);
  const cached = await readJson<{ models: CanonicalModel[]; discoveredAt: string }>(discoveryPath(root, providerId), { models: [], discoveredAt: "" });
  const started = Date.now();
  try {
    const models = (await adapter.listModels(ctx, fetcher)).map((model) => ({ ...model, providerId }));
    const nowIso = new Date().toISOString();
    await writeJson(discoveryPath(root, providerId), { models, discoveredAt: nowIso, durationMs: Date.now() - started, source: kind });
    await markDiscovery(root, providerId, models.length ? "SUCCEEDED" : "PARTIAL", models.length, true);
    return { models, discoveryState: models.length ? "SUCCEEDED" : "PARTIAL", cached: false };
  } catch (error: unknown) {
    await markDiscovery(root, providerId, "FAILED", cached.models.length, false);
    if (cached.models.length > 0) {
      return { models: cached.models, discoveryState: "PARTIAL", cached: true };
    }
    const detail = error instanceof Error ? error.message : "Discovery request failed.";
    const err = new Error(detail.startsWith("NOT_CONFIGURED") ? detail : `PROVIDER_ERROR: ${detail}`) as Error & { errorKind: string };
    err.errorKind = adapter.normalizeError(null, detail);
    throw err;
  }
}

export async function refreshProviderModels(root: string, providerId: string, fetcher: typeof fetch = fetch) {
  await fs.rm(discoveryPath(root, providerId), { force: true });
  return discoverProviderModels(root, providerId, fetcher);
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
      modelsEndpointOverride: null,
      chatEndpointOverride: null,
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
  const { ctx, kind: adapterKind } = await adapterContextFor(root, providerId);
  if (!ctx.baseUrl) throw new Error("Provider has no testable endpoint.");
  const adapter = getAdapter(adapterKind);
  const validation = await adapter.validateConfiguration(ctx);
  if (!validation.ok) throw new Error(validation.reason);
  const summaries = await listProviderSummaries(root);
  const summary = summaries.find((entry) => entry.id === providerId);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const base = { providerId, modelId, kind, startedAt, finishedAt: startedAt, latencyMs: 0, httpStatus: null as number | null, ok: false, streamingOutcome: "NOT_TESTED" as const, toolOutcome: "NOT_TESTED" as ConnectionTestEvidence["toolOutcome"], tokenEvidence: null, providerRequestId: null as string | null, errorKind: null as ConnectionTestEvidence["errorKind"], errorDetail: null as string | null };

  if (kind === "connection") {
    const result = await adapter.testConnection(ctx, fetcher);
    await markDiscovery(root, providerId, result.ok ? summary?.discoveryState || "NEVER_RUN" : "FAILED", summary?.modelsDiscovered || 0, result.ok);
    return { ...base, finishedAt: new Date().toISOString(), latencyMs: result.latencyMs, httpStatus: result.httpStatus, ok: result.ok, providerRequestId: result.requestId, errorKind: result.errorKind, errorDetail: result.errorDetail ? `${result.errorDetail} No project code was sent.` : null };
  }

  const model = modelId?.trim() || (await listDiscoveredModels(root, providerId))[0]?.id || "";
  if (!model) throw new Error("Select a discovered model before running model, stream or tool tests.");

  if (kind === "model") {
    const evidence = await adapter.testModel(ctx, model, fetcher);
    return { ...base, finishedAt: new Date().toISOString(), latencyMs: evidence.latencyMs, httpStatus: evidence.httpStatus, ok: evidence.ok, providerRequestId: evidence.requestId, errorKind: evidence.errorKind, errorDetail: evidence.errorDetail ? `${evidence.errorDetail} No project code was sent.` : null, tokenEvidence: evidence.usage.input !== null || evidence.usage.output !== null ? { input: evidence.usage.input, output: evidence.usage.output, total: evidence.usage.total } : null };
  }

  if (kind === "stream") {
    const evidence = await adapter.testStreaming(ctx, model, fetcher);
    return { ...base, finishedAt: new Date().toISOString(), latencyMs: evidence.latencyMs, httpStatus: evidence.httpStatus, ok: evidence.ok, streamingOutcome: evidence.ok ? "SUPPORTED" : evidence.eventCount > 0 ? "UNKNOWN" : "UNSUPPORTED", providerRequestId: evidence.requestId, errorKind: evidence.errorKind, errorDetail: evidence.errorDetail ? `${evidence.errorDetail} No project code was sent. Observed ${evidence.eventCount} stream event(s), terminal=${evidence.terminalOk}.` : null };
  }

  const evidence = await adapter.testTools(ctx, model, fetcher);
  return { ...base, finishedAt: new Date().toISOString(), latencyMs: evidence.latencyMs, httpStatus: evidence.httpStatus, ok: evidence.verdict === "SUPPORTED", toolOutcome: evidence.verdict, providerRequestId: null, errorKind: evidence.errorKind, errorDetail: `${evidence.detail} No project code was sent; only the ${"kforge_capability_probe"} schema was transmitted.` };
}

export type ProviderSessionStatus =
  | "READY"
  | "CONTEXT_PREPARING"
  | "WAITING_FOR_DISCLOSURE"
  | "PLANNING"
  | "WAITING_FOR_APPROVAL"
  | "RUNNING"
  | "TOOL_EXECUTING"
  | "APPLYING"
  | "VERIFYING"
  | "PREVIEW_STARTING"
  | "PREVIEWING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ROLLED_BACK";

export interface ProviderSession {
  id: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  mode: "ASK" | "PLAN" | "IMPLEMENT" | "REVIEW" | "DEBUG" | "TEST" | "REFACTOR" | "SECURITY_AUDIT" | "FULL_MISSION";
  status: ProviderSessionStatus;
  task: string;
  contextScope: string;
  createdAt: string;
  updatedAt: string;
  disclosureConfirmed: boolean;
  disclosureDestination: string | null;
  cloudDisclosure: boolean;
  checkpointId: string | null;
  previewSessionId: string | null;
  autonomy: string;
  pendingApproval: { id: string; kind: string; summary: string; createdAt: string } | null;
  telemetry: {
    ttftMs: number | null;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    cachedTokens: number | null;
    totalTokens: number | null;
    costSource: "PROVIDER_REPORTED" | "ESTIMATED" | "UNKNOWN";
    estimatedCost: number | null;
    toolCalls: number;
    filesChanged: number;
    testState: string | null;
    buildState: string | null;
    previewState: string | null;
    retries: number;
    providerRequestId: string | null;
    finishReason: string | null;
  };
  error: string | null;
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
  const session = {
    id: randomUUID(),
    projectId: input.projectId ?? null,
    providerId: input.providerId,
    modelId: input.modelId.trim().slice(0, 160),
    mode: input.mode,
    status: "READY" as const,
    task: input.task.trim().slice(0, 2_000),
    contextScope: input.contextScope,
    createdAt: now,
    updatedAt: now,
    disclosureConfirmed: input.disclosureConfirmed,
    cloudDisclosure: isCloud,
  };
  const full: ProviderSession = {
    ...session,
    disclosureDestination: isCloud ? input.providerId : null,
    checkpointId: null,
    previewSessionId: null,
    autonomy: "SAFE IMPLEMENTATION",
    pendingApproval: null,
    telemetry: { ttftMs: null, latencyMs: null, inputTokens: null, outputTokens: null, reasoningTokens: null, cachedTokens: null, totalTokens: null, costSource: "UNKNOWN", estimatedCost: null, toolCalls: 0, filesChanged: 0, testState: null, buildState: null, previewState: null, retries: 0, providerRequestId: null, finishReason: null },
    error: null,
  };
  sessions.sessions = [full, ...sessions.sessions].slice(0, 200);
  await writeJson(sessionsPath(root), sessions);
  return full;
}

export async function listProviderSessions(root: string): Promise<ProviderSession[]> {
  return (await readJson<{ sessions: ProviderSession[] }>(sessionsPath(root), { sessions: [] })).sessions;
}

export async function getProviderSession(root: string, sessionId: string): Promise<ProviderSession | null> {
  return (await listProviderSessions(root)).find((entry) => entry.id === sessionId) || null;
}

export async function updateProviderSession(root: string, sessionId: string, patch: Partial<ProviderSession>): Promise<ProviderSession> {
  const store = await readJson<{ sessions: ProviderSession[] }>(sessionsPath(root), { sessions: [] });
  const existing = store.sessions.find((entry) => entry.id === sessionId);
  if (!existing) throw new Error("Session not found.");
  const next = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
  store.sessions = [next, ...store.sessions.filter((entry) => entry.id !== sessionId)].slice(0, 200);
  await writeJson(sessionsPath(root), store);
  return next;
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
  await ensureMigrated(root);
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

export function sessionsFilePath(root: string) {
  return sessionsPath(root);
}

export function providersFilePath(root: string) {
  return providersPath(root);
}
