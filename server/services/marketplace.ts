import { promises as fs } from "fs";
import path from "path";
import { getModelCenter } from "./aiCenter";
import { listAgentTools } from "./agentTools";

export type MarketplaceCategory = "models" | "agents" | "tools" | "plugins" | "scanners" | "integrations" | "templates" | "presets";
export type MarketplaceSourceState = "AVAILABLE" | "DATA_UNAVAILABLE" | "OFFLINE";

export interface MarketplacePermission {
  id: "project-read" | "project-write" | "network" | "process" | "git";
  required: boolean;
  detail: string;
}

export interface MarketplaceItem {
  id: string;
  category: MarketplaceCategory;
  name: string;
  description: string;
  source: string;
  sourceUrl?: string;
  version?: string;
  license?: string;
  capabilities: string[];
  requirements: string[];
  compatibility: string;
  permissions: MarketplacePermission[];
  trust: "TRUSTED" | "UNTRUSTED" | "PARTIALLY_TRUSTED";
  installed: boolean;
  enabled: boolean;
  local: boolean;
  installAction: "INSTALL_REQUIRES_CONFIRMATION" | "NOT_AVAILABLE" | "MANAGE_LOCAL";
  dataState: MarketplaceSourceState;
  updatedAt?: string;
}

export interface MarketplaceProviderStatus {
  id: string;
  label: string;
  sourceUrl?: string;
  state: MarketplaceSourceState;
  detail: string;
  lastChecked: string;
  adapterKind?: "local" | "remote";
  configured?: boolean;
  capabilities?: string[];
}

export interface MarketplaceRegistryAdapter {
  id: string;
  label: string;
  kind: "local" | "remote";
  sourceUrl?: string;
  configured: boolean;
  state: MarketplaceSourceState;
  capabilities: Array<"catalog" | "version" | "changelog" | "install" | "extension-metadata">;
  detail: string;
  lastChecked: string;
}

export function listMarketplaceRegistryAdapters(onlineOptional: boolean): MarketplaceRegistryAdapter[] {
  const lastChecked = new Date().toISOString();
  return [
    { id: "local-registry", label: "Local KForge Registry", kind: "local", configured: true, state: "AVAILABLE", capabilities: ["catalog", "extension-metadata"], detail: "Reads locally registered extensions and installed runtime metadata only.", lastChecked },
    { id: "ollama-official", label: "Ollama official library", kind: "remote", sourceUrl: "https://ollama.com/library", configured: false, state: onlineOptional ? "DATA_UNAVAILABLE" : "OFFLINE", capabilities: ["catalog", "version", "changelog", "install"], detail: onlineOptional ? "An official source link is known, but no remote catalog adapter is configured. KForge will not claim live versions, changelogs, or downloads." : "Remote marketplace data is disabled in Offline Mode.", lastChecked },
    { id: "extension-registries", label: "Extension registries", kind: "remote", configured: false, state: onlineOptional ? "DATA_UNAVAILABLE" : "OFFLINE", capabilities: ["catalog", "extension-metadata", "install"], detail: onlineOptional ? "No official extension registry adapter is configured. KForge shows no fabricated plugin, price, rating, or download data." : "Offline Mode blocks external extension registries.", lastChecked },
  ];
}

interface LocalRegistryFile { items?: MarketplaceItem[]; }
function registryPath(workspaceRoot: string) { return path.join(workspaceRoot, ".kforge", "marketplace-registry.json"); }

async function readLocalRegistry(workspaceRoot: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(workspaceRoot), "utf8")) as LocalRegistryFile;
    return Array.isArray(parsed.items) ? parsed.items.filter((item) => item && typeof item.id === "string") : [];
  } catch { return [] as MarketplaceItem[]; }
}

function modelPermissions(): MarketplacePermission[] {
  return [
    { id: "project-read", required: false, detail: "Bounded, redacted project context is only supplied by an explicitly selected local AI workflow." },
    { id: "network", required: true, detail: "Initial model pull requires a user-confirmed download from the listed provider source." },
    { id: "process", required: true, detail: "The local runtime starts inference as a local process." },
  ];
}

function localExtensionPermissions(): MarketplacePermission[] {
  return [{ id: "project-read", required: true, detail: "Runs only against the explicitly selected local project context." }, { id: "process", required: false, detail: "No process access unless the individual capability declares it." }];
}

function localEngineItems(): MarketplaceItem[] {
  const tools: MarketplaceItem[] = listAgentTools().map((tool) => ({
    id: `tool:kforge:${tool.name}`,
    category: "tools",
    name: tool.name,
    description: tool.description,
    source: "KForge local agent tool registry",
    capabilities: [tool.permission, tool.requiresConfirmation ? "explicit-confirmation" : "autonomous-safe"],
    requirements: [tool.unavailableReason || "KForge Workspace local engine"],
    compatibility: tool.permission === "blocked" ? "Unavailable by policy" : "Available in the current KForge build",
    permissions: localExtensionPermissions(),
    trust: tool.permission === "blocked" ? "PARTIALLY_TRUSTED" : "TRUSTED",
    installed: true,
    enabled: tool.permission !== "blocked",
    local: true,
    installAction: "MANAGE_LOCAL",
    dataState: "AVAILABLE",
  }));
  const agents: MarketplaceItem[] = [{
    id: "agent:kforge:engineer",
    category: "agents",
    name: "KForge Engineer",
    description: "Evidence-backed local planning and bounded verification agent exposed by the installed KForge server.",
    source: "KForge local agent engine",
    capabilities: ["project-diagnostics", "rule-backed-plans", "local-ai-optional", "verified-patches"],
    requirements: ["KForge Workspace server"],
    compatibility: "Available in the current KForge build",
    permissions: [{ id: "project-read", required: true, detail: "Receives bounded, redacted project context." }, { id: "project-write", required: true, detail: "Write-capable operations remain trust- and confirmation-gated." }],
    trust: "TRUSTED",
    installed: true,
    enabled: true,
    local: true,
    installAction: "MANAGE_LOCAL",
    dataState: "AVAILABLE",
  }];
  return [...agents, ...tools];
}

export async function getMarketplace(workspaceRoot: string, onlineOptional: boolean) {
  const [modelCenter, registered] = await Promise.all([getModelCenter(workspaceRoot), readLocalRegistry(workspaceRoot)]);
  const installedIds = new Set(modelCenter.ollama.models.map((model) => model.id));
  const installed: MarketplaceItem[] = modelCenter.ollama.models.map((model) => ({
    id: `ollama:${model.id}`, category: "models", name: model.name,
    description: "Installed local Ollama model reported by the local runtime.", source: "Local Ollama runtime",
    version: model.id.includes(":") ? model.id.split(":").slice(1).join(":") : undefined,
    capabilities: model.capabilities, requirements: ["Installed local Ollama runtime"], compatibility: "Installed locally", permissions: modelPermissions(), trust: "TRUSTED", installed: true,
    enabled: modelCenter.active?.provider === "ollama" && modelCenter.active.model === model.id, local: true, installAction: "MANAGE_LOCAL", dataState: "AVAILABLE",
  }));
  const recommendations: MarketplaceItem[] = modelCenter.recommendations.map((model) => ({
    id: `ollama:${model.id}`, category: "models", name: model.label,
    description: `Official Ollama-library recommendation for local ${/coder/i.test(model.id) ? "coding" : "AI"} workflows. Compatibility is calculated from detected hardware.`, source: "KForge local model catalog (official links)", sourceUrl: model.sourceUrl,
    version: model.pullName.includes(":") ? model.pullName.split(":").slice(1).join(":") : undefined, license: model.license,
    capabilities: /coder/i.test(model.id) ? ["coding", "chat", "generate"] : ["chat", "generate"], requirements: [`Estimated download: ${Math.round(model.estimatedDownloadBytes / 1_000_000_000)} GB`, `Estimated RAM: ${Math.round(model.estimatedRamBytes / 1_000_000_000)} GB`], compatibility: model.reason, permissions: modelPermissions(), trust: "PARTIALLY_TRUSTED",
    installed: installedIds.has(model.id), enabled: modelCenter.active?.provider === "ollama" && modelCenter.active.model === model.id, local: true,
    installAction: onlineOptional && model.compatible ? "INSTALL_REQUIRES_CONFIRMATION" : "NOT_AVAILABLE", dataState: "AVAILABLE",
  }));
  const known = new Set(installed.map((item) => item.id));
  const adapters = listMarketplaceRegistryAdapters(onlineOptional);
  const providers: MarketplaceProviderStatus[] = adapters.map((adapter) => ({ id: adapter.id, label: adapter.label, sourceUrl: adapter.sourceUrl, state: adapter.state, detail: adapter.detail, lastChecked: adapter.lastChecked, adapterKind: adapter.kind, configured: adapter.configured, capabilities: adapter.capabilities }));
  const localExtensions = localEngineItems();
  const knownItems = new Set([...installed, ...localExtensions].map((item) => item.id));
  return { adapters, providers, items: [...installed, ...localExtensions, ...recommendations.filter((item) => !knownItems.has(item.id)), ...registered] };
}

export async function previewMarketplaceInstall(workspaceRoot: string, onlineOptional: boolean, itemId: string) {
  const market = await getMarketplace(workspaceRoot, onlineOptional);
  const item = market.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Marketplace item was not found in the configured local or official registry.");
  if (item.installed) return { item, allowed: false, reason: "Item is already installed locally; use the local management action instead." };
  if (item.installAction !== "INSTALL_REQUIRES_CONFIRMATION") return { item, allowed: false, reason: onlineOptional ? "This item has no verified install adapter." : "Offline Mode blocks remote downloads until Online Optional is enabled." };
  return { item, allowed: true, reason: "Review source, license, permissions, compatibility, and resource requirements. Confirm before starting a download." };
}
