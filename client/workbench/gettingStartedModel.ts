import type { KForgeActivity, KForgePlatformSettings, ProjectSummary, WorkspaceResponse } from "@shared/workspace";

/**
 * Onboarding is derived from evidence KForge already owns. A step is never
 * marked complete because the user opened this surface: it is complete only
 * when the workspace, project trust, settings, provider inventory or persisted
 * scan evidence proves it.
 */

export type SetupTrack = "core" | "recommended";
export type SetupStatus = "COMPLETE" | "ACTION_REQUIRED" | "BLOCKED" | "NOT_EVALUATED";

export type SetupTarget = { activity: KForgeActivity; view: string };

export type SetupStep = {
  id: "workspace" | "project" | "trust" | "policy" | "providers" | "appearance" | "scan";
  title: string;
  summary: string;
  status: SetupStatus;
  evidence: string;
  actionLabel: string;
  target: SetupTarget;
  track: SetupTrack;
};

export type SetupProviderEvidence = {
  configured: number;
  total: number;
};

export type SetupEvidence = {
  workspace: WorkspaceResponse | null;
  project?: ProjectSummary;
  settings: KForgePlatformSettings | null;
  providers?: SetupProviderEvidence | null;
  scanAt?: string | null;
};

export type SetupPath = {
  steps: SetupStep[];
  core: SetupStep[];
  recommended: SetupStep[];
  coreComplete: number;
  coreTotal: number;
  corePercent: number;
  recommendedComplete: number;
  recommendedTotal: number;
  readyToWork: boolean;
};

export function deriveProviderEvidence(providers: Array<{ authState?: string; credentialState?: string; health?: string }> | null | undefined): SetupProviderEvidence | null {
  if (!Array.isArray(providers)) return null;
  const configured = providers.filter((provider) => provider.authState === "CONFIGURED" || provider.credentialState === "CONFIGURED").length;
  return { configured, total: providers.length };
}

export function buildSetupPath({ workspace, project, settings, providers, scanAt }: SetupEvidence): SetupPath {
  const activeProjects = (workspace?.projects || []).filter((entry) => !entry.archived);
  const mode = workspace?.localPlatform.mode;
  const policy = workspace?.localPlatform.policy;
  const steps: SetupStep[] = [
    {
      id: "workspace",
      title: "Local workspace ready",
      summary: "Confirm that KForge can read its local workspace root before any project work begins.",
      status: workspace?.root ? "COMPLETE" : "NOT_EVALUATED",
      evidence: workspace?.root ? `Workspace root: ${workspace.root}` : "Workspace evidence has not loaded.",
      actionLabel: "Open workspace",
      target: { activity: "projects", view: "workspace" },
      track: "core",
    },
    {
      id: "project",
      title: "Register a project",
      summary: "Open an existing local directory or clone a repository with explicit confirmation.",
      status: !workspace ? "BLOCKED" : activeProjects.length > 0 ? "COMPLETE" : "ACTION_REQUIRED",
      evidence: !workspace ? "Waiting for workspace evidence." : `${activeProjects.length} active project registration(s).`,
      actionLabel: activeProjects.length ? "Choose a project" : "Open a project",
      target: { activity: "projects", view: activeProjects.length ? "workspace" : "open-project" },
      track: "core",
    },
    {
      id: "trust",
      title: "Review project trust",
      summary: "Project execution stays gated until you explicitly trust the selected project.",
      status: !project ? "BLOCKED" : project.trust === "trusted" ? "COMPLETE" : "ACTION_REQUIRED",
      evidence: !project ? "No active project context is selected." : `${project.name} is ${project.trust}.`,
      actionLabel: "Review trust",
      target: { activity: "system", view: "trust" },
      track: "core",
    },
    {
      id: "policy",
      title: "Confirm the operating policy",
      summary: "The active mode decides which remote operations are even eligible. It never performs one by itself.",
      status: mode ? "COMPLETE" : "NOT_EVALUATED",
      evidence: mode && policy
        ? `${mode} · remote transfers ${policy.remoteTransfers ? "eligible" : "blocked"} · provider refresh ${policy.providerRefresh ? "eligible" : "blocked"}.`
        : "Operating policy evidence has not loaded.",
      actionLabel: "Review policy",
      target: { activity: "system", view: "online-offline" },
      track: "core",
    },
    {
      id: "providers",
      title: "Configure an AI provider",
      summary: "Optional. A provider key and a successful connection test are required before AI missions may run.",
      status: !providers ? "NOT_EVALUATED" : providers.configured > 0 ? "COMPLETE" : "ACTION_REQUIRED",
      evidence: !providers
        ? "Provider inventory was not readable in this session."
        : `${providers.configured} of ${providers.total} provider adapter(s) report a stored credential.`,
      actionLabel: "Configure providers",
      target: { activity: "ai", view: "providers" },
      track: "recommended",
    },
    {
      id: "appearance",
      title: "Set theme and motion",
      summary: "Theme, density and reduced motion are persisted locally and applied immediately.",
      status: settings ? "COMPLETE" : "NOT_EVALUATED",
      evidence: settings
        ? `${settings.appearance.theme} theme · ${settings.appearance.density} density · reduced motion ${settings.appearance.reducedMotion ? "on" : "off"}.`
        : "Settings evidence has not loaded.",
      actionLabel: "Open settings",
      target: { activity: "system", view: "settings" },
      track: "recommended",
    },
    {
      id: "scan",
      title: "Run the first project scan",
      summary: "Recommended. The scan produces persisted health and quality evidence for the selected project.",
      status: !project ? "BLOCKED" : scanAt ? "COMPLETE" : "ACTION_REQUIRED",
      evidence: !project
        ? "Select a project before requesting a scan."
        : scanAt
          ? `Persisted health evidence: ${new Date(scanAt).toLocaleString()}.`
          : "No persisted health evidence exists for this project yet.",
      actionLabel: "Run KForge Sonar",
      target: { activity: "quality", view: "sonar" },
      track: "recommended",
    },
  ];

  const core = steps.filter((step) => step.track === "core");
  const recommended = steps.filter((step) => step.track === "recommended");
  const coreComplete = core.filter((step) => step.status === "COMPLETE").length;
  const recommendedComplete = recommended.filter((step) => step.status === "COMPLETE").length;
  return {
    steps,
    core,
    recommended,
    coreComplete,
    coreTotal: core.length,
    corePercent: core.length ? Math.round((coreComplete / core.length) * 100) : 0,
    recommendedComplete,
    recommendedTotal: recommended.length,
    readyToWork: coreComplete === core.length,
  };
}
