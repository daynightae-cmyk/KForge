import { promises as fs } from "fs";
import path from "path";
import { getModelCenter } from "./aiCenter";

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
  const providers: MarketplaceProviderStatus[] = [
    { id: "local-registry", label: "Local KForge Registry", state: "AVAILABLE", detail: "Reads locally registered extensions and installed runtime metadata only.", lastChecked: new Date().toISOString() },
    { id: "ollama-official", label: "Ollama official library", sourceUrl: "https://ollama.com/library", state: onlineOptional ? "DATA_UNAVAILABLE" : "OFFLINE", detail: onlineOptional ? "KForge has official source links but no configured official remote catalog adapter; it will not claim live versions or downloads." : "Remote marketplace data is disabled in Offline Mode.", lastChecked: new Date().toISOString() },
    { id: "extension-registries", label: "Extension registries", state: "DATA_UNAVAILABLE", detail: "No official extension registry has been configured. KForge shows no fabricated plugin, price, rating, or download data.", lastChecked: new Date().toISOString() },
  ];
  return { providers, items: [...installed, ...recommendations.filter((item) => !known.has(item.id)), ...registered] };
}

export async function previewMarketplaceInstall(workspaceRoot: string, onlineOptional: boolean, itemId: string) {
  const market = await getMarketplace(workspaceRoot, onlineOptional);
  const item = market.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Marketplace item was not found in the configured local or official registry.");
  if (item.installed) return { item, allowed: false, reason: "Item is already installed locally; use the local management action instead." };
  if (item.installAction !== "INSTALL_REQUIRES_CONFIRMATION") return { item, allowed: false, reason: onlineOptional ? "This item has no verified install adapter." : "Offline Mode blocks remote downloads until Online Optional is enabled." };
  return { item, allowed: true, reason: "Review source, license, permissions, compatibility, and resource requirements. Confirm before starting a download." };
}
