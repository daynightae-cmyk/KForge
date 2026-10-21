import type { ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import type { ServiceAvailability, WorkbenchService } from "./serviceDirectory";

/**
 * Real availability for a KForge service.
 *
 * Every state below is derived from evidence KForge already owns. Nothing here
 * is a decorative default: when KForge has no evidence for a service the state
 * is `NEEDS_SETUP` or `UNAVAILABLE` with the reason, never a green READY.
 */
export type ServiceState = {
  state: ServiceAvailability;
  /** The truthful reason behind the state, shown next to the badge. */
  detail: string;
  /** The prerequisite the user must satisfy, when there is one. */
  prerequisite?: string;
};

export type ProviderEvidence = { id: string; configured: boolean; connected: boolean };

export type AvailabilityEvidence = {
  platformMode: string;
  project?: ProjectSummary;
  actions: WorkspaceActionDescriptor[];
  previewState?: string;
  previewDetail?: string;
  providers: ProviderEvidence[];
  agentToolCount: number;
  agentBlockedCount: number;
  lastTaskStatus?: string;
};

export const EMPTY_AVAILABILITY: AvailabilityEvidence = {
  platformMode: "offline",
  actions: [],
  providers: [],
  agentToolCount: 0,
  agentBlockedCount: 0,
};

/** Services whose value comes from an explicit remote contact. */
const REMOTE_SERVICES = new Set([
  "projects:import-project",
  "ai:providers",
  "online:discover",
  "online:documentation",
  "online:marketplace",
  "online:remote-sources",
  "online:updates",
  "remote:github",
  "remote:pull-requests",
  "remote:issues",
  "remote:actions",
  "remote:releases",
]);

/** Services that execute or mutate inside the project and therefore need trust. */
const TRUST_SERVICES = new Set([
  "ai:agents",
  "developer-tools:terminal",
  "developer-tools:tests",
  "developer-tools:build",
  "developer-tools:lint",
  "developer-tools:preview",
  "quality:sonar",
  "quality:solutions",
  "quality:snapshots",
  "release:release-gate",
  "remote:git",
]);

/** Services that cannot do anything useful without a configured AI provider. */
const PROVIDER_SERVICES = new Set(["ai:agents"]);

const ACTION_SERVICES: Record<string, string> = {
  "developer-tools:tests": "test",
  "developer-tools:build": "build",
  "developer-tools:lint": "typecheck",
  "developer-tools:runtime": "runtime",
  "quality:sonar": "scan",
};

const OFFLINE_DETAIL = "Offline mode is active, so KForge does not contact remote services from this service.";
const NO_PROJECT_DETAIL = "Select a project to give this service real local evidence.";
const UNTRUSTED_DETAIL = "This project is not trusted yet. KForge blocks execution until you trust it in System / Trust.";

function descriptorFor(evidence: AvailabilityEvidence, actionId: string) {
  return evidence.actions.find((entry) => entry.id === actionId);
}

export function resolveServiceState(service: WorkbenchService, evidence: AvailabilityEvidence): ServiceState {
  const needsProject = service.context === "project";
  if (needsProject && !evidence.project) return { state: "REQUIRES_PROJECT", detail: NO_PROJECT_DETAIL, prerequisite: "Requires an active project" };

  const offline = evidence.platformMode === "offline";
  if (REMOTE_SERVICES.has(service.target) && offline) {
    return { state: "OFFLINE", detail: OFFLINE_DETAIL, prerequisite: "Requires Online Optional or Online mode" };
  }

  if (TRUST_SERVICES.has(service.target) && evidence.project && evidence.project.trust !== "trusted") {
    return { state: "REQUIRES_PERMISSION", detail: UNTRUSTED_DETAIL, prerequisite: "Requires a trusted project" };
  }

  if (PROVIDER_SERVICES.has(service.target)) {
    const configured = evidence.providers.some((provider) => provider.configured);
    if (!configured) {
      return { state: "NEEDS_SETUP", detail: "No AI provider is configured. Add a provider in AI / Providers before starting an agent mission.", prerequisite: "Requires a configured AI provider" };
    }
  }

  const actionId = ACTION_SERVICES[service.target];
  if (actionId) {
    const descriptor = descriptorFor(evidence, actionId);
    if (!descriptor) return { state: "UNAVAILABLE", detail: descriptorFor(evidence, actionId)?.unavailableReason || "KForge registered no command for this action in this project." };
    if (!descriptor.enabled) {
      if (descriptor.requiresTrust) return { state: "REQUIRES_PERMISSION", detail: descriptor.unavailableReason || UNTRUSTED_DETAIL, prerequisite: "Requires a trusted project" };
      if (descriptor.requiresNetwork && offline) return { state: "OFFLINE", detail: OFFLINE_DETAIL, prerequisite: "Requires Online Optional or Online mode" };
      return { state: "UNAVAILABLE", detail: descriptor.unavailableReason || "The registered command is not available for this project." };
    }
    if (descriptor.requiresNetwork && offline) return { state: "OFFLINE", detail: OFFLINE_DETAIL, prerequisite: "Requires Online Optional or Online mode" };
    return { state: "READY", detail: descriptor.command ? `Runs the registered command: ${descriptor.command}` : "The registered command is available for this project." };
  }

  if (service.target === "developer-tools:preview") {
    const state = (evidence.previewState || "IDLE").toUpperCase();
    if (state === "RUNNING" || state === "STARTING") return { state: "RUNNING", detail: evidence.previewDetail || "The local Preview runtime is running for this project." };
    if (state === "FAILED" || state === "ERROR") return { state: "FAILED", detail: evidence.previewDetail || "The last Preview run failed. Open Preview for the captured error." };
    return { state: "READY", detail: "The local Preview runtime is idle and can be started from this surface." };
  }

  if (service.target === "ai:providers") {
    const configured = evidence.providers.filter((provider) => provider.configured).length;
    if (!configured) return { state: "NEEDS_SETUP", detail: "No AI provider is configured yet. Add a provider in Provider Studio before models or agents can run.", prerequisite: "Requires a configured AI provider" };
    return { state: "READY", detail: `${configured} configured provider(s) are available to Provider Studio.` };
  }

  if (service.target === "developer-tools:terminal") {
    const enabled = evidence.actions.filter((entry) => entry.enabled).length;
    if (!enabled) return { state: "UNAVAILABLE", detail: "KForge registered no executable command for this project." };
    return { state: "READY", detail: `${enabled} of ${evidence.actions.length} registered project command(s) are available.` };
  }

  if (service.target === "ai:tasks") {
    const status = (evidence.lastTaskStatus || "").toUpperCase();
    if (status === "RUNNING") return { state: "RUNNING", detail: "At least one task is running right now." };
    if (status === "FAILED") return { state: "FAILED", detail: "The most recent task failed. Open the task for its captured error." };
    if (status === "COMPLETED") return { state: "COMPLETED", detail: "The most recent task completed. Open the task for its result." };
    return { state: "READY", detail: "No task is running. Tasks appear here after a real operation starts one." };
  }

  if (service.target === "ai:agents") {
    const blocked = evidence.agentBlockedCount;
    if (evidence.agentToolCount === 0) return { state: "UNAVAILABLE", detail: "KForge registered no agent tools for this project." };
    if (blocked > 0) return { state: "REQUIRES_PERMISSION", detail: `${blocked} of ${evidence.agentToolCount} agent tools are blocked by their declared permissions.`, prerequisite: "Requires permission to run the blocked tools" };
    return { state: "READY", detail: `${evidence.agentToolCount} agent tool(s) are permitted for this project.` };
  }

  if (service.target === "quality:sonar") {
    const score = evidence.project?.healthScore;
    if (score == null) return { state: "NEEDS_SETUP", detail: "No project health scan has been stored yet. Run a scan to produce one.", prerequisite: "Requires a stored scan result" };
    return { state: "COMPLETED", detail: `Last stored project health score: ${score}.` };
  }

  if (service.target === "remote:git" && evidence.project) {
    const changed = evidence.project.modifiedFiles + evidence.project.untrackedFiles;
    return changed
      ? { state: "READY", detail: `${changed} local change(s) in ${evidence.project.branch || "the current branch"}.` }
      : { state: "COMPLETED", detail: `Working tree is clean on ${evidence.project.branch || "the current branch"}.` };
  }

  return { state: "READY", detail: "This service is implemented and reachable. Results appear after you use it." };
}

export const SERVICE_STATE_LABELS: Record<ServiceAvailability, string> = {
  READY: "READY",
  NEEDS_SETUP: "NEEDS SETUP",
  REQUIRES_PROJECT: "REQUIRES PROJECT",
  REQUIRES_PERMISSION: "REQUIRES PERMISSION",
  OFFLINE: "OFFLINE",
  UNAVAILABLE: "UNAVAILABLE",
  RUNNING: "RUNNING",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
};
