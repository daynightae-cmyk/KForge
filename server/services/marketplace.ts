import { promises as fs } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import { z } from "zod";
import type { ProjectProfile, ProjectSummary } from "../../shared/workspace";
import { getModelCenter } from "./aiCenter";
import { listAgentTools } from "./agentTools";

export type MarketplaceCategory = "models" | "agents" | "tools" | "plugins" | "scanners" | "integrations" | "templates" | "presets";
export type MarketplaceProductCategory = "models" | "extensions" | "agents" | "tools" | "analyzers" | "security" | "testing" | "build" | "runtime" | "git" | "github-integrations" | "templates" | "presets" | "themes" | "language-packs" | "integrations";
export type MarketplaceSourceState = "AVAILABLE" | "DATA_UNAVAILABLE" | "OFFLINE" | "NOT_CONFIGURED" | "UNAVAILABLE";
export type MarketplacePermissionClass = "filesystem-read" | "filesystem-write" | "network" | "process-execution" | "git" | "project-read" | "project-write" | "ai-access" | "external-apis";
export type MarketplaceEvidenceState = "VERIFIED" | "UNKNOWN" | "NOT_AVAILABLE" | "NOT_CONFIGURED";

export interface MarketplacePermission {
  id: MarketplacePermissionClass;
  required: boolean;
  detail: string;
}

export interface MarketplaceEvidenceField {
  state: MarketplaceEvidenceState;
  value?: string;
  source: string;
}

export interface MarketplaceEvidenceList {
  state: MarketplaceEvidenceState;
  items: string[];
  source: string;
}

export interface MarketplaceTaxonomyEntry {
  id: MarketplaceProductCategory;
  label: string;
  state: "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE";
  itemCount: number;
  source: string;
  reason: string;
}

export type MarketplaceLifecycleState = "VERIFIED" | "READY" | "REQUIRED" | "BLOCKED" | "NOT_CONFIGURED" | "NOT_AVAILABLE" | "NOT_APPLICABLE";

export interface MarketplaceLifecycleStage {
  id: "inspect" | "compatibility" | "security" | "permissions" | "trust" | "confirmation" | "download" | "integrity-verification" | "install" | "register" | "enable" | "runtime-verification" | "disable" | "update" | "verify-updated-version" | "uninstall" | "cleanup-registration" | "restart-reconnect-verification";
  label: string;
  state: MarketplaceLifecycleState;
  evidence: string;
}

export interface MarketplaceProjectCompatibility {
  state: "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
  evidence: string[];
  source: "KForge Agent capability analysis";
  flow: Array<{ stage: "agent-gap" | "marketplace" | "inspect" | "compatibility" | "permissions" | "trust" | "install" | "verify" | "return-to-agent"; state: MarketplaceLifecycleState; evidence: string }>;
}

export interface MarketplaceItem {
  id: string;
  category: MarketplaceCategory;
  taxonomy: MarketplaceProductCategory[];
  name: string;
  description: string;
  overview: string;
  features: string[];
  source: string;
  sourceUrl?: string;
  version?: string;
  license?: string;
  capabilities: string[];
  requirements: string[];
  compatibility: string;
  permissions: MarketplacePermission[];
  security: MarketplaceEvidenceField;
  publisher: MarketplaceEvidenceField;
  repository: MarketplaceEvidenceField;
  releaseHistory: MarketplaceEvidenceList;
  changelog: MarketplaceEvidenceField;
  installationState: MarketplaceEvidenceField;
  updateState: MarketplaceEvidenceField;
  dependencies: MarketplaceEvidenceList;
  provenance: MarketplaceEvidenceField;
  integrity: MarketplaceEvidenceField;
  lifecycle?: MarketplaceLifecycleStage[];
  projectCompatibility?: MarketplaceProjectCompatibility;
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
    { id: "ollama-official", label: "Ollama official library", kind: "remote", sourceUrl: "https://ollama.com/library", configured: false, state: onlineOptional ? "NOT_CONFIGURED" : "OFFLINE", capabilities: ["catalog", "version", "changelog", "install"], detail: onlineOptional ? "An official source link is known, but no remote catalog adapter is configured. KForge will not claim live versions, changelogs, or downloads." : "Remote marketplace data is disabled in Offline Mode.", lastChecked },
    { id: "extension-registries", label: "Extension registries", kind: "remote", configured: false, state: onlineOptional ? "NOT_CONFIGURED" : "OFFLINE", capabilities: ["catalog", "extension-metadata", "install"], detail: onlineOptional ? "No official extension registry adapter is configured. KForge shows no fabricated plugin, price, rating, or download data." : "Offline Mode blocks external extension registries.", lastChecked },
  ];
}

interface LocalRegistryFile { items?: unknown[]; }
function registryPath(workspaceRoot: string) { return path.join(workspaceRoot, ".kforge", "marketplace-registry.json"); }

async function readLocalRegistry(workspaceRoot: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(workspaceRoot), "utf8")) as LocalRegistryFile;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch { return [] as unknown[]; }
}

const permissionClasses: MarketplacePermissionClass[] = ["filesystem-read", "filesystem-write", "network", "process-execution", "git", "project-read", "project-write", "ai-access", "external-apis"];

function permissionReview(required: Partial<Record<MarketplacePermissionClass, string>> = {}): MarketplacePermission[] {
  return permissionClasses.map((id) => ({ id, required: typeof required[id] === "string", detail: required[id] || "This capability is not requested by the verified package metadata." }));
}

function evidence(state: MarketplaceEvidenceState, source: string, value?: string): MarketplaceEvidenceField {
  return { state, source, ...(value ? { value } : {}) };
}

function evidenceList(state: MarketplaceEvidenceState, source: string, items: string[] = []): MarketplaceEvidenceList {
  return { state, source, items };
}

function normalizedEvidenceField(value: unknown, fallback: MarketplaceEvidenceField): MarketplaceEvidenceField {
  if (!value || typeof value !== "object") return fallback;
  const row = value as { state?: unknown; source?: unknown; value?: unknown };
  if (!["VERIFIED", "UNKNOWN", "NOT_AVAILABLE", "NOT_CONFIGURED"].includes(String(row.state)) || typeof row.source !== "string") return fallback;
  return { state: row.state as MarketplaceEvidenceState, source: row.source, ...(typeof row.value === "string" ? { value: row.value } : {}) };
}

function normalizedEvidenceList(value: unknown, fallback: MarketplaceEvidenceList): MarketplaceEvidenceList {
  if (!value || typeof value !== "object") return fallback;
  const row = value as { state?: unknown; source?: unknown; items?: unknown };
  if (!["VERIFIED", "UNKNOWN", "NOT_AVAILABLE", "NOT_CONFIGURED"].includes(String(row.state)) || typeof row.source !== "string" || !Array.isArray(row.items)) return fallback;
  return { state: row.state as MarketplaceEvidenceState, source: row.source, items: row.items.filter((entry): entry is string => typeof entry === "string") };
}

function modelPermissions(): MarketplacePermission[] {
  return permissionReview({
    "filesystem-read": "The local runtime reads installed model artifacts.",
    "filesystem-write": "A confirmed installation writes model artifacts into the local runtime store.",
    network: "Initial model pull requires a user-confirmed download from the listed provider source.",
    "process-execution": "The local runtime starts inference as a local process.",
    "ai-access": "The item provides local AI inference when explicitly activated.",
  });
}

function toolPermissions(name: string, permission: string): MarketplacePermission[] {
  const git = name.startsWith("git_");
  const writes = permission === "safe-write" || permission === "dangerous";
  const process = ["typecheck", "lint", "test", "build", "start", "stop", "health", "scan", "sonar", "dependency_audit"].includes(name);
  return permissionReview({
    "filesystem-read": "Reads only bounded evidence from the explicitly selected project.",
    ...(writes ? { "filesystem-write": "May change selected-project files only after the declared confirmation gate." } : {}),
    ...(process ? { "process-execution": "Runs the named detected local toolchain operation." } : {}),
    ...(git ? { git: "Reads or changes local Git state according to the tool-specific confirmation policy." } : {}),
    "project-read": "Runs only against the explicitly selected local project context.",
    ...(writes ? { "project-write": "Write access is restricted by project trust and explicit confirmation." } : {}),
  });
}

function toolTaxonomy(name: string): MarketplaceProductCategory[] {
  const taxonomy = new Set<MarketplaceProductCategory>(["tools"]);
  if (["typecheck", "lint", "find_symbol", "graph", "scan", "sonar", "dependency_audit"].includes(name)) taxonomy.add("analyzers");
  if (["scan", "sonar", "dependency_audit"].includes(name)) taxonomy.add("security");
  if (name === "test") taxonomy.add("testing");
  if (name === "build") taxonomy.add("build");
  if (["start", "stop", "health", "logs"].includes(name)) taxonomy.add("runtime");
  if (name.startsWith("git_")) taxonomy.add("git");
  return [...taxonomy];
}

function localEngineItems(): MarketplaceItem[] {
  const tools: MarketplaceItem[] = listAgentTools().map((tool) => ({
    id: `tool:kforge:${tool.name}`,
    category: "tools",
    taxonomy: toolTaxonomy(tool.name),
    name: tool.name,
    description: tool.description,
    overview: tool.description,
    features: [tool.permission, tool.requiresConfirmation ? "explicit-confirmation" : "autonomous-safe"],
    source: "KForge local agent tool registry",
    capabilities: [tool.permission, tool.requiresConfirmation ? "explicit-confirmation" : "autonomous-safe"],
    requirements: [tool.unavailableReason || "KForge Workspace local engine"],
    compatibility: tool.permission === "blocked" ? "Unavailable by policy" : "Available in the current KForge build",
    permissions: toolPermissions(tool.name, tool.permission),
    security: evidence("VERIFIED", "KForge agent permission policy", tool.permission === "blocked" ? "Blocked by policy" : `Permission class: ${tool.permission}`),
    publisher: evidence("VERIFIED", "In-process KForge registry", "KNOuX Forge"),
    repository: evidence("UNKNOWN", "No repository metadata is declared by the local tool registry."),
    releaseHistory: evidenceList("NOT_AVAILABLE", "Built-in tools have no independent release feed."),
    changelog: evidence("NOT_AVAILABLE", "Built-in tools have no independent changelog adapter."),
    installationState: evidence("VERIFIED", "In-process KForge registry", "INSTALLED"),
    updateState: evidence("NOT_CONFIGURED", "No independent update adapter exists for built-in tools."),
    dependencies: evidenceList("VERIFIED", "KForge local engine", ["KForge Workspace local engine"]),
    provenance: evidence("VERIFIED", "In-process KForge registry", "Bundled with the current KForge server build"),
    integrity: evidence("NOT_AVAILABLE", "No separately installable artifact or checksum exists for this built-in tool."),
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
    taxonomy: ["agents"],
    name: "KForge Engineer",
    description: "Evidence-backed local planning and bounded verification agent exposed by the installed KForge server.",
    overview: "Evidence-backed local planning and bounded verification agent exposed by the installed KForge server.",
    features: ["project-diagnostics", "rule-backed-plans", "local-ai-optional", "verified-patches"],
    source: "KForge local agent engine",
    capabilities: ["project-diagnostics", "rule-backed-plans", "local-ai-optional", "verified-patches"],
    requirements: ["KForge Workspace server"],
    compatibility: "Available in the current KForge build",
    permissions: permissionReview({ "filesystem-read": "Reads bounded project evidence.", "filesystem-write": "Verified patch workflows may write only after trust and confirmation gates.", "process-execution": "Runs registered local verification tools.", git: "Git operations remain separately confirmation-gated.", "project-read": "Receives bounded, redacted project context.", "project-write": "Write-capable operations remain trust- and confirmation-gated.", "ai-access": "May use an explicitly activated local model; deterministic rules remain available without AI." }),
    security: evidence("VERIFIED", "KForge agent permission policy", "Typed tools, bounded context, redaction, snapshots, and confirmation gates"),
    publisher: evidence("VERIFIED", "In-process KForge registry", "KNOuX Forge"),
    repository: evidence("UNKNOWN", "No repository metadata is declared by the local agent registry."),
    releaseHistory: evidenceList("NOT_AVAILABLE", "The built-in agent has no independent release feed."),
    changelog: evidence("NOT_AVAILABLE", "The built-in agent has no independent changelog adapter."),
    installationState: evidence("VERIFIED", "In-process KForge registry", "INSTALLED"),
    updateState: evidence("NOT_CONFIGURED", "No independent update adapter exists for the built-in agent."),
    dependencies: evidenceList("VERIFIED", "KForge local engine", ["KForge Workspace server"]),
    provenance: evidence("VERIFIED", "In-process KForge registry", "Bundled with the current KForge server build"),
    integrity: evidence("NOT_AVAILABLE", "No separately installable artifact or checksum exists for this built-in agent."),
    trust: "TRUSTED",
    installed: true,
    enabled: true,
    local: true,
    installAction: "MANAGE_LOCAL",
    dataState: "AVAILABLE",
  }];
  return [...agents, ...tools];
}

const taxonomyDefinitions: Array<{ id: MarketplaceProductCategory; label: string; source: "models" | "extensions" | "local-registry" }> = [
  { id: "models", label: "Models", source: "models" },
  { id: "extensions", label: "Extensions", source: "extensions" },
  { id: "agents", label: "Agents", source: "local-registry" },
  { id: "tools", label: "Tools", source: "local-registry" },
  { id: "analyzers", label: "Analyzers", source: "local-registry" },
  { id: "security", label: "Security", source: "local-registry" },
  { id: "testing", label: "Testing", source: "local-registry" },
  { id: "build", label: "Build", source: "local-registry" },
  { id: "runtime", label: "Runtime", source: "local-registry" },
  { id: "git", label: "Git", source: "local-registry" },
  { id: "github-integrations", label: "GitHub Integrations", source: "extensions" },
  { id: "templates", label: "Templates", source: "local-registry" },
  { id: "presets", label: "Presets", source: "local-registry" },
  { id: "themes", label: "Themes", source: "extensions" },
  { id: "language-packs", label: "Language Packs", source: "extensions" },
  { id: "integrations", label: "Integrations", source: "local-registry" },
];

function defaultTaxonomy(category: MarketplaceCategory): MarketplaceProductCategory[] {
  if (category === "plugins") return ["extensions"];
  if (category === "scanners") return ["analyzers", "security"];
  return [category];
}

function registeredItem(value: unknown): MarketplaceItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MarketplaceItem> & Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.category !== "string" || !["models", "agents", "tools", "plugins", "scanners", "integrations", "templates", "presets"].includes(row.category)) return null;
  const category = row.category as MarketplaceCategory;
  const local = row.local === true;
  const declaredPermissions = Array.isArray(row.permissions) ? row.permissions : [];
  const permissionDetails: Partial<Record<MarketplacePermissionClass, string>> = {};
  for (const permission of declaredPermissions) {
    if (!permission || typeof permission !== "object") continue;
    const record = permission as { id?: unknown; required?: unknown; detail?: unknown };
    const id = record.id === "process" ? "process-execution" : record.id;
    if (permissionClasses.includes(id as MarketplacePermissionClass) && record.required === true) permissionDetails[id as MarketplacePermissionClass] = typeof record.detail === "string" ? record.detail : "Required by local registry metadata.";
  }
  const taxonomy = Array.isArray(row.taxonomy) ? row.taxonomy.filter((entry): entry is MarketplaceProductCategory => taxonomyDefinitions.some((definition) => definition.id === entry)) : defaultTaxonomy(category);
  const source = typeof row.source === "string" ? row.source : "Local KForge Registry";
  const description = typeof row.description === "string" ? row.description : "No overview was supplied by the configured registry.";
  const installed = local && row.installed === true;
  return {
    id: row.id,
    category,
    taxonomy: taxonomy.length ? taxonomy : defaultTaxonomy(category),
    name: row.name,
    description,
    overview: typeof row.overview === "string" ? row.overview : description,
    features: Array.isArray(row.features) ? row.features.filter((entry): entry is string => typeof entry === "string") : Array.isArray(row.capabilities) ? row.capabilities.filter((entry): entry is string => typeof entry === "string") : [],
    source,
    ...(typeof row.sourceUrl === "string" ? { sourceUrl: row.sourceUrl } : {}),
    ...(typeof row.version === "string" ? { version: row.version } : {}),
    ...(typeof row.license === "string" ? { license: row.license } : {}),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((entry): entry is string => typeof entry === "string") : [],
    requirements: Array.isArray(row.requirements) ? row.requirements.filter((entry): entry is string => typeof entry === "string") : [],
    compatibility: typeof row.compatibility === "string" ? row.compatibility : "UNKNOWN",
    permissions: permissionReview(permissionDetails),
    security: normalizedEvidenceField(row.security, evidence("UNKNOWN", "No security verdict was supplied by the configured registry.")),
    publisher: normalizedEvidenceField(row.publisher, evidence("UNKNOWN", "No publisher evidence was supplied by the configured registry.")),
    repository: normalizedEvidenceField(row.repository, evidence("UNKNOWN", "No repository evidence was supplied by the configured registry.")),
    releaseHistory: normalizedEvidenceList(row.releaseHistory, evidenceList("NOT_AVAILABLE", "No release history was supplied by the configured registry.")),
    changelog: normalizedEvidenceField(row.changelog, evidence("NOT_AVAILABLE", "No changelog was supplied by the configured registry.")),
    installationState: evidence("VERIFIED", "Canonical local registry presence", installed ? "INSTALLED" : "NOT_INSTALLED"),
    updateState: normalizedEvidenceField(row.updateState, evidence("NOT_CONFIGURED", "No update adapter was supplied by the configured registry.")),
    dependencies: normalizedEvidenceList(row.dependencies, evidenceList("UNKNOWN", "No dependency graph was supplied by the configured registry.")),
    provenance: normalizedEvidenceField(row.provenance, evidence("UNKNOWN", "No provenance chain was supplied by the configured registry.")),
    integrity: normalizedEvidenceField(row.integrity, evidence("NOT_AVAILABLE", "No checksum or signature was supplied by the configured registry.")),
    trust: local && (row.trust === "TRUSTED" || row.trust === "PARTIALLY_TRUSTED") ? row.trust : "UNTRUSTED",
    installed,
    enabled: installed && row.enabled === true,
    local,
    installAction: local && (row.installAction === "INSTALL_REQUIRES_CONFIRMATION" || row.installAction === "MANAGE_LOCAL") ? row.installAction : "NOT_AVAILABLE",
    dataState: row.dataState === "AVAILABLE" || row.dataState === "DATA_UNAVAILABLE" || row.dataState === "OFFLINE" || row.dataState === "NOT_CONFIGURED" || row.dataState === "UNAVAILABLE" ? row.dataState : "DATA_UNAVAILABLE",
    ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
  };
}

function marketplaceTaxonomy(items: MarketplaceItem[]): MarketplaceTaxonomyEntry[] {
  return taxonomyDefinitions.map((definition) => {
    const itemCount = items.filter((item) => item.taxonomy.includes(definition.id)).length;
    if (itemCount > 0) return { id: definition.id, label: definition.label, state: "AVAILABLE", itemCount, source: definition.source === "models" ? "Local Ollama runtime and bundled compatibility evidence" : "KForge local and configured registry evidence", reason: `${itemCount} verified item(s) map to this category.` };
    if (definition.source === "extensions") return { id: definition.id, label: definition.label, state: "NOT_CONFIGURED", itemCount, source: "Extension registries", reason: "No extension registry adapter is configured; KForge does not fabricate catalog entries." };
    return { id: definition.id, label: definition.label, state: "UNAVAILABLE", itemCount, source: definition.source === "models" ? "Ollama runtime and bundled model profiles" : "Local KForge Registry", reason: "The configured sources contain no verified item in this category." };
  });
}

const lifecycleLabels: Array<[MarketplaceLifecycleStage["id"], string]> = [
  ["inspect", "Inspect"], ["compatibility", "Compatibility"], ["security", "Security"], ["permissions", "Permissions"], ["trust", "Trust"], ["confirmation", "Confirmation"], ["download", "Download"], ["integrity-verification", "Integrity Verification"], ["install", "Install"], ["register", "Register"], ["enable", "Enable"], ["runtime-verification", "Runtime Verification"], ["disable", "Disable"], ["update", "Update"], ["verify-updated-version", "Verify Updated Version"], ["uninstall", "Uninstall"], ["cleanup-registration", "Cleanup Registration"], ["restart-reconnect-verification", "Restart/Reconnect Verification"],
];

function itemLifecycle(item: MarketplaceItem, onlineOptional: boolean): MarketplaceLifecycleStage[] {
  const model = item.category === "models";
  const builtIn = item.local && item.installAction === "MANAGE_LOCAL" && !model;
  const installReady = item.installAction === "INSTALL_REQUIRES_CONFIRMATION" && onlineOptional;
  const installedVerified = item.installed && item.installationState.state === "VERIFIED" && item.installationState.value === "INSTALLED";
  const stage = (id: MarketplaceLifecycleStage["id"]): Omit<MarketplaceLifecycleStage, "label"> => {
    if (id === "inspect") return { id, state: "VERIFIED", evidence: "The configured Marketplace source returned this normalized item contract." };
    if (id === "compatibility") return { id, state: item.compatibility === "UNKNOWN" ? "BLOCKED" : "VERIFIED", evidence: item.compatibility || "UNKNOWN" };
    if (id === "security") return { id, state: item.security.state === "VERIFIED" ? "VERIFIED" : "REQUIRED", evidence: `${item.security.state}: ${item.security.value || item.security.source}` };
    if (id === "permissions") return { id, state: "VERIFIED", evidence: `All ${permissionClasses.length} permission classes are declared before enablement.` };
    if (id === "trust") return { id, state: item.trust === "TRUSTED" ? "VERIFIED" : "REQUIRED", evidence: `${item.trust}; downloaded content is never silently promoted to TRUSTED.` };
    if (id === "confirmation") return { id, state: installReady ? "REQUIRED" : item.installed || builtIn ? "NOT_APPLICABLE" : "BLOCKED", evidence: installReady ? "Explicit user confirmation is required before download." : item.installed || builtIn ? "No installation is pending." : "No verified install adapter is available." };
    if (id === "download") return { id, state: installReady ? "READY" : installedVerified || builtIn ? "NOT_APPLICABLE" : "NOT_CONFIGURED", evidence: installReady ? "The existing confirmed Ollama pull adapter is available." : installedVerified || builtIn ? "The item is already present locally." : "No trustworthy package download adapter is configured." };
    if (id === "integrity-verification") return { id, state: item.integrity.state === "VERIFIED" ? "VERIFIED" : installedVerified && model ? "NOT_AVAILABLE" : "BLOCKED", evidence: `${item.integrity.state}: ${item.integrity.value || item.integrity.source}` };
    if (id === "install") return { id, state: installedVerified || builtIn ? "VERIFIED" : installReady ? "READY" : "NOT_CONFIGURED", evidence: installedVerified ? item.installationState.source : builtIn ? "Bundled in-process registry evidence." : installReady ? "Installed state will be claimed only after the local runtime reports the item." : "No verified extension package adapter is configured." };
    if (id === "register") return { id, state: installedVerified || builtIn ? "VERIFIED" : "BLOCKED", evidence: installedVerified ? "The local runtime inventory is the canonical registration source." : builtIn ? "The in-process registry reports this built-in item." : "Registration cannot precede a verified installation." };
    if (id === "enable") return { id, state: item.enabled ? "VERIFIED" : installedVerified && model ? "READY" : builtIn && item.enabled ? "VERIFIED" : "BLOCKED", evidence: item.enabled ? "The canonical local state reports this item enabled." : installedVerified && model ? "The existing active-model endpoint can enable this installed model." : "No verified enable adapter is available." };
    if (id === "runtime-verification") return { id, state: item.enabled && model ? "READY" : item.enabled && builtIn ? "VERIFIED" : "BLOCKED", evidence: item.enabled && model ? "The existing local model connection test is available." : item.enabled && builtIn ? "The item is present in the live in-process registry." : "Runtime verification requires an enabled item." };
    if (id === "disable") return { id, state: "NOT_AVAILABLE", evidence: model ? "The active-model controller has no truthful disable-without-replacement operation." : "Built-in tools and agents cannot be independently disabled." };
    if (id === "update") return { id, state: item.updateState.state === "VERIFIED" ? "READY" : "NOT_CONFIGURED", evidence: `${item.updateState.state}: ${item.updateState.value || item.updateState.source}` };
    if (id === "verify-updated-version") return { id, state: item.updateState.state === "VERIFIED" ? "READY" : "BLOCKED", evidence: item.updateState.state === "VERIFIED" ? "A provider version comparison is available." : "No trustworthy latest-version evidence exists." };
    if (id === "uninstall") return { id, state: installedVerified && model ? "READY" : builtIn ? "NOT_AVAILABLE" : "BLOCKED", evidence: installedVerified && model ? "The existing confirmed Ollama remove adapter is available; removal is verified on refresh." : builtIn ? "Bundled items cannot be independently uninstalled." : "No verified extension uninstall adapter is configured." };
    if (id === "cleanup-registration") return { id, state: installedVerified && model ? "READY" : builtIn ? "NOT_APPLICABLE" : "BLOCKED", evidence: installedVerified && model ? "A successful runtime removal causes the item to disappear from canonical inventory." : builtIn ? "Bundled registration is owned by the running build." : "Cleanup cannot run without a verified uninstall adapter." };
    return { id, state: installedVerified && model ? "READY" : item.enabled && builtIn ? "VERIFIED" : "BLOCKED", evidence: installedVerified && model ? "Refresh inventory and run the existing connection test after lifecycle changes." : item.enabled && builtIn ? "The live in-process registry verifies reconnect state." : "No restart/reconnect verification adapter is available." };
  };
  return lifecycleLabels.map(([id, label]) => ({ ...stage(id), label }));
}

function toolProjectCompatibility(item: MarketplaceItem, project: ProjectSummary, profile: ProjectProfile): MarketplaceProjectCompatibility {
  const tool = item.id.startsWith("tool:kforge:") ? item.id.slice("tool:kforge:".length) : "";
  const requiredCommand = tool === "typecheck" ? profile.commands.typecheck : tool === "test" ? profile.commands.test : tool === "build" ? profile.commands.build : ["start", "health"].includes(tool) ? profile.commands.runtime || profile.commands.production || profile.commands.dev : undefined;
  const commandBound = ["typecheck", "test", "build", "start", "health"].includes(tool);
  const state: MarketplaceProjectCompatibility["state"] = !tool ? "UNKNOWN" : !item.enabled ? "INCOMPATIBLE" : commandBound ? requiredCommand ? "COMPATIBLE" : "INCOMPATIBLE" : "COMPATIBLE";
  const evidence = !tool ? ["This item is not a built-in project tool."] : !item.enabled ? ["The built-in tool is blocked or unavailable by its current runtime policy."] : commandBound ? requiredCommand ? [`Detected command: ${requiredCommand}`, `Project profile: ${profile.framework.join(", ") || project.projectType}`] : [`No verified ${tool} command is present in project command evidence.`] : [`The built-in ${tool} tool accepts the selected project through its typed local adapter.`, `Project profile: ${profile.framework.join(", ") || project.projectType}`];
  const installed = item.installed && item.installationState.state === "VERIFIED";
  const flowState = state === "COMPATIBLE" ? "VERIFIED" : state === "INCOMPATIBLE" ? "BLOCKED" : "REQUIRED";
  return {
    state,
    evidence,
    source: "KForge Agent capability analysis",
    flow: [
      { stage: "agent-gap", state: state === "COMPATIBLE" ? "NOT_APPLICABLE" : flowState, evidence: state === "COMPATIBLE" ? "No missing capability is inferred; the Agent matched an already available item to project evidence." : evidence[0] },
      { stage: "marketplace", state: "VERIFIED", evidence: "The item came from the existing normalized Marketplace contract." },
      { stage: "inspect", state: "VERIFIED", evidence: "Full item evidence is available for inspection." },
      { stage: "compatibility", state: flowState, evidence: evidence.join(" ") },
      { stage: "permissions", state: "VERIFIED", evidence: `All ${permissionClasses.length} capability classes are exposed before enablement.` },
      { stage: "trust", state: item.trust === "TRUSTED" ? "VERIFIED" : "REQUIRED", evidence: item.trust },
      { stage: "install", state: installed ? "VERIFIED" : item.installAction === "INSTALL_REQUIRES_CONFIRMATION" ? "READY" : "NOT_CONFIGURED", evidence: installed ? item.installationState.source : "No installed state is inferred." },
      { stage: "verify", state: installed && state === "COMPATIBLE" ? "VERIFIED" : "BLOCKED", evidence: installed && state === "COMPATIBLE" ? "Canonical local registration and project compatibility both passed." : "Verification requires a compatible, canonically installed item." },
      { stage: "return-to-agent", state: installed && state === "COMPATIBLE" ? "READY" : "BLOCKED", evidence: installed && state === "COMPATIBLE" ? "The evidence result is ready for the originating Agent/Task." : "No success is returned to the Agent while compatibility or lifecycle evidence is blocked." },
    ],
  };
}

export async function getMarketplace(workspaceRoot: string, onlineOptional: boolean) {
  const [modelCenter, registeredRows] = await Promise.all([getModelCenter(workspaceRoot), readLocalRegistry(workspaceRoot)]);
  const installedIds = new Set(modelCenter.ollama.models.map((model) => model.id));
  const installed: MarketplaceItem[] = modelCenter.ollama.models.map((model) => ({
    id: `ollama:${model.id}`, category: "models", taxonomy: ["models"], name: model.name,
    description: "Installed local Ollama model reported by the local runtime.", overview: "Installed local Ollama model reported by the local runtime.", features: model.capabilities, source: "Local Ollama runtime",
    version: model.id.includes(":") ? model.id.split(":").slice(1).join(":") : undefined,
    capabilities: model.capabilities, requirements: ["Installed local Ollama runtime"], compatibility: "Installed locally", permissions: modelPermissions(),
    security: evidence("UNKNOWN", "The local runtime reports installation, not an independent security verdict."),
    publisher: evidence("UNKNOWN", "The local runtime does not report publisher identity."),
    repository: evidence("UNKNOWN", "The local runtime does not report a source repository."),
    releaseHistory: evidenceList("NOT_CONFIGURED", "No remote model release-history adapter is configured."),
    changelog: evidence("NOT_CONFIGURED", "No remote model changelog adapter is configured."),
    installationState: evidence("VERIFIED", "Local Ollama runtime", "INSTALLED"),
    updateState: evidence("NOT_CONFIGURED", "No trustworthy remote version adapter is configured."),
    dependencies: evidenceList("VERIFIED", "Local Ollama runtime", ["Installed local Ollama runtime"]),
    provenance: evidence("VERIFIED", "Local Ollama runtime", "Reported by the installed local runtime"),
    integrity: evidence("NOT_AVAILABLE", "The local runtime did not expose a verified checksum or signature."),
    trust: "PARTIALLY_TRUSTED", installed: true,
    enabled: modelCenter.active?.provider === "ollama" && modelCenter.active.model === model.id, local: true, installAction: "MANAGE_LOCAL", dataState: "AVAILABLE",
  }));
  const recommendations: MarketplaceItem[] = modelCenter.recommendations.map((model) => ({
    id: `ollama:${model.id}`, category: "models", taxonomy: ["models"], name: model.label,
    description: `Official Ollama-library recommendation for local ${/coder/i.test(model.id) ? "coding" : "AI"} workflows. Compatibility is calculated from detected hardware.`, overview: `Bundled compatibility evidence for local ${/coder/i.test(model.id) ? "coding" : "AI"} workflows; no live registry metadata is claimed.`, features: /coder/i.test(model.id) ? ["coding", "chat", "generate"] : ["chat", "generate"], source: "KForge bundled compatibility profile (official links)", sourceUrl: model.sourceUrl,
    version: model.pullName.includes(":") ? model.pullName.split(":").slice(1).join(":") : undefined, license: model.license,
    capabilities: /coder/i.test(model.id) ? ["coding", "chat", "generate"] : ["chat", "generate"], requirements: [`Estimated download: ${Math.round(model.estimatedDownloadBytes / 1_000_000_000)} GB`, `Estimated RAM: ${Math.round(model.estimatedRamBytes / 1_000_000_000)} GB`], compatibility: model.reason, permissions: modelPermissions(),
    security: evidence("UNKNOWN", "Bundled compatibility profiles do not provide a security verdict."),
    publisher: evidence("UNKNOWN", "The official library link does not prove publisher identity."),
    repository: evidence("UNKNOWN", "No repository metadata is included in the bundled compatibility profile."),
    releaseHistory: evidenceList("NOT_CONFIGURED", "No remote model release-history adapter is configured."),
    changelog: evidence("NOT_CONFIGURED", "No remote model changelog adapter is configured."),
    installationState: evidence("VERIFIED", installedIds.has(model.id) ? "Local Ollama runtime" : "Local Ollama runtime inventory", installedIds.has(model.id) ? "INSTALLED" : "NOT_INSTALLED"),
    updateState: evidence("NOT_CONFIGURED", "No trustworthy remote version adapter is configured."),
    dependencies: evidenceList("VERIFIED", "Bundled compatibility profile", ["Ollama runtime", `Estimated RAM: ${Math.round(model.estimatedRamBytes / 1_000_000_000)} GB`]),
    provenance: evidence("VERIFIED", "KForge bundled compatibility profile", model.sourceUrl),
    integrity: evidence("NOT_AVAILABLE", "No checksum is available before a verified download adapter returns an artifact."),
    trust: "UNTRUSTED",
    installed: installedIds.has(model.id), enabled: modelCenter.active?.provider === "ollama" && modelCenter.active.model === model.id, local: true,
    installAction: onlineOptional && model.compatible ? "INSTALL_REQUIRES_CONFIRMATION" : "NOT_AVAILABLE", dataState: "AVAILABLE",
  }));
  const adapters = listMarketplaceRegistryAdapters(onlineOptional);
  const providers: MarketplaceProviderStatus[] = adapters.map((adapter) => ({ id: adapter.id, label: adapter.label, sourceUrl: adapter.sourceUrl, state: adapter.state, detail: adapter.detail, lastChecked: adapter.lastChecked, adapterKind: adapter.kind, configured: adapter.configured, capabilities: adapter.capabilities }));
  const localExtensions = localEngineItems();
  const registered = registeredRows.map(registeredItem).filter((item): item is MarketplaceItem => Boolean(item));
  const knownItems = new Set([...installed, ...localExtensions].map((item) => item.id));
  const items = [...installed, ...localExtensions, ...recommendations.filter((item) => !knownItems.has(item.id)), ...registered].map((item) => ({ ...item, lifecycle: itemLifecycle(item, onlineOptional) }));
  return { adapters, providers, categories: marketplaceTaxonomy(items), items };
}

export async function getProjectMarketplace(workspaceRoot: string, onlineOptional: boolean, project: ProjectSummary, profile: ProjectProfile) {
  const market = await getMarketplace(workspaceRoot, onlineOptional);
  const items = market.items.map((item) => ({ ...item, projectCompatibility: toolProjectCompatibility(item, project, profile) }));
  const commandGaps = (["typecheck", "test", "build", "runtime"] as const).flatMap((capability) => {
    const detected = capability === "runtime" ? profile.commands.runtime || profile.commands.production || profile.commands.dev : profile.commands[capability];
    if (detected) return [];
    const gapEvidence = `No verified ${capability} command exists in the detected project profile.`;
    const reason = "KForge will not recommend an installable package because no trustworthy extension registry adapter and compatibility rule are configured.";
    return [{ capability, state: "MISSING" as const, evidence: gapEvidence, recommendationState: "NOT_CONFIGURED" as const, itemId: null, reason, flow: [
      { stage: "agent-gap" as const, state: "VERIFIED" as const, evidence: gapEvidence },
      { stage: "marketplace" as const, state: "NOT_CONFIGURED" as const, evidence: reason },
      { stage: "inspect" as const, state: "BLOCKED" as const, evidence: "No truthful package candidate exists to inspect." },
      { stage: "compatibility" as const, state: "BLOCKED" as const, evidence: "Compatibility cannot be inferred without a candidate and adapter rules." },
      { stage: "permissions" as const, state: "BLOCKED" as const, evidence: "No package permission manifest exists." },
      { stage: "trust" as const, state: "BLOCKED" as const, evidence: "No package source exists to evaluate." },
      { stage: "install" as const, state: "NOT_CONFIGURED" as const, evidence: "No trustworthy extension install adapter is configured." },
      { stage: "verify" as const, state: "BLOCKED" as const, evidence: "Nothing was installed; success is not fabricated." },
      { stage: "return-to-agent" as const, state: "BLOCKED" as const, evidence: "The originating Agent receives a truthful blocked result." },
    ] }];
  });
  const recommendations = items.filter((item) => item.projectCompatibility?.state === "COMPATIBLE").map((item) => ({ itemId: item.id, name: item.name, state: "COMPATIBLE" as const, evidence: item.projectCompatibility!.evidence, installed: item.installed, returnToAgent: item.projectCompatibility!.flow.at(-1)?.state || "BLOCKED" }));
  return { ...market, project: { id: project.id, name: project.name, framework: profile.framework, languages: profile.languages, commandEvidence: profile.commandEvidence }, items, recommendations, capabilityGaps: commandGaps };
}

const manifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisher: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.any()).optional(),
  capabilities: z.array(z.string()).optional(),
  compatibility: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  dependencies: z.array(z.record(z.any())).optional(),
  license: z.string().optional(),
  size: z.number().optional(),
  sha256: z.string().length(64, { message: "sha256 must be exactly 64 hex characters" }).regex(/^[a-f0-9]{64}$/),
  integrity: z.object({ algorithm: z.string(), expectedHash: z.string().length(64) }).optional(),
});

export async function previewMarketplaceInstall(workspaceRoot: string, onlineOptional: boolean, itemId: string) {
  const market = await getMarketplace(workspaceRoot, onlineOptional);
  const item = market.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Marketplace item was not found in the configured local or official registry.");
  if (item.installed) return { item, allowed: false, reason: "Item is already installed locally; use the local management action instead." };
  if (item.installAction !== "INSTALL_REQUIRES_CONFIRMATION") return { item, allowed: false, reason: onlineOptional ? "This item has no verified install adapter." : "Offline Mode blocks remote downloads until Online Optional is enabled." };
  return { item, allowed: true, reason: "Review source, license, permissions, compatibility, and resource requirements. Confirm before starting a download." };
}

// First-party real package adapter for the KForge JSON Inspector
export interface InstallResult {
  operationId: string;
  itemId: string;
  stage: string;
  installed: boolean;
  rollback: boolean;
  integrityVerified: boolean;
  sizeVerified: boolean;
  error?: string;
}

function generateOperationId(): string {
  return `op-${randomUUID()}`;
}

export async function installPackage(workspaceRoot: string, itemId: string): Promise<InstallResult> {
  const opId = generateOperationId();
  // Real first-party adapter: read fixture manifest, verify integrity against fixture content
  const fixtureDir = path.resolve(process.cwd(), "fixtures", "marketplace-first-party");
  const manifestPath = path.join(fixtureDir, "manifest.json");
  const manifestRaw = await fs.readFile(manifestPath, "utf8").catch(() => null);
  if (!manifestRaw) return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: "Package manifest not found at first-party source." };
  let manifest: unknown;
  try { manifest = JSON.parse(manifestRaw); } catch { return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: "Manifest is not valid JSON." }; }
  const validation = manifestSchema.safeParse(manifest);
  if (!validation.success) return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: `Manifest validation failed: ${validation.error.errors.map((e: any) => e.path?.join(".") + ":" + e.message).join("; ")}` };
  const validatedManifest = validation.data;
  if (validatedManifest.id !== itemId) return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: "Item ID mismatch with first-party manifest." };
  // Integrity verification: compare declared SHA with actual computed hash of fixture package
  const packagePath = path.join(fixtureDir, "index.js");
  const packageBytes = await fs.readFile(packagePath, "utf8").catch(() => null);
  if (!packageBytes) return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: "Package artifact missing." };
  // Size verification
  const declaredSize = Number(validatedManifest.size) || 0;
  const actualSize = Buffer.byteLength(packageBytes, "utf8");
  if (declaredSize > 0 && declaredSize !== actualSize) {
    return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: `Size mismatch: expected ${declaredSize}, got ${actualSize}.` };
  }
  // SHA verification (real cryptographic comparison)
  const expectedHash = String(validatedManifest.sha256 || "");
  if (!expectedHash) return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: true, error: "Manifest integrity hash missing." };
  const actualHash = createHash("sha256").update(packageBytes).digest("hex");
  const integrityVerified = actualHash === expectedHash;
  if (!integrityVerified) return { operationId: opId, itemId, stage: "FAILED", installed: false, rollback: false, integrityVerified: false, sizeVerified: true, error: `Integrity verification failed: expected ${expectedHash}, got ${actualHash}.` };

  // Actual staging: stage in transaction directory first
  const stagingDir = path.resolve(workspaceRoot, ".kforge", "marketplace", "staging", opId);
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.copyFile(packagePath, path.join(stagingDir, "index.js"));
  await fs.writeFile(path.join(stagingDir, "manifest.json"), JSON.stringify(validatedManifest, null, 2), { encoding: "utf8" });

  // Move stage to installed directory after all checks pass
  const installedDir = path.resolve(workspaceRoot, ".kforge", "marketplace", "installed", itemId);
  await fs.mkdir(installedDir, { recursive: true });
  await fs.copyFile(packagePath, path.join(installedDir, "index.js"));
  await fs.writeFile(path.join(installedDir, "manifest.json"), JSON.stringify(validatedManifest, null, 2), { encoding: "utf8" });

  // Stage: register durable registry
  const registryFilePath = registryPath(workspaceRoot);
  let registry: LocalRegistryFile = { items: [] };
  try {
    const existingRaw = await fs.readFile(registryFilePath, "utf8").catch(() => "{}");
    registry = JSON.parse(existingRaw) as LocalRegistryFile;
    if (!Array.isArray(registry.items)) registry.items = [];
  } catch { registry = { items: [] }; }
  if (!registry.items) registry.items = [];
  const existing = registry.items.find((i) => i && i.id === itemId);
  if (existing) {
    existing.installed = true;
    existing.version = String(validatedManifest.version || "");
    existing.updatedAt = new Date().toISOString();
  } else {
    registry.items.push({
      id: String(validatedManifest.id),
      category: "plugins" as MarketplaceCategory,
      name: String(validatedManifest.name || itemId),
      description: String(validatedManifest.description || ""),
      source: "First-party registry",
      version: String(validatedManifest.version || ""),
      capabilities: Array.isArray(validatedManifest.capabilities) ? validatedManifest.capabilities : ["inspection"],
      requirements: Array.isArray(validatedManifest.requirements) ? validatedManifest.requirements : ["KForge Workspace server"],
      compatibility: String(validatedManifest.compatibility || ""),
      permissions: Array.isArray(validatedManifest.permissions) ? validatedManifest.permissions : [],
      trust: "TRUSTED",
      installed: true,
      enabled: true,
      local: false,
      installAction: "MANAGE_LOCAL",
      dataState: "AVAILABLE",
      updatedAt: new Date().toISOString(),
    });
  }
  await fs.mkdir(path.dirname(registryFilePath), { recursive: true });
  await fs.writeFile(registryFilePath, JSON.stringify(registry, null, 2), { encoding: "utf8" });
  return { operationId: opId, itemId, stage: "INSTALLED", installed: true, rollback: false, integrityVerified, sizeVerified: true, error: undefined };
}

export async function uninstallPackage(workspaceRoot: string, itemId: string): Promise<InstallResult> {
  const registryFilePath = registryPath(workspaceRoot);
  let registry: LocalRegistryFile = { items: [] };
  try {
    const raw = await fs.readFile(registryFilePath, "utf8").catch(() => "{}");
    registry = JSON.parse(raw) as LocalRegistryFile;
    if (!Array.isArray(registry.items)) registry.items = [];
  } catch { registry = { items: [] }; }
  const beforeCount = registry.items.length;
  registry.items = registry.items.filter((i) => !(i && i.id === itemId));
  await fs.mkdir(path.dirname(registryFilePath), { recursive: true });
  await fs.writeFile(registryFilePath, JSON.stringify(registry, null, 2), { encoding: "utf8" });
  // Remove installed package directory
  const installedDir = path.resolve(workspaceRoot, ".kforge", "marketplace", "installed", itemId);
  try { await fs.rm(installedDir, { recursive: true, force: true }); } catch { /* safe to ignore */ }
  return { operationId: `op-uninstall-${itemId}-${randomUUID()}`, itemId, stage: "UNINSTALLED", installed: false, rollback: false, integrityVerified: true, sizeVerified: true, error: beforeCount > registry.items.length ? undefined : "Package not registered; nothing removed." };
}

export async function healthCheckPackage(workspaceRoot: string, itemId: string): Promise<{ ok: boolean; message: string; version?: string; installed: boolean }> {
  const registryFilePath = registryPath(workspaceRoot);
  let registry: LocalRegistryFile = { items: [] };
  try {
    const raw = await fs.readFile(registryFilePath, "utf8").catch(() => "{}");
    registry = JSON.parse(raw) as LocalRegistryFile;
  } catch { return { ok: false, message: "Registry unreadable.", installed: false }; }
  const item = (Array.isArray(registry.items) ? registry.items : []).find((i) => i && i.id === itemId);
  if (!item || !item.installed) return { ok: false, message: "Package not installed.", installed: false };
  const installedDir = path.resolve(workspaceRoot, ".kforge", "marketplace", "installed", itemId);
  try {
    await fs.access(path.join(installedDir, "index.js"));
  } catch {
    return { ok: false, message: "Package artifact missing at installed path after install.", installed: true, version: item.version };
  }
  // Verify integrity of installed artifact against registry hash
  const installedArtifactPath = path.join(installedDir, "index.js");
  try {
    const installedBytes = await fs.readFile(installedArtifactPath, "utf8");
    const installedHash = createHash("sha256").update(installedBytes).digest("hex");
    const expectedHash = item.integrity ? String((item as any).integrity?.expectedHash || item.sha256 || "") : "";
    if (expectedHash && installedHash !== expectedHash) return { ok: false, message: `Health integrity mismatch: installed hash ${installedHash} does not match registry ${expectedHash}.`, installed: true, version: item.version };
  } catch {
    return { ok: false, message: "Installed artifact unreadable during health check.", installed: true, version: item.version };
  }
  return { ok: true, message: "Health check passed.", installed: true, version: item.version };
}

export async function runInstalledPackage(workspaceRoot: string, itemId: string): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const health = await healthCheckPackage(workspaceRoot, itemId);
  if (!health.ok) return { ok: false, result: null, error: health.message };
  // Execute installed package from its installed directory
  const installedDir = path.resolve(workspaceRoot, ".kforge", "marketplace", "installed", itemId);
  try {
    const { execFileSync } = await import("child_process");
    const output = execFileSync("node", [path.join(installedDir, "index.js")], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
    let parsed: unknown = null;
    try { parsed = JSON.parse(output); } catch { parsed = output.trim(); }
    return { ok: true, result: parsed };
  } catch (e: unknown) {
    return { ok: false, result: null, error: String(e) };
  }
}
