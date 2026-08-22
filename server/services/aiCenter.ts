import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type AIProviderId = "ollama" | "lm-studio" | "llama-cpp" | "openai" | "anthropic" | "gemini" | "openrouter";
export type ProviderKind = "local" | "cloud";

export interface AIModelInfo {
  id: string;
  name: string;
  sizeBytes?: number;
  contextLength?: number;
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

export interface HardwareInfo {
  os: string;
  platform: string;
  cpu: { model: string; cores: number; logicalProcessors: number };
  memory: { totalBytes: number; freeBytes: number };
  gpu: Array<{ name: string; vramBytes?: number }>;
  disk: { path: string; availableBytes?: number; totalBytes?: number };
  collectedAt: string;
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
  license: string;
  sourceUrl: string;
  local: true;
  compatible: boolean;
  reason: string;
}

interface AISettings {
  active?: { provider: AIProviderId; model: string };
}

const providerDefinitions: Array<Pick<AIProviderInfo, "id" | "name" | "kind" | "endpoint" | "capabilities" | "privacy">> = [
  { id: "ollama", name: "Ollama", kind: "local", endpoint: "http://127.0.0.1:11434", capabilities: ["chat", "generate", "embeddings", "model-management"], privacy: "Local: project context stays on this machine." },
  { id: "lm-studio", name: "LM Studio", kind: "local", endpoint: "http://127.0.0.1:1234", capabilities: ["chat", "generate", "embeddings"], privacy: "Local: project context stays on this machine." },
  { id: "llama-cpp", name: "llama.cpp compatible runtime", kind: "local", endpoint: "http://127.0.0.1:8080", capabilities: ["chat", "generate"], privacy: "Local: project context stays on this machine." },
  { id: "openai", name: "OpenAI", kind: "cloud", capabilities: ["chat", "generate", "embeddings"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
  { id: "anthropic", name: "Anthropic", kind: "cloud", capabilities: ["chat", "generate"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
  { id: "gemini", name: "Gemini", kind: "cloud", capabilities: ["chat", "generate", "embeddings"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
  { id: "openrouter", name: "OpenRouter", kind: "cloud", capabilities: ["chat", "generate"], privacy: "Cloud: project context may leave this machine only after explicit configuration and confirmation." },
];

const catalog: Array<Omit<RecommendedModel, "compatible" | "reason">> = [
  { id: "qwen2.5-coder:1.5b", label: "Qwen2.5-Coder 1.5B", provider: "ollama", pullName: "qwen2.5-coder:1.5b", parameterCount: "1.5B", estimatedDownloadBytes: 1_100_000_000, estimatedRamBytes: 4_000_000_000, contextLength: 32_768, license: "Apache-2.0", sourceUrl: "https://ollama.com/library/qwen2.5-coder", local: true },
  { id: "qwen2.5-coder:3b", label: "Qwen2.5-Coder 3B", provider: "ollama", pullName: "qwen2.5-coder:3b", parameterCount: "3B", estimatedDownloadBytes: 2_000_000_000, estimatedRamBytes: 6_000_000_000, contextLength: 32_768, license: "Apache-2.0", sourceUrl: "https://ollama.com/library/qwen2.5-coder", local: true },
  { id: "qwen2.5-coder:7b", label: "Qwen2.5-Coder 7B", provider: "ollama", pullName: "qwen2.5-coder:7b", parameterCount: "7B", estimatedDownloadBytes: 4_700_000_000, estimatedRamBytes: 10_000_000_000, contextLength: 32_768, license: "Apache-2.0", sourceUrl: "https://ollama.com/library/qwen2.5-coder", local: true },
  { id: "deepseek-coder:6.7b", label: "DeepSeek Coder 6.7B", provider: "ollama", pullName: "deepseek-coder:6.7b", parameterCount: "6.7B", estimatedDownloadBytes: 3_800_000_000, estimatedRamBytes: 10_000_000_000, contextLength: 16_384, license: "Model license — review before use", sourceUrl: "https://github.com/deepseek-ai/deepseek-coder", local: true },
  { id: "starcoder2:3b", label: "StarCoder2 3B", provider: "ollama", pullName: "starcoder2:3b", parameterCount: "3B", estimatedDownloadBytes: 2_000_000_000, estimatedRamBytes: 6_000_000_000, contextLength: 16_384, license: "OpenRAIL", sourceUrl: "https://huggingface.co/blog/starcoder2", local: true },
];

function settingsPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "ai-settings.json");
}

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
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : "Connection failed." };
  }
}

function cloudEnvironmentKey(id: AIProviderId) {
  return ({ openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY" } as const)[id as "openai" | "anthropic" | "gemini" | "openrouter"];
}

async function localProvider(definition: typeof providerDefinitions[number]): Promise<AIProviderInfo> {
  if (definition.id === "ollama") {
    const response = await getJson<{ models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string; context_length?: number } }> }>(`${definition.endpoint}/api/tags`);
    const models = (response.data?.models || []).flatMap((model) => model.name ? [{ id: model.name, name: model.name, sizeBytes: model.size, contextLength: model.details?.context_length, capabilities: ["chat", "generate"] }] : []);
    return { ...definition, configured: true, reachable: response.ok, available: response.ok && models.length > 0, models, reason: response.ok ? (models.length ? undefined : "Ollama is reachable but has no installed model.") : response.reason };
  }
  const response = await getJson<{ data?: Array<{ id?: string; context_length?: number }> }>(`${definition.endpoint}/v1/models`);
  const models = (response.data?.data || []).flatMap((model) => model.id ? [{ id: model.id, name: model.id, contextLength: model.context_length, capabilities: ["chat", "generate"] }] : []);
  return { ...definition, configured: true, reachable: response.ok, available: response.ok && models.length > 0, models, reason: response.ok ? (models.length ? undefined : `${definition.name} is reachable but reports no loaded model.`) : response.reason };
}

export async function listAIProviders(): Promise<AIProviderInfo[]> {
  return Promise.all(providerDefinitions.map(async (definition) => {
    if (definition.kind === "local") return localProvider(definition);
    const key = cloudEnvironmentKey(definition.id);
    const configured = Boolean(key && process.env[key]);
    return { ...definition, configured, reachable: false, available: false, models: [], reason: configured ? "Configured but not contacted until the user explicitly chooses cloud AI." : "Not configured." };
  }));
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const base: HardwareInfo = {
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    cpu: { model: os.cpus()[0]?.model || "Unknown CPU", cores: os.cpus().length, logicalProcessors: os.cpus().length },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    gpu: [],
    disk: { path: process.cwd() },
    collectedAt: new Date().toISOString(),
  };
  try {
    const stat = await fs.statfs(process.cwd());
    base.disk = { path: process.cwd(), availableBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) };
  } catch { /* disk metrics are intentionally omitted when the filesystem cannot expose them */ }
  if (process.platform === "win32") {
    try {
      const output = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 4_000 });
      const value: unknown = JSON.parse(output.stdout || "[]");
      const rows = Array.isArray(value) ? value : [value];
      base.gpu = rows.flatMap((row) => typeof row === "object" && row !== null ? [{ name: typeof (row as { Name?: unknown }).Name === "string" ? (row as { Name: string }).Name : "Unknown GPU", vramBytes: typeof (row as { AdapterRAM?: unknown }).AdapterRAM === "number" ? (row as { AdapterRAM: number }).AdapterRAM : undefined }] : []);
    } catch { /* hardware APIs are optional and must not produce invented GPU records */ }
  }
  return base;
}

export async function getModelCenter(workspaceRoot: string) {
  const [hardware, providers, settings] = await Promise.all([getHardwareInfo(), listAIProviders(), readSettings(workspaceRoot)]);
  const availableDisk = hardware.disk.availableBytes || 0;
  const recommendations = catalog.map((model) => {
    const enoughRam = hardware.memory.totalBytes >= model.estimatedRamBytes;
    const enoughDisk = availableDisk === 0 || availableDisk >= model.estimatedDownloadBytes * 1.25;
    return { ...model, compatible: enoughRam && enoughDisk, reason: !enoughRam ? `Requires about ${Math.ceil(model.estimatedRamBytes / 1_000_000_000)} GB RAM; this host reports ${Math.floor(hardware.memory.totalBytes / 1_000_000_000)} GB.` : !enoughDisk ? "Insufficient reported free disk space for the download and model cache." : "Fits the detected RAM and available disk budget." };
  });
  return { hardware, providers, active: settings.active, recommendations };
}

export async function setActiveModel(workspaceRoot: string, provider: AIProviderId, model: string) {
  const providers = await listAIProviders();
  const selected = providers.find((entry) => entry.id === provider);
  if (!selected || !selected.available || !selected.models.some((entry) => entry.id === model)) throw new Error("The selected provider/model is not currently available locally.");
  await writeSettings(workspaceRoot, { active: { provider, model } });
  return { provider, model };
}

function openAICompatibleRequest(endpoint: string, model: string, prompt: string) {
  return fetch(`${endpoint}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(90_000) });
}

export async function testAIConnection(workspaceRoot: string, requestedProvider?: AIProviderId, requestedModel?: string) {
  const settings = await readSettings(workspaceRoot);
  const providerId = requestedProvider || settings.active?.provider;
  const model = requestedModel || settings.active?.model;
  if (!providerId || !model) throw new Error("Select an installed local provider and model before testing AI.");
  const provider = (await listAIProviders()).find((entry) => entry.id === providerId);
  if (!provider || provider.kind !== "local" || !provider.available || !provider.models.some((entry) => entry.id === model)) throw new Error("The selected local provider/model is unavailable.");
  const prompt = "Analyze this simple TypeScript snippet and identify the type error: const count: number = 'three';";
  const started = performance.now();
  if (provider.id === "ollama") {
    const response = await fetch(`${provider.endpoint}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(90_000) });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) throw new Error(`Ollama test failed with HTTP ${response.status}.`);
    const data = await response.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    if (!data.message?.content?.trim()) throw new Error("Ollama returned no analysis content.");
    return { ok: true, provider: provider.id, model, latencyMs, promptTokens: data.prompt_eval_count, completionTokens: data.eval_count, output: data.message.content.trim() };
  }
  const response = await openAICompatibleRequest(provider.endpoint || "", model, prompt);
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`${provider.name} test failed with HTTP ${response.status}.`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const output = data.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error(`${provider.name} returned no analysis content.`);
  return { ok: true, provider: provider.id, model, latencyMs, promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens, output };
}

export async function installOllamaModel(pullName: string) {
  if (!/^[A-Za-z0-9._:-]+$/.test(pullName)) throw new Error("The requested Ollama model name is invalid.");
  try {
    const result = await execFileAsync(process.platform === "win32" ? "ollama.exe" : "ollama", ["pull", pullName], { windowsHide: true, timeout: 900_000, maxBuffer: 2_500_000 });
    return { ok: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim(), message: `Installed ${pullName}.` };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Ollama installation failed.";
    return { ok: false, output: detail, message: `Could not install ${pullName}.` };
  }
}

export async function generateWithLocalAI(workspaceRoot: string, system: string, user: string) {
  const settings = await readSettings(workspaceRoot);
  const providerId = settings.active?.provider;
  const model = settings.active?.model;
  if (!providerId || !model) throw new Error("No active local model is selected.");
  const provider = (await listAIProviders()).find((entry) => entry.id === providerId);
  if (!provider || provider.kind !== "local" || !provider.available) throw new Error("The active local model is unavailable.");
  if (provider.id === "ollama") {
    const response = await fetch(`${provider.endpoint}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Ollama generation failed with HTTP ${response.status}.`);
    const data = await response.json() as { message?: { content?: string } };
    const content = data.message?.content?.trim();
    if (!content) throw new Error("Ollama returned no content.");
    return { provider, model, content };
  }
  const response = await fetch(`${provider.endpoint}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${provider.name} generation failed with HTTP ${response.status}.`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`${provider.name} returned no content.`);
  return { provider, model, content };
}
