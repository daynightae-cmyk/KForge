import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { randomUUID, createHash } from "crypto";
import { promisify } from "util";
import { z } from "zod";
import type { OnlineActionEligibility, OnlineAuthorityEvidence, OnlineAvailabilityState, OnlineRuntimeEvidence, ProjectProfile, ProjectSummary } from "../../shared/workspace";
import { getModelCenter } from "./aiCenter";
import { listAgentTools } from "./agentTools";

const execFileAsync = promisify(execFile);

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
  authority: OnlineAuthorityEvidence;
  availability: OnlineAvailabilityState;
  detectedAt?: string;
  checkedAt: string;
  freshness: { state: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN"; at: string | null };
  runtimeEvidence: OnlineRuntimeEvidence;
  healthState: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN" | "NOT_EVALUATED";
  actionEligibility: OnlineActionEligibility;
  unavailableReason?: string;
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
  authority: OnlineAuthorityEvidence;
  availability: OnlineAvailabilityState;
  checkedAt: string;
  freshness: { state: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN"; at: string | null };
  runtimeEvidence: OnlineRuntimeEvidence;
  healthState: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN" | "NOT_EVALUATED";
  actionEligibility: OnlineActionEligibility;
  unavailableReason?: string;
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

type RegistryItem = Record<string, unknown>;
interface LocalRegistryFile {
  schemaVersion: 1;
  items: RegistryItem[];
}

const permissionClasses: MarketplacePermissionClass[] = ["filesystem-read", "filesystem-write", "network", "process-execution", "git", "project-read", "project-write", "ai-access", "external-apis"];
const packageIdPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const registrySchema = z.object({ schemaVersion: z.literal(1).optional(), items: z.array(z.record(z.unknown())).optional() });
const manifestPermissionSchema = z.object({ id: z.string().min(1), required: z.boolean(), detail: z.string().min(1) });
const manifestDependencySchema = z.object({ id: z.string().min(1), version: z.string().optional() }).passthrough();
const manifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publisher: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  permissions: z.array(manifestPermissionSchema).optional(),
  capabilities: z.array(z.string()).optional(),
  compatibility: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  dependencies: z.array(manifestDependencySchema).optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  downloadUrl: z.string().optional(),
  size: z.number().int().positive(),
  sha256: z.string().length(64, { message: "sha256 must be exactly 64 hex characters" }).regex(/^[a-f0-9]{64}$/),
  integrity: z.object({ algorithm: z.literal("sha256"), expectedHash: z.string().length(64).regex(/^[a-f0-9]{64}$/) }).optional(),
  runtimeRequirements: z.object({
    kforgeVersion: z.string().optional(),
    os: z.array(z.enum(["linux", "darwin", "win32"])).optional(),
    commands: z.array(z.string()).optional(),
  }).optional(),
}).passthrough();

type PackageManifest = z.infer<typeof manifestSchema>;

function evidence(state: MarketplaceEvidenceState, source: string, value?: string): MarketplaceEvidenceField {
  return { state, source, ...(value ? { value } : {}) };
}

function evidenceList(state: MarketplaceEvidenceState, source: string, items: string[] = []): MarketplaceEvidenceList {
  return { state, source, items };
}

type MarketplaceItemDraft = Omit<MarketplaceItem, "authority" | "availability" | "detectedAt" | "checkedAt" | "freshness" | "runtimeEvidence" | "healthState" | "actionEligibility" | "unavailableReason">;

function withAuthority(item: MarketplaceItemDraft, checkedAt = new Date().toISOString()): MarketplaceItem {
  const catalogOnly = item.category === "models" && !item.installed && /compatibility profile/i.test(item.source);
  const cachedRemote = !item.local && (/cache/i.test(item.source) || item.dataState === "DATA_UNAVAILABLE");
  const builtIn = /^tool:kforge:|^agent:kforge:/.test(item.id);
  const authority: OnlineAuthorityEvidence = catalogOnly ? { kind: "CATALOG_ONLY" }
    : cachedRemote ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" }
      : builtIn ? { kind: "LOCAL_BUNDLED" }
        : item.installed ? { kind: "LOCAL_INSTALLED" }
          : item.local ? { kind: "LOCAL_REGISTRY" }
            : { kind: "REMOTE_REGISTRY" };
  const availability: OnlineAvailabilityState = item.enabled && item.category === "models" ? "RUNNING" : builtIn && item.enabled ? "AVAILABLE" : item.installed ? "INSTALLED" : catalogOnly ? "CATALOG" : item.local ? "NOT_INSTALLED" : item.dataState === "OFFLINE" ? "OFFLINE" : item.dataState === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNKNOWN";
  const installEnabled = item.installAction === "INSTALL_REQUIRES_CONFIRMATION";
  const manageEnabled = item.installAction === "MANAGE_LOCAL" && item.installed;
  const unavailableReason = availability === "AVAILABLE" || availability === "INSTALLED" || availability === "RUNNING" || installEnabled || manageEnabled ? undefined : catalogOnly ? "Catalog metadata is not local runtime inventory." : item.installAction === "NOT_AVAILABLE" ? "No verified installation or execution adapter is available." : undefined;
  const actions = [
    { id: "inspect", enabled: true, requiresConfirmation: false },
    { id: "install", enabled: installEnabled, requiresConfirmation: installEnabled, ...(!installEnabled ? { reason: item.installed ? "Already installed." : unavailableReason || "Install adapter unavailable." } : {}) },
    { id: "manage", enabled: manageEnabled, requiresConfirmation: manageEnabled, ...(!manageEnabled ? { reason: item.installed ? "No management adapter is registered." : "Item is not installed." } : {}) },
  ];
  return {
    ...item,
    authority,
    availability,
    ...(item.installed ? { detectedAt: checkedAt } : {}),
    checkedAt,
    freshness: { state: cachedRemote ? "CACHED" : authority.kind.startsWith("LOCAL_") ? "CURRENT" : "UNKNOWN", at: cachedRemote || authority.kind.startsWith("LOCAL_") ? checkedAt : null },
    runtimeEvidence: item.installed || builtIn ? { state: "VERIFIED", sources: [item.installationState.source, item.source] } : catalogOnly ? { state: "NOT_AVAILABLE", sources: ["Bundled catalog profile only; no runtime inventory match."] } : { state: "UNKNOWN", sources: [item.installationState.source] },
    healthState: item.enabled ? "HEALTHY" : item.installed ? "NOT_EVALUATED" : "UNAVAILABLE",
    actionEligibility: { state: installEnabled || manageEnabled ? "REQUIRES_CONFIRMATION" : "DISABLED", actions, ...(unavailableReason ? { unavailableReason } : {}) },
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

function permissionReview(required: Partial<Record<MarketplacePermissionClass, string>> = {}): MarketplacePermission[] {
  return permissionClasses.map((id) => ({ id, required: typeof required[id] === "string", detail: required[id] || "This capability is not requested by the verified package metadata." }));
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

function safePackageId(itemId: string): string {
  if (!packageIdPattern.test(itemId) || itemId.includes("..") || itemId.includes("/") || itemId.includes("\\")) throw new Error("Invalid package ID. Package IDs must be bounded identifiers and cannot contain traversal segments or path separators.");
  return itemId;
}

function packageStorageKey(itemId: string): string {
  safePackageId(itemId);
  return createHash("sha256").update(itemId).digest("hex");
}

function workspaceRootPath(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function marketplaceRoot(workspaceRoot: string): string {
  return path.join(workspaceRootPath(workspaceRoot), ".kforge", "marketplace");
}

function registryPath(workspaceRoot: string): string {
  return path.join(workspaceRootPath(workspaceRoot), ".kforge", "marketplace-registry.json");
}

function installedPackageDir(workspaceRoot: string, itemId: string): string {
  return path.join(marketplaceRoot(workspaceRoot), "installed", packageStorageKey(itemId));
}

function ensureContained(base: string, candidate: string): string {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedBase, resolvedCandidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return resolvedCandidate;
  throw new Error("Package source path escapes the approved first-party fixture root.");
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readRegistry(workspaceRoot: string): Promise<LocalRegistryFile> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(registryPath(workspaceRoot), "utf8"));
    const validation = registrySchema.safeParse(parsed);
    if (!validation.success) return { schemaVersion: 1, items: [] };
    return { schemaVersion: 1, items: validation.data.items || [] };
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

async function readLocalRegistry(workspaceRoot: string): Promise<RegistryItem[]> {
  return (await readRegistry(workspaceRoot)).items;
}

function registryItemId(item: RegistryItem): string | null {
  return typeof item.id === "string" ? item.id : null;
}

function findRegistryItem(registry: LocalRegistryFile, itemId: string): RegistryItem | undefined {
  return registry.items.find((item) => registryItemId(item) === itemId);
}

function normalizedManifestPermissions(manifest: PackageManifest): MarketplacePermission[] {
  const required: Partial<Record<MarketplacePermissionClass, string>> = {};
  for (const permission of manifest.permissions || []) {
    const normalizedId = permission.id === "process" ? "process-execution" : permission.id;
    if (!permissionClasses.includes(normalizedId as MarketplacePermissionClass)) throw new Error(`Unknown permission '${permission.id}' in package manifest.`);
    if (permission.required) required[normalizedId as MarketplacePermissionClass] = permission.detail;
  }
  return permissionReview(required);
}

function permissionsForRegistryRow(row: RegistryItem): MarketplacePermission[] {
  const required: Partial<Record<MarketplacePermissionClass, string>> = {};
  const declared = Array.isArray(row.permissions) ? row.permissions : [];
  for (const permission of declared) {
    if (!permission || typeof permission !== "object") continue;
    const record = permission as { id?: unknown; required?: unknown; detail?: unknown };
    const normalizedId = record.id === "process" ? "process-execution" : record.id;
    if (permissionClasses.includes(normalizedId as MarketplacePermissionClass) && record.required === true) required[normalizedId as MarketplacePermissionClass] = typeof record.detail === "string" ? record.detail : "Required by persisted package metadata.";
  }
  return permissionReview(required);
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
  const tools: MarketplaceItem[] = listAgentTools().map((tool) => withAuthority({
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
    enabled: tool.status === "AVAILABLE" || tool.status === "AVAILABLE_WITH_CONFIRMATION",
    local: true,
    installAction: "MANAGE_LOCAL",
    dataState: "AVAILABLE",
  }));

  const agents: MarketplaceItem[] = [withAuthority({
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
  })];

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

function semverParts(value: string): [number, number, number] {
  const [major, minor, patchValue] = value.split(".").map((part) => Number(part));
  return [major || 0, minor || 0, patchValue || 0];
}

function compareSemver(left: string, right: string): number {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function registeredItem(value: unknown): MarketplaceItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as RegistryItem;
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.category !== "string" || !["models", "agents", "tools", "plugins", "scanners", "integrations", "templates", "presets"].includes(row.category)) return null;
  const category = row.category as MarketplaceCategory;
  const local = row.local === true;
  const installed = local && row.installed === true;
  const taxonomy = Array.isArray(row.taxonomy) ? row.taxonomy.filter((entry): entry is MarketplaceProductCategory => typeof entry === "string" && taxonomyDefinitions.some((definition) => definition.id === entry)) : defaultTaxonomy(category);
  const source = typeof row.source === "string" ? row.source : "Local KForge Registry";
  const description = typeof row.description === "string" ? row.description : "No overview was supplied by the configured registry.";
  const rawHash = typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256) ? row.sha256 : undefined;
  const integrityField = normalizedEvidenceField(row.integrity, rawHash ? evidence("VERIFIED", "Persisted installed package checksum", `sha256:${rawHash}`) : evidence("NOT_AVAILABLE", "No checksum or signature was supplied by the configured registry."));
  const localVerifiedTrust = installed && integrityField.state === "VERIFIED";
  const trust: MarketplaceItem["trust"] = localVerifiedTrust && row.trust === "TRUSTED" ? "TRUSTED" : local && row.trust === "PARTIALLY_TRUSTED" ? "PARTIALLY_TRUSTED" : "UNTRUSTED";
  return withAuthority({
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
    permissions: permissionsForRegistryRow(row),
    security: normalizedEvidenceField(row.security, evidence("UNKNOWN", "No security verdict was supplied by the configured registry.")),
    publisher: normalizedEvidenceField(row.publisher, evidence("UNKNOWN", "No publisher evidence was supplied by the configured registry.")),
    repository: normalizedEvidenceField(row.repository, evidence("UNKNOWN", "No repository evidence was supplied by the configured registry.")),
    releaseHistory: normalizedEvidenceList(row.releaseHistory, evidenceList("NOT_AVAILABLE", "No release history was supplied by the configured registry.")),
    changelog: normalizedEvidenceField(row.changelog, evidence("NOT_AVAILABLE", "No changelog was supplied by the configured registry.")),
    installationState: evidence("VERIFIED", "Canonical local registry presence", installed ? "INSTALLED" : "NOT_INSTALLED"),
    updateState: normalizedEvidenceField(row.updateState, evidence("NOT_CONFIGURED", "No update adapter was supplied by the configured registry.")),
    dependencies: normalizedEvidenceList(row.dependencies, evidenceList("UNKNOWN", "No dependency graph was supplied by the configured registry.")),
    provenance: normalizedEvidenceField(row.provenance, evidence("UNKNOWN", "No provenance chain was supplied by the configured registry.")),
    integrity: integrityField,
    trust,
    installed,
    enabled: installed && row.enabled === true,
    local,
    installAction: local && (row.installAction === "INSTALL_REQUIRES_CONFIRMATION" || row.installAction === "MANAGE_LOCAL") ? row.installAction : "NOT_AVAILABLE",
    dataState: row.dataState === "AVAILABLE" || row.dataState === "DATA_UNAVAILABLE" || row.dataState === "OFFLINE" || row.dataState === "NOT_CONFIGURED" || row.dataState === "UNAVAILABLE" ? row.dataState : "DATA_UNAVAILABLE",
    ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
  });
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
  const builtIn = item.id.startsWith("tool:kforge:") || item.id.startsWith("agent:kforge:");
  const managedPackage = item.id.startsWith("package:");
  const localInstallReady = managedPackage && item.local && !item.installed && item.installAction === "INSTALL_REQUIRES_CONFIRMATION";
  const remoteInstallReady = item.installAction === "INSTALL_REQUIRES_CONFIRMATION" && !item.local && onlineOptional;
  const installReady = localInstallReady || remoteInstallReady;
  const installedVerified = item.installed && item.installationState.state === "VERIFIED" && item.installationState.value === "INSTALLED";
  const updateAvailable = item.updateState.state === "VERIFIED" && item.updateState.value?.startsWith("UPDATE_AVAILABLE") === true;
  const stage = (id: MarketplaceLifecycleStage["id"]): Omit<MarketplaceLifecycleStage, "label"> => {
    if (id === "inspect") return { id, state: "VERIFIED", evidence: "The configured Marketplace source returned this normalized item contract." };
    if (id === "compatibility") return { id, state: item.compatibility === "UNKNOWN" ? "BLOCKED" : "VERIFIED", evidence: item.compatibility || "UNKNOWN" };
    if (id === "security") return { id, state: item.security.state === "VERIFIED" ? "VERIFIED" : "REQUIRED", evidence: `${item.security.state}: ${item.security.value || item.security.source}` };
    if (id === "permissions") return { id, state: "VERIFIED", evidence: `All ${permissionClasses.length} permission classes are declared before enablement.` };
    if (id === "trust") return { id, state: item.trust === "TRUSTED" ? "VERIFIED" : item.installed ? "REQUIRED" : "REQUIRED", evidence: `${item.trust}; downloaded or bundled content is never silently promoted to TRUSTED without integrity evidence.` };
    if (id === "confirmation") return { id, state: installReady ? "REQUIRED" : item.installed || builtIn ? "NOT_APPLICABLE" : "BLOCKED", evidence: installReady ? "Explicit user confirmation is required before installation." : item.installed || builtIn ? "No installation is pending." : "No verified install adapter is available." };
    if (id === "download") return { id, state: localInstallReady ? "NOT_APPLICABLE" : remoteInstallReady ? "READY" : installedVerified || builtIn ? "NOT_APPLICABLE" : "NOT_CONFIGURED", evidence: localInstallReady ? "The first-party artifact is bundled locally; no network download is required." : remoteInstallReady ? "A user-confirmed remote adapter is available." : installedVerified || builtIn ? "The item is already present locally." : "No trustworthy package download adapter is configured." };
    if (id === "integrity-verification") return { id, state: item.integrity.state === "VERIFIED" ? "VERIFIED" : installReady ? "READY" : installedVerified && model ? "NOT_AVAILABLE" : "BLOCKED", evidence: `${item.integrity.state}: ${item.integrity.value || item.integrity.source}` };
    if (id === "install") return { id, state: installedVerified || builtIn ? "VERIFIED" : installReady ? "READY" : "NOT_CONFIGURED", evidence: installedVerified ? item.installationState.source : builtIn ? "Bundled in-process registry evidence." : installReady ? "Installation state is claimed only after artifact verification and durable registration." : "No verified install adapter is configured." };
    if (id === "register") return { id, state: installedVerified || builtIn ? "VERIFIED" : installReady ? "READY" : "BLOCKED", evidence: installedVerified ? "Canonical local registry reports the installed item." : builtIn ? "The in-process registry reports this built-in item." : installReady ? "Registration follows verified installation and uses atomic state persistence." : "Registration cannot precede a verified installation." };
    if (id === "enable") return { id, state: item.enabled ? "VERIFIED" : installedVerified && model ? "READY" : managedPackage && installedVerified ? "READY" : "BLOCKED", evidence: item.enabled ? "The canonical local state reports this item enabled." : installedVerified && model ? "The existing active-model endpoint can enable this installed model." : managedPackage && installedVerified ? "A verified installed package may be enabled by a future permission-aware controller." : "No verified enable adapter is available." };
    if (id === "runtime-verification") return { id, state: managedPackage && installedVerified ? "READY" : item.enabled && model ? "READY" : item.enabled && builtIn ? "VERIFIED" : "BLOCKED", evidence: managedPackage && installedVerified ? "The installed-package health adapter verifies manifest, size, SHA-256 and executable artifact before run." : item.enabled && model ? "The existing local model connection test is available." : item.enabled && builtIn ? "The item is present in the live in-process registry." : "Runtime verification requires an installed or enabled item." };
    if (id === "disable") return { id, state: managedPackage && installedVerified ? "NOT_CONFIGURED" : "NOT_AVAILABLE", evidence: managedPackage && installedVerified ? "Independent package disable/enable persistence is intentionally not exposed until a permission-aware controller is implemented." : model ? "The active-model controller has no truthful disable-without-replacement operation." : "Built-in tools and agents cannot be independently disabled." };
    if (id === "update") return { id, state: updateAvailable ? "READY" : item.updateState.state === "VERIFIED" ? "NOT_APPLICABLE" : "NOT_CONFIGURED", evidence: `${item.updateState.state}: ${item.updateState.value || item.updateState.source}` };
    if (id === "verify-updated-version") return { id, state: updateAvailable || (managedPackage && installedVerified) ? "READY" : item.updateState.state === "VERIFIED" ? "VERIFIED" : "BLOCKED", evidence: managedPackage && installedVerified ? "Installed manifest and checksum are re-read after update." : item.updateState.state === "VERIFIED" ? "A provider version comparison is available." : "No trustworthy latest-version evidence exists." };
    if (id === "uninstall") return { id, state: managedPackage && installedVerified ? "READY" : installedVerified && model ? "READY" : builtIn ? "NOT_AVAILABLE" : "BLOCKED", evidence: managedPackage && installedVerified ? "The installed package can be transactionally removed after explicit confirmation." : installedVerified && model ? "The existing confirmed Ollama remove adapter is available; removal is verified on refresh." : builtIn ? "Bundled items cannot be independently uninstalled." : "No verified uninstall adapter is configured." };
    if (id === "cleanup-registration") return { id, state: managedPackage && installedVerified ? "READY" : installedVerified && model ? "READY" : builtIn ? "NOT_APPLICABLE" : "BLOCKED", evidence: managedPackage && installedVerified ? "Uninstall removes durable registry state only after filesystem staging succeeds." : installedVerified && model ? "A successful runtime removal causes the item to disappear from canonical inventory." : builtIn ? "Bundled registration is owned by the running build." : "Cleanup cannot run without a verified uninstall adapter." };
    return { id, state: managedPackage && installedVerified ? "READY" : installedVerified && model ? "READY" : item.enabled && builtIn ? "VERIFIED" : "BLOCKED", evidence: managedPackage && installedVerified ? "Reload Marketplace state and run the installed-package health adapter after lifecycle changes." : installedVerified && model ? "Refresh inventory and run the existing connection test after lifecycle changes." : item.enabled && builtIn ? "The live in-process registry verifies reconnect state." : "No restart/reconnect verification adapter is available." };
  };
  return lifecycleLabels.map(([id, label]) => ({ ...stage(id), label }));
}

function toolProjectCompatibility(item: MarketplaceItem, project: ProjectSummary, profile: ProjectProfile): MarketplaceProjectCompatibility {
  const tool = item.id.startsWith("tool:kforge:") ? item.id.slice("tool:kforge:".length) : "";
  const requiredCommand = tool === "typecheck" ? profile.commands.typecheck : tool === "test" ? profile.commands.test : tool === "build" ? profile.commands.build : ["start", "health"].includes(tool) ? profile.commands.runtime || profile.commands.production || profile.commands.dev : undefined;
  const commandBound = ["typecheck", "test", "build", "start", "health"].includes(tool);
  const state: MarketplaceProjectCompatibility["state"] = !tool ? "UNKNOWN" : !item.enabled ? "INCOMPATIBLE" : commandBound ? requiredCommand ? "COMPATIBLE" : "INCOMPATIBLE" : "COMPATIBLE";
  const evidenceRows = !tool ? ["This item is not a built-in project tool."] : !item.enabled ? ["The built-in tool is blocked or unavailable by its current runtime policy."] : commandBound ? requiredCommand ? [`Detected command: ${requiredCommand}`, `Project profile: ${profile.framework.join(", ") || project.projectType}`] : [`No verified ${tool} command is present in project command evidence.`] : [`The built-in ${tool} tool accepts the selected project through its typed local adapter.`, `Project profile: ${profile.framework.join(", ") || project.projectType}`];
  const installed = item.installed && item.installationState.state === "VERIFIED";
  const flowState = state === "COMPATIBLE" ? "VERIFIED" : state === "INCOMPATIBLE" ? "BLOCKED" : "REQUIRED";
  return {
    state,
    evidence: evidenceRows,
    source: "KForge Agent capability analysis",
    flow: [
      { stage: "agent-gap", state: state === "COMPATIBLE" ? "NOT_APPLICABLE" : flowState, evidence: state === "COMPATIBLE" ? "No missing capability is inferred; the Agent matched an already available item to project evidence." : evidenceRows[0] },
      { stage: "marketplace", state: "VERIFIED", evidence: "The item came from the existing normalized Marketplace contract." },
      { stage: "inspect", state: "VERIFIED", evidence: "Full item evidence is available for inspection." },
      { stage: "compatibility", state: flowState, evidence: evidenceRows.join(" ") },
      { stage: "permissions", state: "VERIFIED", evidence: `All ${permissionClasses.length} capability classes are exposed before enablement.` },
      { stage: "trust", state: item.trust === "TRUSTED" ? "VERIFIED" : "REQUIRED", evidence: item.trust },
      { stage: "install", state: installed ? "VERIFIED" : item.installAction === "INSTALL_REQUIRES_CONFIRMATION" ? "READY" : "NOT_CONFIGURED", evidence: installed ? item.installationState.source : "No installed state is inferred." },
      { stage: "verify", state: installed && state === "COMPATIBLE" ? "VERIFIED" : "BLOCKED", evidence: installed && state === "COMPATIBLE" ? "Canonical local registration and project compatibility both passed." : "Verification requires a compatible, canonically installed item." },
      { stage: "return-to-agent", state: installed && state === "COMPATIBLE" ? "READY" : "BLOCKED", evidence: installed && state === "COMPATIBLE" ? "The evidence result is ready for the originating Agent/Task." : "No success is returned to the Agent while compatibility or lifecycle evidence is blocked." },
    ],
  };
}

export function listMarketplaceRegistryAdapters(onlineOptional: boolean): MarketplaceRegistryAdapter[] {
  const lastChecked = new Date().toISOString();
  return [
    { id: "local-registry", label: "Local KForge Registry", kind: "local", configured: true, state: "AVAILABLE", capabilities: ["catalog", "extension-metadata", "install", "version"], detail: "Reads locally registered extensions plus the bundled first-party package lifecycle adapter.", lastChecked },
    { id: "ollama-official", label: "Ollama official library", kind: "remote", sourceUrl: "https://ollama.com/library", configured: false, state: onlineOptional ? "NOT_CONFIGURED" : "OFFLINE", capabilities: ["catalog", "version", "changelog", "install"], detail: onlineOptional ? "An official source link is known, but no remote catalog adapter is configured. KForge will not claim live versions, changelogs, or downloads." : "Remote marketplace data is disabled in Offline Mode.", lastChecked },
    { id: "extension-registries", label: "Extension registries", kind: "remote", configured: false, state: onlineOptional ? "NOT_CONFIGURED" : "OFFLINE", capabilities: ["catalog", "extension-metadata", "install"], detail: onlineOptional ? "No remote third-party extension registry adapter is configured. KForge shows only locally evidenced or bundled first-party packages." : "Offline Mode blocks external extension registries.", lastChecked },
  ];
}

function firstPartyFixturesRoot(): string {
  return path.resolve(process.cwd(), "fixtures");
}

function firstPartyManifestPath(version: "1.0.0" | "1.1.0"): string {
  return path.join(firstPartyFixturesRoot(), version === "1.0.0" ? "marketplace-first-party" : "marketplace-first-party-v110", "manifest.json");
}

async function loadManifestFromApprovedSource(manifestPath: string): Promise<{ manifest: PackageManifest; directory: string }> {
  const approvedPath = ensureContained(firstPartyFixturesRoot(), manifestPath);
  const raw = await fs.readFile(approvedPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const validation = manifestSchema.safeParse(parsed);
  if (!validation.success) throw new Error(`Manifest validation failed: ${validation.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`).join("; ")}`);
  normalizedManifestPermissions(validation.data);
  if (validation.data.integrity && validation.data.integrity.expectedHash !== validation.data.sha256) throw new Error("Manifest integrity.expectedHash does not match sha256.");
  return { manifest: validation.data, directory: path.dirname(approvedPath) };
}

async function verifyManifestCompatibility(manifest: PackageManifest, registry: LocalRegistryFile): Promise<void> {
  if (manifest.runtimeRequirements?.os?.length && !manifest.runtimeRequirements.os.includes(process.platform as "linux" | "darwin" | "win32")) throw new Error(`Package is incompatible with operating system '${process.platform}'.`);
  for (const command of manifest.runtimeRequirements?.commands || []) {
    if (command !== "node") throw new Error(`Runtime command '${command}' is not verified by the first-party lifecycle adapter.`);
  }
  for (const dependency of manifest.dependencies || []) {
    const installed = findRegistryItem(registry, dependency.id);
    if (!installed || installed.installed !== true) throw new Error(`Dependency '${dependency.id}' is not installed.`);
    if (dependency.version && typeof installed.version === "string" && installed.version !== dependency.version) throw new Error(`Dependency '${dependency.id}' requires version '${dependency.version}', but '${installed.version}' is installed.`);
  }
}

async function verifyArtifact(manifest: PackageManifest, directory: string): Promise<{ artifactPath: string; bytes: Buffer }> {
  const artifactPath = ensureContained(directory, path.join(directory, "index.js"));
  const bytes = await fs.readFile(artifactPath);
  if (bytes.byteLength !== manifest.size) throw new Error(`Size mismatch: expected ${manifest.size}, got ${bytes.byteLength}.`);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== manifest.sha256) throw new Error(`Integrity verification failed: expected ${manifest.sha256}, got ${actualHash}.`);
  return { artifactPath, bytes };
}

function manifestRegistryEntry(manifest: PackageManifest, updatedAt: string): RegistryItem {
  const permissions = (manifest.permissions || []).map((permission) => ({ ...permission, id: permission.id === "process" ? "process-execution" : permission.id }));
  return {
    id: manifest.id,
    category: "plugins",
    taxonomy: ["extensions", "tools"],
    name: manifest.name,
    description: manifest.description || "First-party KForge package.",
    overview: manifest.description || "First-party KForge package.",
    source: "KForge bundled first-party registry",
    version: manifest.version,
    license: manifest.license,
    capabilities: manifest.capabilities || [],
    requirements: manifest.requirements || [],
    compatibility: manifest.compatibility || "UNKNOWN",
    permissions,
    security: evidence("VERIFIED", "Local package verification", "Manifest validation, permission validation, size verification, and SHA-256 verification passed."),
    publisher: evidence("VERIFIED", "Bundled first-party manifest", manifest.publisher),
    repository: manifest.repository ? evidence("VERIFIED", "Bundled first-party manifest", manifest.repository) : evidence("NOT_AVAILABLE", "No repository was declared by the bundled manifest."),
    releaseHistory: evidenceList("VERIFIED", "Bundled first-party fixtures", ["1.0.0", "1.1.0"]),
    changelog: evidence("NOT_AVAILABLE", "No independent changelog artifact is bundled for this package."),
    installationState: evidence("VERIFIED", "Canonical local registry presence", "INSTALLED"),
    updateState: evidence("NOT_CONFIGURED", "Update state is recalculated from bundled first-party manifests when Marketplace is read."),
    dependencies: evidenceList("VERIFIED", "Validated package manifest", (manifest.dependencies || []).map((dependency) => dependency.version ? `${dependency.id}@${dependency.version}` : dependency.id)),
    provenance: evidence("VERIFIED", "KForge bundled first-party registry", `Bundled fixture manifest ${manifest.version}`),
    integrity: evidence("VERIFIED", "Installed package checksum", `sha256:${manifest.sha256}`),
    sha256: manifest.sha256,
    size: manifest.size,
    storageKey: packageStorageKey(manifest.id),
    trust: "TRUSTED",
    installed: true,
    enabled: true,
    local: true,
    installAction: "MANAGE_LOCAL",
    dataState: "AVAILABLE",
    updatedAt,
  };
}

async function firstPartyCatalogItem(workspaceRoot: string, registry: LocalRegistryFile): Promise<MarketplaceItem | null> {
  try {
    const [{ manifest: baseManifest }, { manifest: latestManifest }] = await Promise.all([
      loadManifestFromApprovedSource(firstPartyManifestPath("1.0.0")),
      loadManifestFromApprovedSource(firstPartyManifestPath("1.1.0")),
    ]);
    const persisted = findRegistryItem(registry, baseManifest.id);
    const installed = persisted?.installed === true && persisted.local === true;
    const installedVersion = installed && typeof persisted?.version === "string" ? persisted.version : undefined;
    const rawHash = installed && typeof persisted?.sha256 === "string" ? persisted.sha256 : undefined;
    const updateAvailable = installedVersion ? compareSemver(installedVersion, latestManifest.version) < 0 : false;
    const permissions = installed ? permissionsForRegistryRow(persisted || {}) : normalizedManifestPermissions(baseManifest);
    const item = withAuthority({
      id: baseManifest.id,
      category: "plugins",
      taxonomy: ["extensions", "tools"],
      name: baseManifest.name,
      description: baseManifest.description || "First-party KForge package.",
      overview: baseManifest.description || "First-party KForge package.",
      features: baseManifest.capabilities || [],
      source: "KForge bundled first-party registry",
      version: installedVersion || baseManifest.version,
      license: baseManifest.license,
      capabilities: baseManifest.capabilities || [],
      requirements: baseManifest.requirements || [],
      compatibility: baseManifest.compatibility || "UNKNOWN",
      permissions,
      security: installed ? normalizedEvidenceField(persisted?.security, evidence("VERIFIED", "Local package verification", "Installed package passed integrity verification.")) : evidence("VERIFIED", "Bundled manifest validation", "Package metadata and permissions are valid; artifact verification is repeated at install time."),
      publisher: evidence("VERIFIED", "Bundled first-party manifest", baseManifest.publisher),
      repository: baseManifest.repository ? evidence("VERIFIED", "Bundled first-party manifest", baseManifest.repository) : evidence("NOT_AVAILABLE", "No repository is declared."),
      releaseHistory: evidenceList("VERIFIED", "Bundled first-party fixtures", [baseManifest.version, latestManifest.version]),
      changelog: evidence("NOT_AVAILABLE", "No independent changelog artifact is bundled for this package."),
      installationState: evidence("VERIFIED", "Canonical local registry presence", installed ? "INSTALLED" : "NOT_INSTALLED"),
      updateState: installed ? evidence("VERIFIED", "Bundled first-party version comparison", updateAvailable ? `UPDATE_AVAILABLE:${latestManifest.version}` : `UP_TO_DATE:${installedVersion}`) : evidence("NOT_AVAILABLE", "The package is not installed."),
      dependencies: evidenceList("VERIFIED", "Validated package manifest", (baseManifest.dependencies || []).map((dependency) => dependency.version ? `${dependency.id}@${dependency.version}` : dependency.id)),
      provenance: evidence("VERIFIED", "KForge bundled first-party registry", "Bundled first-party fixture; no network source is contacted."),
      integrity: installed && rawHash ? evidence("VERIFIED", "Persisted installed package checksum", `sha256:${rawHash}`) : evidence("UNKNOWN", "Artifact SHA-256 is declared by the bundled manifest and is verified again before installation.", `sha256:${baseManifest.sha256}`),
      trust: installed && persisted?.trust === "TRUSTED" && rawHash ? "TRUSTED" : "UNTRUSTED",
      installed,
      enabled: installed && persisted?.enabled === true,
      local: true,
      installAction: installed ? "MANAGE_LOCAL" : "INSTALL_REQUIRES_CONFIRMATION",
      dataState: "AVAILABLE",
      ...(typeof persisted?.updatedAt === "string" ? { updatedAt: persisted.updatedAt } : {}),
    });
    return item;
  } catch {
    return null;
  }
}

export async function getMarketplace(workspaceRoot: string, onlineOptional: boolean) {
  const [modelCenter, registeredRows] = await Promise.all([getModelCenter(workspaceRoot), readLocalRegistry(workspaceRoot)]);
  const registry: LocalRegistryFile = { schemaVersion: 1, items: registeredRows };
  const installedIds = new Set(modelCenter.ollama.models.map((model) => model.id));
  const installed: MarketplaceItem[] = modelCenter.ollama.models.map((model) => withAuthority({
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
  const recommendations: MarketplaceItem[] = modelCenter.recommendations.map((model) => withAuthority({
    id: `ollama:${model.id}`, category: "models", taxonomy: ["models"], name: model.label,
    description: `Official Ollama-library recommendation for local ${/coder/i.test(model.id) ? "coding" : "AI"} workflows. Compatibility is calculated from detected hardware.`, overview: `Bundled compatibility evidence for local ${/coder/i.test(model.id) ? "coding" : "AI"} workflows; no live registry metadata is claimed.`, features: ["recommended", "capabilities-unknown"], source: "KForge bundled compatibility profile (official links)", sourceUrl: model.sourceUrl,
    version: model.pullName.includes(":") ? model.pullName.split(":").slice(1).join(":") : undefined, license: model.license,
    capabilities: ["UNKNOWN"], requirements: [`Estimated download: ${Math.round(model.estimatedDownloadBytes / 1_000_000_000)} GB`, `Estimated RAM: ${Math.round(model.estimatedRamBytes / 1_000_000_000)} GB`], compatibility: model.reason, permissions: modelPermissions(),
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
    installed: installedIds.has(model.id), enabled: modelCenter.active?.provider === "ollama" && modelCenter.active.model === model.id, local: false,
    installAction: onlineOptional && model.compatible ? "INSTALL_REQUIRES_CONFIRMATION" : "NOT_AVAILABLE", dataState: "DATA_UNAVAILABLE",
  }));
  const adapters = listMarketplaceRegistryAdapters(onlineOptional);
  const providers: MarketplaceProviderStatus[] = adapters.map((adapter) => {
    const local = adapter.kind === "local";
    const availability: OnlineAvailabilityState = adapter.state === "AVAILABLE" ? "AVAILABLE" : adapter.state === "OFFLINE" ? "OFFLINE" : adapter.state === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE";
    const refreshEnabled = !local && adapter.configured && onlineOptional;
    const unavailableReason = refreshEnabled || local ? undefined : adapter.detail;
    return {
      id: adapter.id, label: adapter.label, sourceUrl: adapter.sourceUrl, state: adapter.state, detail: adapter.detail, lastChecked: adapter.lastChecked, adapterKind: adapter.kind, configured: adapter.configured, capabilities: adapter.capabilities,
      authority: { kind: local ? "LOCAL_REGISTRY" : "REMOTE_PROVIDER" },
      availability,
      checkedAt: adapter.lastChecked,
      freshness: { state: local ? "CURRENT" : "UNKNOWN", at: local ? adapter.lastChecked : null },
      runtimeEvidence: local ? { state: "VERIFIED", sources: [adapter.detail] } : { state: adapter.configured ? "UNKNOWN" : "NOT_CONFIGURED", sources: [adapter.detail] },
      healthState: local ? "HEALTHY" : adapter.configured ? "NOT_EVALUATED" : "UNAVAILABLE",
      actionEligibility: { state: refreshEnabled ? "REQUIRES_CONFIRMATION" : "DISABLED", actions: [{ id: "refresh", enabled: refreshEnabled, requiresConfirmation: refreshEnabled, ...(!refreshEnabled ? { reason: unavailableReason || "Local provider refresh is not required." } : {}) }], ...(unavailableReason ? { unavailableReason } : {}) },
      ...(unavailableReason ? { unavailableReason } : {}),
    };
  });
  const localExtensions = localEngineItems();
  const firstParty = await firstPartyCatalogItem(workspaceRoot, registry);
  const firstPartyId = firstParty?.id;
  const registered = registeredRows.map(registeredItem).filter((item): item is MarketplaceItem => Boolean(item)).filter((item) => item.id !== firstPartyId);
  const knownItems = new Set([...installed, ...localExtensions, ...(firstParty ? [firstParty] : [])].map((item) => item.id));
  const items = [...installed, ...localExtensions, ...(firstParty ? [firstParty] : []), ...recommendations.filter((item) => !knownItems.has(item.id)), ...registered].map((item) => ({ ...item, lifecycle: itemLifecycle(item, onlineOptional) }));
  return { adapters, providers, categories: marketplaceTaxonomy(items), items };
}

export async function getProjectMarketplace(workspaceRoot: string, onlineOptional: boolean, project: ProjectSummary, profile: ProjectProfile) {
  const market = await getMarketplace(workspaceRoot, onlineOptional);
  const toolStates = new Map(listAgentTools({ profile, trust: project.trust }).map((tool) => [tool.name, tool]));
  const items = market.items.map((item) => {
    const toolName = item.id.startsWith("tool:kforge:") ? item.id.replace("tool:kforge:", "") : "";
    const tool = toolStates.get(toolName as Parameters<typeof toolStates.get>[0]);
    if (!tool) return { ...item, projectCompatibility: toolProjectCompatibility(item, project, profile) };
    const operational = tool.status === "AVAILABLE" || tool.status === "AVAILABLE_WITH_CONFIRMATION";
    return {
      ...item,
      enabled: operational,
      availability: tool.status === "BLOCKED" ? "BLOCKED" as const : operational ? "AVAILABLE" as const : "UNAVAILABLE" as const,
      runtimeEvidence: { state: tool.evidence?.runtime === "DETECTED" || tool.evidence?.runtime === "NOT_APPLICABLE" ? "VERIFIED" as const : "NOT_AVAILABLE" as const, sources: [tool.evidence?.projectPrerequisite || profile.projectId, tool.unavailableReason || tool.description] },
      healthState: operational ? "HEALTHY" as const : "UNAVAILABLE" as const,
      actionEligibility: { state: tool.status === "AVAILABLE_WITH_CONFIRMATION" ? "REQUIRES_CONFIRMATION" as const : operational ? "ENABLED" as const : "DISABLED" as const, actions: [{ id: "run", enabled: operational, requiresConfirmation: tool.status === "AVAILABLE_WITH_CONFIRMATION", ...(!operational ? { reason: tool.unavailableReason || "Tool execution is unavailable." } : {}) }], ...(!operational ? { unavailableReason: tool.unavailableReason || "Tool execution is unavailable." } : {}) },
      ...(operational ? { unavailableReason: undefined } : { unavailableReason: tool.unavailableReason || "Tool execution is unavailable." }),
      projectCompatibility: toolProjectCompatibility(item, project, profile),
    };
  });
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

export async function previewMarketplaceInstall(workspaceRoot: string, onlineOptional: boolean, itemId: string) {
  const market = await getMarketplace(workspaceRoot, onlineOptional);
  const item = market.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Marketplace item was not found in the configured local or official registry.");
  if (item.installed) return { item, allowed: false, reason: "Item is already installed locally; use the local management action instead." };
  if (item.installAction !== "INSTALL_REQUIRES_CONFIRMATION") return { item, allowed: false, reason: onlineOptional ? "This item has no verified install adapter." : "Offline Mode blocks remote downloads until Online Optional is enabled." };
  if (!item.local && !onlineOptional) return { item, allowed: false, reason: "Offline Mode blocks remote downloads until Online Optional is enabled." };
  return { item, allowed: true, reason: item.local ? "Review publisher, permissions, compatibility, and integrity evidence. This bundled first-party install requires confirmation but no network download." : "Review source, license, permissions, compatibility, and resource requirements. Confirm before starting a download." };
}

function generateOperationId(): string {
  return `op-${randomUUID()}`;
}

function failedResult(opId: string, itemId: string, error: unknown, rollback = false, installed = false, integrityVerified = false, sizeVerified = false): InstallResult {
  return { operationId: opId, itemId, stage: "FAILED", installed, rollback, integrityVerified, sizeVerified, error: error instanceof Error ? error.message : String(error) };
}

async function validatedPackageSource(workspaceRoot: string, itemId: string, manifestPath: string) {
  const safeId = safePackageId(itemId);
  const registry = await readRegistry(workspaceRoot);
  const { manifest, directory } = await loadManifestFromApprovedSource(manifestPath);
  if (manifest.id !== safeId) throw new Error("Item ID mismatch with first-party manifest.");
  await verifyManifestCompatibility(manifest, registry);
  const artifact = await verifyArtifact(manifest, directory);
  return { registry, manifest, directory, artifact };
}

export async function installPackage(workspaceRoot: string, itemId: string, sourceManifestPath?: string): Promise<InstallResult> {
  const opId = generateOperationId();
  let safeId = itemId;
  try {
    safeId = safePackageId(itemId);
    const sourcePath = sourceManifestPath ? ensureContained(firstPartyFixturesRoot(), sourceManifestPath) : firstPartyManifestPath("1.0.0");
    const { registry, manifest, artifact } = await validatedPackageSource(workspaceRoot, safeId, sourcePath);
    const existing = findRegistryItem(registry, safeId);
    if (existing?.installed === true) return failedResult(opId, safeId, "Package is already installed.", false, true, true, true);

    const root = marketplaceRoot(workspaceRoot);
    const stagingDir = path.join(root, "staging", opId);
    const installedDir = installedPackageDir(workspaceRoot, safeId);
    await fs.mkdir(path.dirname(stagingDir), { recursive: true });
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    try {
      await fs.copyFile(artifact.artifactPath, path.join(stagingDir, "index.js"));
      await writeJsonAtomic(path.join(stagingDir, "manifest.json"), manifest);
      await verifyArtifact(manifest, stagingDir);
      try {
        await fs.access(installedDir);
        throw new Error("Installed package path already exists without a matching registry entry; installation is blocked to avoid overwriting unknown data.");
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("blocked")) throw error;
      }
      await fs.mkdir(path.dirname(installedDir), { recursive: true });
      await fs.rename(stagingDir, installedDir);
      const nextRegistry: LocalRegistryFile = { schemaVersion: 1, items: registry.items.filter((item) => registryItemId(item) !== safeId) };
      nextRegistry.items.push(manifestRegistryEntry(manifest, new Date().toISOString()));
      try {
        await writeJsonAtomic(registryPath(workspaceRoot), nextRegistry);
      } catch (error) {
        await fs.rm(installedDir, { recursive: true, force: true }).catch(() => undefined);
        return failedResult(opId, safeId, error, true, false, true, true);
      }
      const health = await healthCheckPackage(workspaceRoot, safeId);
      if (!health.ok) {
        await writeJsonAtomic(registryPath(workspaceRoot), registry).catch(() => undefined);
        await fs.rm(installedDir, { recursive: true, force: true }).catch(() => undefined);
        return failedResult(opId, safeId, `Post-install health check failed: ${health.message}`, true, false, true, true);
      }
      return { operationId: opId, itemId: safeId, stage: "INSTALLED", installed: true, rollback: false, integrityVerified: true, sizeVerified: true };
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    return failedResult(opId, safeId, error);
  }
}

export async function healthCheckPackage(workspaceRoot: string, itemId: string): Promise<{ ok: boolean; message: string; version?: string; installed: boolean }> {
  let safeId = itemId;
  try {
    safeId = safePackageId(itemId);
    const registry = await readRegistry(workspaceRoot);
    const item = findRegistryItem(registry, safeId);
    if (!item || item.installed !== true || item.local !== true) return { ok: false, message: "Package not installed.", installed: false };
    if (item.trust !== "TRUSTED") return { ok: false, message: "Installed package is not in TRUSTED state.", installed: true, ...(typeof item.version === "string" ? { version: item.version } : {}) };
    const installedDir = installedPackageDir(workspaceRoot, safeId);
    const manifestPath = path.join(installedDir, "manifest.json");
    const raw: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const validation = manifestSchema.safeParse(raw);
    if (!validation.success) return { ok: false, message: "Installed manifest failed schema validation.", installed: true, ...(typeof item.version === "string" ? { version: item.version } : {}) };
    const manifest = validation.data;
    normalizedManifestPermissions(manifest);
    if (manifest.id !== safeId) return { ok: false, message: "Installed manifest package ID does not match registry identity.", installed: true, version: manifest.version };
    const persistedHash = typeof item.sha256 === "string" ? item.sha256 : "";
    if (!persistedHash || persistedHash !== manifest.sha256) return { ok: false, message: "Installed manifest checksum does not match durable registry evidence.", installed: true, version: manifest.version };
    await verifyArtifact(manifest, installedDir);
    return { ok: true, message: "Health check passed: manifest, size and SHA-256 evidence are consistent.", installed: true, version: manifest.version };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), installed: false };
  }
}

export async function updatePackage(workspaceRoot: string, itemId: string, newVersionManifestPath?: string): Promise<InstallResult> {
  const opId = generateOperationId();
  let safeId = itemId;
  let mutationStarted = false;
  try {
    safeId = safePackageId(itemId);
    const currentHealth = await healthCheckPackage(workspaceRoot, safeId);
    if (!currentHealth.ok || !currentHealth.installed) return failedResult(opId, safeId, `Package cannot be updated because current health verification failed: ${currentHealth.message}`);
    const sourcePath = newVersionManifestPath ? ensureContained(firstPartyFixturesRoot(), newVersionManifestPath) : firstPartyManifestPath("1.1.0");
    const { registry, manifest, artifact } = await validatedPackageSource(workspaceRoot, safeId, sourcePath);
    const installedItem = findRegistryItem(registry, safeId);
    if (!installedItem || installedItem.installed !== true) return failedResult(opId, safeId, "Package not installed; cannot update.");
    const currentVersion = typeof installedItem.version === "string" ? installedItem.version : currentHealth.version || "0.0.0";
    if (compareSemver(manifest.version, currentVersion) <= 0) return failedResult(opId, safeId, `Update version ${manifest.version} must be greater than installed version ${currentVersion}.`, false, true, true, true);

    const root = marketplaceRoot(workspaceRoot);
    const stagingDir = path.join(root, "staging", opId);
    const currentDir = installedPackageDir(workspaceRoot, safeId);
    const backupDir = path.join(root, "rollback", `${packageStorageKey(safeId)}-${opId}`);
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.copyFile(artifact.artifactPath, path.join(stagingDir, "index.js"));
    await writeJsonAtomic(path.join(stagingDir, "manifest.json"), manifest);
    await verifyArtifact(manifest, stagingDir);

    const previousRegistry: LocalRegistryFile = { schemaVersion: 1, items: registry.items.map((entry) => ({ ...entry })) };
    const nextRegistry: LocalRegistryFile = { schemaVersion: 1, items: registry.items.filter((entry) => registryItemId(entry) !== safeId) };
    nextRegistry.items.push(manifestRegistryEntry(manifest, new Date().toISOString()));

    await fs.mkdir(path.dirname(backupDir), { recursive: true });
    await fs.rename(currentDir, backupDir);
    mutationStarted = true;
    try {
      await fs.rename(stagingDir, currentDir);
      await writeJsonAtomic(registryPath(workspaceRoot), nextRegistry);
      const health = await healthCheckPackage(workspaceRoot, safeId);
      if (!health.ok || health.version !== manifest.version) throw new Error(`Post-update health verification failed: ${health.message}`);
      await fs.rm(backupDir, { recursive: true, force: true });
      return { operationId: opId, itemId: safeId, stage: "UPDATED", installed: true, rollback: false, integrityVerified: true, sizeVerified: true };
    } catch (error) {
      await writeJsonAtomic(registryPath(workspaceRoot), previousRegistry).catch(() => undefined);
      await fs.rm(currentDir, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(backupDir, currentDir).catch(() => undefined);
      return failedResult(opId, safeId, error, true, true, true, true);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      if (!mutationStarted) await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    return failedResult(opId, safeId, error, mutationStarted, mutationStarted, false, false);
  }
}

export async function uninstallPackage(workspaceRoot: string, itemId: string): Promise<InstallResult> {
  const opId = `op-uninstall-${randomUUID()}`;
  let safeId = itemId;
  try {
    safeId = safePackageId(itemId);
    const registry = await readRegistry(workspaceRoot);
    const installedItem = findRegistryItem(registry, safeId);
    if (!installedItem || installedItem.installed !== true || installedItem.local !== true) return { operationId: opId, itemId: safeId, stage: "UNINSTALLED", installed: false, rollback: false, integrityVerified: false, sizeVerified: false, error: "Package not registered; nothing removed." };
    const currentDir = installedPackageDir(workspaceRoot, safeId);
    const trashDir = path.join(marketplaceRoot(workspaceRoot), "uninstall", `${packageStorageKey(safeId)}-${opId}`);
    await fs.mkdir(path.dirname(trashDir), { recursive: true });
    let moved = false;
    try {
      await fs.rename(currentDir, trashDir);
      moved = true;
    } catch (error) {
      return failedResult(opId, safeId, `Cannot stage uninstall safely: ${error instanceof Error ? error.message : String(error)}`, false, true);
    }
    const nextRegistry: LocalRegistryFile = { schemaVersion: 1, items: registry.items.filter((entry) => registryItemId(entry) !== safeId) };
    try {
      await writeJsonAtomic(registryPath(workspaceRoot), nextRegistry);
    } catch (error) {
      if (moved) await fs.rename(trashDir, currentDir).catch(() => undefined);
      return failedResult(opId, safeId, error, true, true);
    }
    await fs.rm(trashDir, { recursive: true, force: true }).catch(() => undefined);
    return { operationId: opId, itemId: safeId, stage: "UNINSTALLED", installed: false, rollback: false, integrityVerified: true, sizeVerified: true };
  } catch (error) {
    return failedResult(opId, safeId, error);
  }
}

export async function runInstalledPackage(workspaceRoot: string, itemId: string): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const health = await healthCheckPackage(workspaceRoot, itemId);
  if (!health.ok) return { ok: false, result: null, error: health.message };
  try {
    const safeId = safePackageId(itemId);
    const registry = await readRegistry(workspaceRoot);
    const item = findRegistryItem(registry, safeId);
    if (!item || item.trust !== "TRUSTED") return { ok: false, result: null, error: "Execution is blocked because durable package trust is not VERIFIED/TRUSTED." };
    const installedDir = installedPackageDir(workspaceRoot, safeId);
    const result = await execFileAsync(process.execPath, [path.join(installedDir, "index.js")], { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
    const stdout = String(result.stdout || "").trim();
    let parsed: unknown = stdout;
    try { parsed = JSON.parse(stdout); } catch { /* plain text output remains plain text */ }
    return { ok: true, result: parsed };
  } catch (error) {
    return { ok: false, result: null, error: error instanceof Error ? error.message : String(error) };
  }
}
