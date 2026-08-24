import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type AIProviderId = "ollama" | "lm-studio" | "llama-cpp" | "openai" | "anthropic" | "gemini" | "openrouter";
export type CloudAIProviderId = Extract<AIProviderId, "openai" | "anthropic" | "gemini" | "openrouter">;
export type ProviderKind = "local" | "cloud";
export type CompatibilityClass = "recommended" | "possible" | "too-heavy" | "unsupported";

export interface AIModelInfo {
  id: string;
  name: string;
  sizeBytes?: number;
  contextLength?: number;
  parameterSize?: string;
  capabilities: string[];
}

export interface AIProviderInfo {
  id: AIProviderId;
  name: string;
  kind: ProviderKind;
  configured: boolean;
  reachable: boolean;
  available: boolean;
  endpoint?: string;
  models: AIModelInfo[];
  capabilities: string[];
  privacy: string;
  reason?: string;
}

export interface CloudAIConfiguration {
  id: CloudAIProviderId;
  name: string;
  configured: boolean;
  destination: string;
  model: string | null;
  state: "CONFIGURED" | "NOT_CONFIGURED";
  reason: string;
}

export interface CloudAIGeneration {
  provider: CloudAIConfiguration;
  content: string;
}

export interface HardwareInfo {
  os: string;
  platform: string;
  cpu: { model: string; cores: number; logicalProcessors: number };
  memory: { totalBytes: number; freeBytes: number };
  gpu: Array<{ name: string; vramBytes?: number }>;
  disk: { path: string; availableBytes?: number; totalBytes?: number };
  collectedAt: string;
}

export interface OllamaRuntimeStatus {
  installed: boolean;
  executable?: string;
  version?: string;
  serviceReachable: boolean;
  models: AIModelInfo[];
  reason?: string;
}

export interface ModelUpdateStatus {
  state: "UNKNOWN";
  currentVersion: string;
  latestKnownVersion: "UNKNOWN";
  source: "DATA_UNAVAILABLE";
  changelog: "DATA_UNAVAILABLE";
  checkedAt: string;
}

export interface RecommendedModel {
  id: string;
  label: string;
  provider: "ollama";
  pullName: string;
  parameterCount: string;
  estimatedDownloadBytes: number;
  estimatedRamBytes: number;
  estimatedVramBytes?: number;
  contextLength?: number;
  expectedSpeed: string;
  license: string;
  sourceUrl: string;
  local: true;
  compatibility: CompatibilityClass;
  compatible: boolean;
  reason: string;
  family: string;
  variant: string;
  quantization: "UNSPECIFIED";
  categories: string[];
  recommendedUse: string[];
  update: ModelUpdateStatus;
}

export interface ModelHealth {
  status: "pass" | "fail";
  testedAt: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  reason?: string;
}

interface AISettings {
  active?: { provider: AIProviderId; model: string };
  fallback?: { provider: AIProviderId; model: string };
  modelHealth?: Record<string, ModelHealth>;
}

const providerDefinitions: Array<Pick<AIProviderInfo, "id" | "name" | "kind" | "endpoint" | "capabilities" | "privacy">> = [
  { id: "ollama", name: "Ollama", kind: "local", endpoint: "http://127.0.0.1:11434", capabilities: ["chat", "generate", "embeddings", "model-management", "health"], privacy: "Local: project context stays on this machine." },
  { id: "lm-studio", name: "LM Studio", kind: "local", endpoint: "http://127.0.0.1:1234", capabilities: ["chat", "generate", "embeddings"], privacy: "Local: project context stays on this machine." },
  { id: "llama-cpp", name: "llama.cpp compatible runtime", kind: "local", endpoint: "http://127.0.0.1:8080", capabilities: ["chat", "generate"], privacy: "Local: project context stays on this machine." },
  { id: "openai", name: "OpenAI", kind: "cloud", capabilities: ["chat", "generate", "embeddings"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
  { id: "anthropic", name: "Anthropic", kind: "cloud", capabilities: ["chat", "generate"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
  { id: "gemini", name: "Gemini", kind: "cloud", capabilities: ["chat", "generate", "embeddings"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
  { id: "openrouter", name: "OpenRouter", kind: "cloud", capabilities: ["chat", "generate"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
];

type CatalogDefinition = Omit<RecommendedModel, "compatibility" | "compatible" | "reason" | "update">;

const catalog: CatalogDefinition[] = [
  { id: "qwen2.5-coder:1.5b", label: "Qwen2.5-Coder 1.5B", provider: "ollama", pullName: "qwen2.5-coder:1.5b", parameterCount: "1.5B", estimatedDownloadBytes: 1_100_000_000, estimatedRamBytes: 4_000_000_000, contextLength: 32_768, expectedSpeed: "Usable on CPU", license: "Apache-2.0", sourceUrl: "https://ollama.com/library/qwen2.5-coder", local: true, family: "Qwen2.5-Coder", variant: "1.5B", quantization: "UNSPECIFIED", categories: ["Coding", "Small", "Fast", "Local Agent"], recommendedUse: ["Code review", "Small local agent workflows"] },
  { id: "qwen2.5-coder:3b", label: "Qwen2.5-Coder 3B", provider: "ollama", pullName: "qwen2.5-coder:3b", parameterCount: "3B", estimatedDownloadBytes: 2_000_000_000, estimatedRamBytes: 6_000_000_000, contextLength: 32_768, expectedSpeed: "Moderate on CPU", license: "Apache-2.0", sourceUrl: "https://ollama.com/library/qwen2.5-coder", local: true, family: "Qwen2.5-Coder", variant: "3B", quantization: "UNSPECIFIED", categories: ["Coding", "Local Agent"], recommendedUse: ["General code assistance", "Project-grounded questions"] },
  { id: "qwen2.5-coder:7b", label: "Qwen2.5-Coder 7B", provider: "ollama", pullName: "qwen2.5-coder:7b", parameterCount: "7B", estimatedDownloadBytes: 4_700_000_000, estimatedRamBytes: 10_000_000_000, contextLength: 32_768, expectedSpeed: "Slow on CPU", license: "Apache-2.0", sourceUrl: "https://ollama.com/library/qwen2.5-coder", local: true, family: "Qwen2.5-Coder", variant: "7B", quantization: "UNSPECIFIED", categories: ["Coding", "Large", "Local Agent"], recommendedUse: ["Complex code review", "Longer project analysis"] },
  { id: "deepseek-coder:6.7b", label: "DeepSeek Coder 6.7B", provider: "ollama", pullName: "deepseek-coder:6.7b", parameterCount: "6.7B", estimatedDownloadBytes: 3_800_000_000, estimatedRamBytes: 10_000_000_000, contextLength: 16_384, expectedSpeed: "Slow on CPU", license: "Model license — review before use", sourceUrl: "https://github.com/deepseek-ai/deepseek-coder", local: true, family: "DeepSeek Coder", variant: "6.7B", quantization: "UNSPECIFIED", categories: ["Coding", "Large", "Specialized"], recommendedUse: ["Code generation", "Repository exploration"] },
  { id: "starcoder2:3b", label: "StarCoder2 3B", provider: "ollama", pullName: "starcoder2:3b", parameterCount: "3B", estimatedDownloadBytes: 2_000_000_000, estimatedRamBytes: 6_000_000_000, contextLength: 16_384, expectedSpeed: "Moderate on CPU", license: "OpenRAIL", sourceUrl: "https://huggingface.co/blog/starcoder2", local: true, family: "StarCoder2", variant: "3B", quantization: "UNSPECIFIED", categories: ["Coding", "Small", "Specialized"], recommendedUse: ["Local completion", "Code explanation"] },
];

function settingsPath(workspaceRoot: string) { return path.join(workspaceRoot, ".kforge", "ai-settings.json"); }

async function readSettings(workspaceRoot: string): Promise<AISettings> {
  try { return JSON.parse(await fs.readFile(settingsPath(workspaceRoot), "utf8")) as AISettings; } catch { return {}; }
}

async function writeSettings(workspaceRoot: string, settings: AISettings) {
  await fs.mkdir(path.dirname(settingsPath(workspaceRoot)), { recursive: true });
  await fs.writeFile(settingsPath(workspaceRoot), JSON.stringify(settings, null, 2), "utf8");
}

async function getJson<T>(url: string): Promise<{ ok: boolean; data?: T; reason?: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() as T };
  } catch (error: unknown) { return { ok: false, reason: error instanceof Error ? error.message : "Connection failed." }; }
}

function ollamaExecutable() { return process.platform === "win32" ? "ollama.exe" : "ollama"; }

async function runOllama(args: string[], timeout = 12_000) {
  try {
    const result = await execFileAsync(ollamaExecutable(), args, { windowsHide: true, timeout, maxBuffer: 2_500_000 });
    return { ok: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
  } catch (error: unknown) { return { ok: false, output: error instanceof Error ? error.message : "Ollama command failed." }; }
}

function modelKey(provider: string, model: string) { return `${provider}:${model}`; }

const cloudConfiguration = {
  openai: { name: "OpenAI", keyEnvironment: "OPENAI_API_KEY", modelEnvironment: "KFORGE_OPENAI_MODEL", destination: "https://api.openai.com/v1/responses" },
  anthropic: { name: "Anthropic", keyEnvironment: "ANTHROPIC_API_KEY", modelEnvironment: "KFORGE_ANTHROPIC_MODEL", destination: "https://api.anthropic.com/v1/messages" },
  gemini: { name: "Gemini", keyEnvironment: "GEMINI_API_KEY", modelEnvironment: "KFORGE_GEMINI_MODEL", destination: "https://generativelanguage.googleapis.com/v1beta/models" },
  openrouter: { name: "OpenRouter", keyEnvironment: "OPENROUTER_API_KEY", modelEnvironment: "KFORGE_OPENROUTER_MODEL", destination: "https://openrouter.ai/api/v1/chat/completions" },
} as const satisfies Record<CloudAIProviderId, { name: string; keyEnvironment: string; modelEnvironment: string; destination: string }>;

export function isCloudAIProviderId(value: unknown): value is CloudAIProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(cloudConfiguration, value);
}

export function getCloudAIConfiguration(id: CloudAIProviderId): CloudAIConfiguration {
  const definition = cloudConfiguration[id];
  const keyConfigured = Boolean(process.env[definition.keyEnvironment]?.trim());
  const model = process.env[definition.modelEnvironment]?.trim() || null;
  const destination = id === "gemini" && model ? `${definition.destination}/${encodeURIComponent(model)}:generateContent` : definition.destination;
  const configured = keyConfigured && Boolean(model);
  const reason = configured
    ? "Configured on the server. KForge will contact this provider only after an explicit provider choice and per-request disclosure confirmation."
    : !keyConfigured && !model
      ? `NOT_CONFIGURED: set ${definition.keyEnvironment} and ${definition.modelEnvironment} in the server environment.`
      : !keyConfigured
        ? `NOT_CONFIGURED: set ${definition.keyEnvironment} in the server environment.`
        : `NOT_CONFIGURED: set ${definition.modelEnvironment} in the server environment.`;
  return { id, name: definition.name, configured, destination, model, state: configured ? "CONFIGURED" : "NOT_CONFIGURED", reason };
}

export function listCloudAIProviders(): CloudAIConfiguration[] {
  return (Object.keys(cloudConfiguration) as CloudAIProviderId[]).map(getCloudAIConfiguration);
}

export async function getOllamaRuntimeStatus(): Promise<OllamaRuntimeStatus> {
  const version = await runOllama(["--version"], 5_000);
  if (!version.ok) return { installed: false, serviceReachable: false, models: [], reason: "Ollama CLI is not installed or is not available on PATH." };
  const response = await getJson<{ models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string; context_length?: number } }> }>("http://127.0.0.1:11434/api/tags");
  const models = (response.data?.models || []).flatMap((model) => model.name ? [{ id: model.name, name: model.name, sizeBytes: model.size, parameterSize: model.details?.parameter_size, contextLength: model.details?.context_length, capabilities: ["chat", "generate"] }] : []);
  return { installed: true, executable: ollamaExecutable(), version: version.output, serviceReachable: response.ok, models, reason: response.ok ? undefined : response.reason || "Ollama is installed but its local service is unavailable." };
}

async function localProvider(definition: typeof providerDefinitions[number]): Promise<AIProviderInfo> {
  if (definition.id === "ollama") {
    const status = await getOllamaRuntimeStatus();
    return { ...definition, configured: status.installed, reachable: status.serviceReachable, available: status.serviceReachable && status.models.length > 0, models: status.models, reason: status.reason };
  }
  const response = await getJson<{ data?: Array<{ id?: string; context_length?: number }> }>(`${definition.endpoint}/v1/models`);
  const models = (response.data?.data || []).flatMap((model) => model.id ? [{ id: model.id, name: model.id, contextLength: model.context_length, capabilities: ["chat", "generate"] }] : []);
  return { ...definition, configured: true, reachable: response.ok, available: response.ok && models.length > 0, models, reason: response.ok ? (models.length ? undefined : `${definition.name} is reachable but reports no loaded model.`) : response.reason };
}

export async function listAIProviders(): Promise<AIProviderInfo[]> {
  return Promise.all(providerDefinitions.map(async (definition) => {
    if (definition.kind === "local") return localProvider(definition);
    const configuration = getCloudAIConfiguration(definition.id as CloudAIProviderId);
    return {
      ...definition,
      endpoint: configuration.destination,
      configured: configuration.configured,
      reachable: false,
      available: false,
      models: configuration.model ? [{ id: configuration.model, name: configuration.model, capabilities: ["chat", "generate"] }] : [],
      reason: configuration.reason,
    };
  }));
}

function cloudCredential(id: CloudAIProviderId) {
  return process.env[cloudConfiguration[id].keyEnvironment]?.trim() || "";
}

function responseText(data: unknown, id: CloudAIProviderId): string {
  if (typeof data !== "object" || data === null) throw new Error(`${cloudConfiguration[id].name} returned a malformed response.`);
  const value = data as Record<string, unknown>;
  if (id === "openai") {
    if (typeof value.output_text === "string" && value.output_text.trim()) return value.output_text.trim();
    const output = Array.isArray(value.output) ? value.output : [];
    const text = output
      .flatMap((item) => typeof item === "object" && item !== null && Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [])
      .flatMap((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : [])
      .join("\n").trim();
    if (text) return text;
  }
  if (id === "anthropic") {
    const text = (Array.isArray(value.content) ? value.content : [])
      .flatMap((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : [])
      .join("\n").trim();
    if (text) return text;
  }
  if (id === "gemini") {
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    const text = candidates
      .flatMap((candidate) => {
        if (typeof candidate !== "object" || candidate === null) return [];
        const content = (candidate as { content?: unknown }).content;
        if (typeof content !== "object" || content === null || !Array.isArray((content as { parts?: unknown }).parts)) return [];
        return (content as { parts: unknown[] }).parts;
      })
      .flatMap((part) => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : [])
      .join("\n").trim();
    if (text) return text;
  }
  if (id === "openrouter") {
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const first = choices[0];
    if (typeof first === "object" && first !== null) {
      const message = (first as { message?: unknown }).message;
      if (typeof message === "object" && message !== null) {
        const content = (message as { content?: unknown }).content;
        if (typeof content === "string" && content.trim()) return content.trim();
      }
    }
  }
  throw new Error(`${cloudConfiguration[id].name} returned no text content.`);
}

export async function generateWithCloudAI(id: CloudAIProviderId, system: string, user: string, fetcher: typeof fetch = fetch): Promise<CloudAIGeneration> {
  const provider = getCloudAIConfiguration(id);
  if (!provider.configured || !provider.model) throw new Error(provider.reason);
  const credential = cloudCredential(id);
  let url = provider.destination;
  let headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: Record<string, unknown>;
  if (id === "openai") {
    headers = { ...headers, Authorization: `Bearer ${credential}` };
    body = { model: provider.model, store: false, input: [{ role: "system", content: system }, { role: "user", content: user }] };
  } else if (id === "anthropic") {
    headers = { ...headers, "x-api-key": credential, "anthropic-version": "2023-06-01" };
    body = { model: provider.model, max_tokens: 2_048, system, messages: [{ role: "user", content: user }] };
  } else if (id === "gemini") {
    headers = { ...headers, "x-goog-api-key": credential };
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0 } };
  } else {
    headers = { ...headers, Authorization: `Bearer ${credential}` };
    body = { model: provider.model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  }
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`${provider.name} request failed with HTTP ${response.status}.`);
  return { provider, content: responseText(await response.json(), id) };
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const base: HardwareInfo = { os: `${os.type()} ${os.release()}`, platform: process.platform, cpu: { model: os.cpus()[0]?.model || "Unknown CPU", cores: os.cpus().length, logicalProcessors: os.cpus().length }, memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() }, gpu: [], disk: { path: process.cwd() }, collectedAt: new Date().toISOString() };
  try { const stat = await fs.statfs(process.cwd()); base.disk = { path: process.cwd(), availableBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) }; } catch { /* filesystem may not expose capacity */ }
  if (process.platform === "win32") {
    try {
      const output = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 4_000 });
      const value: unknown = JSON.parse(output.stdout || "[]");
      const rows = Array.isArray(value) ? value : [value];
      base.gpu = rows.flatMap((row) => typeof row === "object" && row !== null ? [{ name: typeof (row as { Name?: unknown }).Name === "string" ? (row as { Name: string }).Name : "Unknown GPU", vramBytes: typeof (row as { AdapterRAM?: unknown }).AdapterRAM === "number" ? (row as { AdapterRAM: number }).AdapterRAM : undefined }] : []);
    } catch { /* do not invent GPU data */ }
  }
  return base;
}

function classifyModel(model: typeof catalog[number], hardware: HardwareInfo): Pick<RecommendedModel, "compatibility" | "compatible" | "reason"> {
  const disk = hardware.disk.availableBytes || 0;
  if (disk > 0 && disk < model.estimatedDownloadBytes * 1.25) return { compatibility: "unsupported", compatible: false, reason: "Insufficient available disk for the model download and cache." };
  const dedicatedVram = Math.max(0, ...hardware.gpu.filter((gpu) => !/intel|integrated/i.test(gpu.name)).map((gpu) => gpu.vramBytes || 0));
  if (model.estimatedVramBytes && dedicatedVram > 0 && dedicatedVram < model.estimatedVramBytes) return { compatibility: "unsupported", compatible: false, reason: "Dedicated GPU VRAM is below the model estimate." };
  const ramRatio = model.estimatedRamBytes / hardware.memory.totalBytes;
  if (ramRatio > 0.84) return { compatibility: "too-heavy", compatible: false, reason: `Requires about ${Math.ceil(model.estimatedRamBytes / 1e9)} GB RAM; only ${Math.floor(hardware.memory.totalBytes / 1e9)} GB is installed.` };
  if (ramRatio > 0.62) return { compatibility: "possible", compatible: true, reason: "Fits installed RAM but may be slow under CPU-only inference or when other applications are open." };
  return { compatibility: "recommended", compatible: true, reason: "Fits the detected memory and disk budget for local CPU-first inference." };
}

export async function getModelCenter(workspaceRoot: string) {
  const [hardware, providers, settings, ollama] = await Promise.all([getHardwareInfo(), listAIProviders(), readSettings(workspaceRoot), getOllamaRuntimeStatus()]);
  const checkedAt = new Date().toISOString();
  const recommendations = catalog.map((model) => ({ ...model, ...classifyModel(model, hardware), update: { state: "UNKNOWN" as const, currentVersion: model.variant, latestKnownVersion: "UNKNOWN" as const, source: "DATA_UNAVAILABLE" as const, changelog: "DATA_UNAVAILABLE" as const, checkedAt } }));
  const byFamily = new Map<string, typeof recommendations>();
  recommendations.forEach((model) => byFamily.set(model.family, [...(byFamily.get(model.family) || []), model]));
  const families = [...byFamily.entries()].map(([family, variants]) => ({ family, provider: "ollama" as const, variants, updateSource: "DATA_UNAVAILABLE" as const, detail: "No verified remote catalog adapter is configured, so latest-version and changelog data remain UNKNOWN." }));
  return { hardware, providers, ollama, active: settings.active, fallback: settings.fallback, modelHealth: settings.modelHealth || {}, recommendations, families, onboarding: ollama.installed ? (ollama.serviceReachable ? "runtime-ready" : "start-ollama-service") : "install-ollama", downloadUrl: "https://ollama.com/download/windows" };
}

export async function setActiveModel(workspaceRoot: string, provider: AIProviderId, model: string, fallback?: boolean) {
  const providers = await listAIProviders();
  const selected = providers.find((entry) => entry.id === provider);
  if (!selected || selected.kind !== "local" || !selected.available || !selected.models.some((entry) => entry.id === model)) throw new Error("The selected provider/model is not currently available locally.");
  const settings = await readSettings(workspaceRoot);
  if (fallback) settings.fallback = { provider, model }; else settings.active = { provider, model };
  await writeSettings(workspaceRoot, settings);
  return fallback ? { fallback: settings.fallback } : { active: settings.active };
}

async function recordHealth(workspaceRoot: string, provider: string, model: string, health: ModelHealth) {
  const settings = await readSettings(workspaceRoot);
  settings.modelHealth = { ...settings.modelHealth, [modelKey(provider, model)]: health };
  await writeSettings(workspaceRoot, settings);
}

function openAICompatibleRequest(endpoint: string, model: string, prompt: string) { return fetch(`${endpoint}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(90_000) }); }

export async function testAIConnection(workspaceRoot: string, requestedProvider?: AIProviderId, requestedModel?: string) {
  const settings = await readSettings(workspaceRoot);
  const providerId = requestedProvider || settings.active?.provider;
  const model = requestedModel || settings.active?.model;
  if (!providerId || !model) throw new Error("Select an installed local provider and model before testing AI.");
  const provider = (await listAIProviders()).find((entry) => entry.id === providerId);
  if (!provider || provider.kind !== "local" || !provider.available || !provider.models.some((entry) => entry.id === model)) throw new Error("The selected local provider/model is unavailable.");
  const prompt = "Analyze this TypeScript function and identify one bug: function total(items: number[]) { return items[0] / items.length; }";
  const started = performance.now();
  try {
    if (provider.id === "ollama") {
      const response = await fetch(`${provider.endpoint}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(90_000) });
      const latencyMs = Math.round(performance.now() - started);
      if (!response.ok) throw new Error(`Ollama test failed with HTTP ${response.status}.`);
      const data = await response.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      if (!data.message?.content?.trim()) throw new Error("Ollama returned a malformed response with no analysis content.");
      const result = { ok: true, provider: provider.id, model, latencyMs, promptTokens: data.prompt_eval_count, completionTokens: data.eval_count, output: data.message.content.trim() };
      await recordHealth(workspaceRoot, provider.id, model, { status: "pass", testedAt: new Date().toISOString(), latencyMs, promptTokens: data.prompt_eval_count, completionTokens: data.eval_count });
      return result;
    }
    const response = await openAICompatibleRequest(provider.endpoint || "", model, prompt);
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) throw new Error(`${provider.name} test failed with HTTP ${response.status}.`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const output = data.choices?.[0]?.message?.content?.trim();
    if (!output) throw new Error(`${provider.name} returned a malformed response with no analysis content.`);
    const result = { ok: true, provider: provider.id, model, latencyMs, promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, output };
    await recordHealth(workspaceRoot, provider.id, model, { status: "pass", testedAt: new Date().toISOString(), latencyMs, promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens });
    return result;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "AI health test failed.";
    await recordHealth(workspaceRoot, providerId, model, { status: "fail", testedAt: new Date().toISOString(), reason });
    throw error;
  }
}

export async function installOllamaModel(pullName: string) {
  if (!/^[A-Za-z0-9._:-]+$/.test(pullName)) throw new Error("The requested Ollama model name is invalid.");
  const status = await getOllamaRuntimeStatus();
  if (!status.installed) throw new Error("Ollama is not installed. Download and install the runtime first, then rerun detection.");
  if (!status.serviceReachable) throw new Error("Ollama is installed but its service is not reachable. Start Ollama and retry.");
  const result = await runOllama(["pull", pullName], 900_000);
  return { ok: result.ok, output: result.output, message: result.ok ? `Installed ${pullName}.` : `Could not install ${pullName}.` };
}

export async function deleteOllamaModel(model: string) {
  if (!/^[A-Za-z0-9._:-]+$/.test(model)) throw new Error("The requested Ollama model name is invalid.");
  const status = await getOllamaRuntimeStatus();
  if (!status.models.some((entry) => entry.id === model)) throw new Error("The model is not installed in Ollama.");
  const result = await runOllama(["rm", model], 120_000);
  return { ok: result.ok, output: result.output, message: result.ok ? `Removed ${model}.` : `Could not remove ${model}.` };
}

export async function generateWithLocalAI(workspaceRoot: string, system: string, user: string) {
  const settings = await readSettings(workspaceRoot);
  const selected = settings.active;
  if (!selected) throw new Error("No active local model is selected.");
  const provider = (await listAIProviders()).find((entry) => entry.id === selected.provider);
  if (!provider || provider.kind !== "local" || !provider.available || !provider.models.some((entry) => entry.id === selected.model)) throw new Error("The active local model is unavailable.");
  if (provider.id === "ollama") {
    const response = await fetch(`${provider.endpoint}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selected.model, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Ollama generation failed with HTTP ${response.status}.`);
    const data = await response.json() as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) throw new Error("Ollama returned no content.");
    return { provider, model: selected.model, content };
  }
  const response = await fetch(`${provider.endpoint}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selected.model, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${provider.name} generation failed with HTTP ${response.status}.`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${provider.name} returned no content.`);
  return { provider, model: selected.model, content };
}


export type ModelUpdateEngineState = "REMOTE_REGISTRY_NOT_CONFIGURED" | "INSTALLED_VERSION_VERIFIED" | "MODEL_NOT_INSTALLED";

export interface ModelUpdateEngineResult {
  provider: "ollama";
  model: string;
  state: ModelUpdateEngineState;
  checkedAt: string;
  source: { kind: "local-runtime" | "remote-registry"; configured: boolean; label: string; url?: string };
  currentVersion?: string;
  latestKnownVersion: "UNKNOWN";
  changelog: "REMOTE_REGISTRY_NOT_CONFIGURED";
  detail: string;
}

function validOllamaModelName(model: string) {
  return /^[A-Za-z0-9._:-]+$/.test(model);
}

function knownCatalogModel(model: string) {
  return catalog.find((entry) => entry.id === model || entry.pullName === model);
}

function modelVersion(model: string) {
  return model.includes(":") ? model.slice(model.indexOf(":") + 1) : "UNSPECIFIED";
}

async function installedOllamaModel(model: string) {
  const runtime = await getOllamaRuntimeStatus();
  return { runtime, model: runtime.models.find((entry) => entry.id === model) };
}

export async function getModelVersion(model: string) {
  if (!validOllamaModelName(model)) throw new Error("The requested Ollama model name is invalid.");
  const { runtime, model: installed } = await installedOllamaModel(model);
  const catalogModel = knownCatalogModel(model);
  if (installed) return { provider: "ollama" as const, model, state: "INSTALLED_VERSION_VERIFIED" as const, currentVersion: modelVersion(installed.id), source: "local-runtime", verifiedAt: new Date().toISOString() };
  return { provider: "ollama" as const, model, state: "MODEL_NOT_INSTALLED" as const, currentVersion: catalogModel ? modelVersion(catalogModel.pullName) : "UNKNOWN", source: runtime.installed ? "local-runtime" : "local-catalog", verifiedAt: new Date().toISOString() };
}

export async function checkForModelUpdates(workspaceRoot: string, model: string): Promise<ModelUpdateEngineResult> {
  void workspaceRoot;
  const version = await getModelVersion(model);
  return {
    provider: "ollama",
    model,
    state: version.state === "INSTALLED_VERSION_VERIFIED" ? "REMOTE_REGISTRY_NOT_CONFIGURED" : "MODEL_NOT_INSTALLED",
    checkedAt: new Date().toISOString(),
    source: { kind: "remote-registry", configured: false, label: "Ollama remote registry adapter", url: "https://ollama.com/library" },
    currentVersion: version.currentVersion,
    latestKnownVersion: "UNKNOWN",
    changelog: "REMOTE_REGISTRY_NOT_CONFIGURED",
    detail: version.state === "INSTALLED_VERSION_VERIFIED"
      ? "The installed local version was verified, but no remote registry adapter is configured. KForge cannot truthfully report whether an update exists."
      : "The requested model is not installed locally. No remote registry adapter is configured, so KForge cannot report a latest version or update availability.",
  };
}

export async function getModelChangelog(workspaceRoot: string, model: string) {
  const update = await checkForModelUpdates(workspaceRoot, model);
  return { ...update, entries: [] as Array<{ version: string; publishedAt?: string; summary: string }> };
}

export async function getModelCompatibility(workspaceRoot: string, model: string) {
  void workspaceRoot;
  if (!validOllamaModelName(model)) throw new Error("The requested Ollama model name is invalid.");
  const catalogModel = knownCatalogModel(model);
  if (!catalogModel) return { provider: "ollama" as const, model, state: "DATA_UNAVAILABLE" as const, detail: "No local catalog metadata exists for this model, so compatibility cannot be calculated." };
  const hardware = await getHardwareInfo();
  return { provider: "ollama" as const, model, state: "AVAILABLE" as const, hardwareCollectedAt: hardware.collectedAt, ...classifyModel(catalogModel, hardware) };
}

export async function installModelUpdate(workspaceRoot: string, model: string) {
  const update = await checkForModelUpdates(workspaceRoot, model);
  return { ...update, allowed: false, action: "BLOCKED", reason: "REMOTE REGISTRY NOT CONFIGURED. KForge will not download or replace a local model without a configured registry adapter and explicit user confirmation." };
}

export async function verifyModelUpdate(workspaceRoot: string, model: string) {
  const version = await getModelVersion(model);
  const update = await checkForModelUpdates(workspaceRoot, model);
  return { ...update, verification: version.state === "INSTALLED_VERSION_VERIFIED" ? "LOCAL_VERSION_VERIFIED" : "MODEL_NOT_INSTALLED", verifiedAt: version.verifiedAt };
}
