import { promises as fs } from "fs";
import path from "path";
import type {
  LocalPlatformStatus,
  OnlineControlCenter,
  OnlineControlServiceId,
  OnlineControlServiceStatus,
  OnlineEvidenceFreshness,
  OperationConfirmation,
  OperationDataClass,
  OperationExecution,
  OperationNetwork,
  OperationResultState,
  OperationTransparency,
  ProjectSummary,
} from "../../shared/workspace";
import type { PreviewStatus } from "./previewRuntime";
import { listMarketplaceRegistryAdapters } from "./marketplace";
import { listCloudAIProviders } from "./aiCenter";

interface ContactRecord {
  lastAttemptedContact: string;
  lastSuccessfulContact: string | null;
  destination: string | null;
  error: string | null;
}

interface ContactFile {
  version: 1;
  contacts: Partial<Record<OnlineControlServiceId, ContactRecord>>;
}

let contactWriteQueue = Promise.resolve();

export interface TransparencyInput {
  execution: OperationExecution;
  network: OperationNetwork;
  dataClasses: OperationDataClass[];
  projectSourceSent?: boolean;
  provider: string;
  destination: string;
  purpose: string;
  confirmation?: OperationConfirmation;
  startedAt?: string;
  completedAt?: string | null;
  result?: OperationResultState;
  reason?: string;
}

function contactPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "network-contacts.json");
}

function redactDestination(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/(token|password|secret|authorization)=([^\s&]+)/gi, "$1=[REDACTED]").slice(0, 500);
  }
}

function redactText(value: string) {
  return value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_TOKEN]")
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .slice(0, 2_000);
}

async function readContacts(workspaceRoot: string): Promise<ContactFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(contactPath(workspaceRoot), "utf8")) as ContactFile;
    if (parsed?.version === 1 && parsed.contacts && typeof parsed.contacts === "object") return parsed;
  } catch {
    // Absence or malformed contact history means no trustworthy cached contact evidence.
  }
  return { version: 1, contacts: {} };
}

export function recordRemoteContact(workspaceRoot: string, service: OnlineControlServiceId, input: { attemptedAt: string; succeeded: boolean; destination?: string | null; error?: string | null }) {
  const operation = contactWriteQueue.then(async () => {
    const current = await readContacts(workspaceRoot);
    const previous = current.contacts[service];
    current.contacts[service] = {
      lastAttemptedContact: input.attemptedAt,
      lastSuccessfulContact: input.succeeded ? input.attemptedAt : previous?.lastSuccessfulContact || null,
      destination: redactDestination(input.destination),
      error: input.succeeded ? null : redactText(input.error || "Remote operation failed."),
    };
    const target = contactPath(workspaceRoot);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(current, null, 2), "utf8");
    await fs.rename(temporary, target);
    return current.contacts[service]!;
  });
  contactWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function createOperationTransparency(input: TransparencyInput): OperationTransparency {
  const startedAt = input.startedAt || new Date().toISOString();
  const completedAt = input.completedAt === undefined ? null : input.completedAt;
  return {
    execution: input.execution,
    network: input.network,
    dataClasses: input.dataClasses.length ? [...new Set(input.dataClasses)] : ["NONE"],
    projectSourceSent: input.projectSourceSent === true,
    secretRedaction: true,
    provider: input.provider,
    destination: redactDestination(input.destination) || "Not applicable",
    purpose: input.purpose,
    confirmation: input.confirmation || "NOT_REQUIRED",
    startedAt,
    completedAt,
    durationMs: completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null,
    result: input.result || "PENDING",
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function completeOperationTransparency(transparency: OperationTransparency, result: OperationResultState, completedAt = new Date().toISOString(), reason?: string): OperationTransparency {
  return createOperationTransparency({
    execution: transparency.execution,
    network: transparency.network,
    dataClasses: transparency.dataClasses,
    projectSourceSent: transparency.projectSourceSent,
    provider: transparency.provider,
    destination: transparency.destination,
    purpose: transparency.purpose,
    confirmation: transparency.confirmation,
    startedAt: transparency.startedAt,
    completedAt,
    result,
    reason: reason || transparency.reason,
  });
}

function contactFreshness(record: ContactRecord | undefined, now: number): OnlineEvidenceFreshness {
  if (!record?.lastSuccessfulContact) return "UNKNOWN";
  const age = now - new Date(record.lastSuccessfulContact).getTime();
  if (age <= 15 * 60_000) return "CURRENT";
  if (age <= 24 * 60 * 60_000) return "CACHED";
  return "STALE";
}

function status(
  id: OnlineControlServiceId,
  label: string,
  state: OnlineControlServiceStatus["state"],
  source: string,
  destination: string | null,
  networkRequirement: OperationNetwork,
  reason: string,
  record: ContactRecord | undefined,
  now: number,
): OnlineControlServiceStatus {
  return {
    id,
    label,
    state,
    lastSuccessfulContact: record?.lastSuccessfulContact || null,
    lastAttemptedContact: record?.lastAttemptedContact || null,
    source,
    destination: redactDestination(record?.destination || destination),
    networkRequirement,
    cachedEvidenceAvailable: Boolean(record?.lastSuccessfulContact),
    cachedEvidenceTimestamp: record?.lastSuccessfulContact || null,
    freshness: record ? contactFreshness(record, now) : networkRequirement === "NOT_REQUIRED" ? "NOT_APPLICABLE" : "UNKNOWN",
    error: record?.error || null,
    reason,
  };
}

function remoteState(networkEnabled: boolean, configured: boolean, record: ContactRecord | undefined): OnlineControlServiceStatus["state"] {
  if (!configured) return "NOT_CONFIGURED";
  if (!networkEnabled) return "OFFLINE";
  if (record?.error && record.lastAttemptedContact !== record.lastSuccessfulContact) return "ERROR";
  if (record?.lastSuccessfulContact) return "CONNECTED";
  return "DISCONNECTED";
}

export async function getOnlineControlCenter(input: {
  workspaceRoot: string;
  platform: LocalPlatformStatus;
  project?: ProjectSummary;
  hasCiConfiguration?: boolean;
  preview?: PreviewStatus;
}): Promise<OnlineControlCenter> {
  const inspectedAt = new Date().toISOString();
  const now = new Date(inspectedAt).getTime();
  const contacts = (await readContacts(input.workspaceRoot)).contacts;
  const online = input.platform.policy.externalMetadataReads;
  const githubConfigured = input.project?.remoteUrl?.includes("github.com") === true;
  const repositoryConfigured = Boolean(input.project?.remoteUrl);
  const adapters = listMarketplaceRegistryAdapters(online);
  const marketplaceConfigured = adapters.some((adapter) => adapter.kind === "remote" && adapter.configured);
  const modelRegistryConfigured = adapters.some((adapter) => adapter.id === "ollama-official" && adapter.configured);
  const cloudProviders = listCloudAIProviders();
  const configuredCloudProviders = cloudProviders.filter((provider) => provider.configured);
  const contactValues = Object.values(contacts).filter((record): record is ContactRecord => Boolean(record));
  const latestContact = [...contactValues].sort((left, right) => right.lastAttemptedContact.localeCompare(left.lastAttemptedContact))[0];
  const lastSuccessfulContact = [...contactValues].filter((record) => record.lastSuccessfulContact).sort((left, right) => (right.lastSuccessfulContact || "").localeCompare(left.lastSuccessfulContact || ""))[0];
  const networkRecord = latestContact ? { ...latestContact, lastSuccessfulContact: lastSuccessfulContact?.lastSuccessfulContact || null } : undefined;
  const networkState: OnlineControlServiceStatus["state"] = !online ? "OFFLINE" : latestContact?.error ? "ERROR" : lastSuccessfulContact ? "CONNECTED" : "DISCONNECTED";
  const services: OnlineControlServiceStatus[] = [
    status("connection-mode", "Connection Mode", online ? "CONNECTED" : "OFFLINE", "Persisted Local Platform mode", null, "NOT_REQUIRED", `${input.platform.mode} policy: metadata reads ${input.platform.policy.externalMetadataReads ? "enabled" : "blocked"}, remote transfers ${input.platform.policy.remoteTransfers ? "enabled" : "blocked"}, provider refresh ${input.platform.policy.providerRefresh ? "enabled" : "blocked"}. Opening this surface still performs no remote contact.`, undefined, now),
    status("network-state", "Network State", networkState, "Cached evidence from explicit remote operations; no connectivity probe", null, "NOT_REQUIRED", online ? latestContact ? "State is derived from the latest explicit remote operation. Opening this screen made no new request." : "No connectivity probe or explicit remote operation evidence exists in this KForge workspace." : "Network access is disabled by the persisted operating mode.", networkRecord, now),
    status("github", "GitHub", remoteState(online, githubConfigured, contacts.github), "Explicit GitHub API evidence", githubConfigured ? "https://api.github.com" : null, "REQUIRED", githubConfigured ? "GitHub metadata is contacted only when the GitHub surface is explicitly refreshed." : input.project ? "The selected project has no GitHub origin remote." : "No project is selected; global Online browsing remains available.", contacts.github, now),
    status("remote-repository", "Remote Repository", remoteState(online, repositoryConfigured, contacts["remote-repository"]), "Git origin and explicit fetch/pull/push/clone evidence", input.project?.remoteUrl || null, "REQUIRED", repositoryConfigured ? "Configured Git remote; opening the control center does not fetch it." : input.project ? "No Git remote is configured for the selected project." : "No project is selected; no repository context was evaluated.", contacts["remote-repository"], now),
    status("marketplace-registry", "Marketplace Registry", remoteState(online, marketplaceConfigured, contacts["marketplace-registry"]), "Marketplace registry adapters", adapters.find((adapter) => adapter.kind === "remote" && adapter.configured)?.sourceUrl || null, "REQUIRED", marketplaceConfigured ? "A configured adapter may be refreshed only by an explicit action." : "No remote Marketplace registry adapter is configured; local registry evidence remains available.", contacts["marketplace-registry"], now),
    status("model-registry", "Model Registry", remoteState(online, modelRegistryConfigured, contacts["model-registry"]), "Ollama registry adapter and confirmed model tasks", "https://ollama.com/library", "REQUIRED", modelRegistryConfigured ? "The configured model registry is contacted only by confirmed downloads or update checks." : "The official source is identified, but no live catalog adapter is configured.", contacts["model-registry"], now),
    status(
      "cloud-ai",
      "Cloud AI",
      remoteState(input.platform.policy.providerRefresh, configuredCloudProviders.length > 0, contacts["cloud-ai"]),
      "AI Center server-side provider registry",
      configuredCloudProviders.length === 1 ? configuredCloudProviders[0].destination : null,
      "REQUIRED",
      configuredCloudProviders.length > 0
        ? `${configuredCloudProviders.map((provider) => provider.name).join(", ")} configured server-side. No provider is selected automatically; every project-context request requires an exact disclosure and confirmation.`
        : "No cloud provider has both a server-side credential and explicit model configured; local providers remain independent.",
      contacts["cloud-ai"],
      now,
    ),
    status("remote-documentation", "Remote Documentation", "NOT_CONFIGURED", "Documentation capability registry", null, "REQUIRED", "No remote documentation provider or adapter is configured.", contacts["remote-documentation"], now),
    status("remote-ci", "Remote CI", remoteState(online, input.hasCiConfiguration === true, contacts["remote-ci"]), "Project CI configuration and explicit provider evidence", githubConfigured ? "https://api.github.com" : null, "REQUIRED", input.hasCiConfiguration ? "Local CI configuration exists, but no remote CI request is made from this screen." : input.project ? "No supported CI configuration was detected for the selected project." : "No project is selected; CI compatibility is NOT_EVALUATED.", contacts["remote-ci"], now),
    status("remote-preview", "Remote Preview", "UNAVAILABLE", input.preview ? `Existing Preview engine is ${input.preview.state} and local-only` : "No project Preview context selected", null, "REQUIRED", "The existing Preview engine is local. No remote Preview adapter exists.", contacts["remote-preview"], now),
    status("updates", "Updates", "NOT_CONFIGURED", "Installed items and provider version evidence", null, "REQUIRED", "No verified KForge update registry is configured; update success is never inferred from installed state.", contacts.updates, now),
  ];
  return {
    projectId: input.project?.id || "GLOBAL",
    inspectedAt,
    mode: input.platform.mode,
    remoteContactPerformed: false,
    services,
    openingDisclosure: createOperationTransparency({
      execution: "LOCAL",
      network: "NOT_REQUIRED",
      dataClasses: ["NONE"],
      provider: "KForge local evidence services",
      destination: input.workspaceRoot,
      purpose: "Aggregate current local configuration and cached remote-contact evidence without contacting a remote endpoint.",
      completedAt: inspectedAt,
      result: "SUCCEEDED",
    }),
  };
}
