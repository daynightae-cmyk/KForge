import { describe, expect, it } from "vitest";
import type { KForgePlatformSettings, ProjectSummary, WorkspaceResponse } from "@shared/workspace";
import { buildSetupPath, deriveProviderEvidence } from "./gettingStartedModel";

const project = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: "p1",
  name: "Forge",
  trust: "trusted",
  path: "C:\\forge",
  provider: "Git",
  branch: "main",
  lastActivity: "2026-11-19T00:00:00.000Z",
  projectType: "NODE",
  modifiedFiles: 0,
  untrackedFiles: 0,
  ahead: 0,
  behind: 0,
  healthScore: 80,
  securityStatus: "pass",
  buildStatus: "pass",
  testStatus: "pass",
  syncStatus: "pass",
  tags: [],
  favorite: false,
  pinned: false,
  archived: false,
  categories: { recent: true, favorite: false, pinned: false, archive: false },
  ...overrides,
});

const workspace = (projects: ProjectSummary[] = []): WorkspaceResponse => ({
  root: "C:\\workspace",
  projects,
  generatedAt: "2026-11-19T00:00:00.000Z",
  localPlatform: {
    mode: "local-first",
    policy: {
      externalMetadataReads: true,
      remoteTransfers: false,
      providerRefresh: false,
      remoteWritesRequireConfirmation: true,
      openingRemoteSurfaceContactsNetwork: false,
    },
    coreReady: true,
    networkRequiredForCore: false,
    storagePath: "C:\\workspace\\.kforge",
    checkedAt: "2026-11-19T00:00:00.000Z",
    capabilities: [],
    optionalOnlineFeatures: [],
  },
});

const settings: KForgePlatformSettings = {
  version: 3,
  general: { startupCapability: "Workspace", startupActivity: "projects", startupOnlineView: "discover" },
  appearance: { density: "compact", reducedMotion: false, theme: "system" },
  privacy: { secretRedaction: true, remoteContextPolicy: "blocked" },
  git: { confirmRemoteWrites: true },
  preview: { autoHealthCheck: true, healthIntervalMs: 5000 },
  updatedAt: "2026-11-19T00:00:00.000Z",
};

describe("KForge onboarding evidence model", () => {
  it("never marks progress complete before workspace evidence exists", () => {
    const path = buildSetupPath({ workspace: null, settings: null });
    expect(path.coreComplete).toBe(0);
    expect(path.corePercent).toBe(0);
    expect(path.readyToWork).toBe(false);
    expect(path.steps.find((step) => step.id === "workspace")?.status).toBe("NOT_EVALUATED");
    expect(path.steps.find((step) => step.id === "project")?.status).toBe("BLOCKED");
  });

  it("counts only real workspace, project, trust and policy evidence as core progress", () => {
    const empty = buildSetupPath({ workspace: workspace(), settings });
    expect(empty.coreComplete).toBe(2);
    expect(empty.steps.find((step) => step.id === "project")?.status).toBe("ACTION_REQUIRED");
    expect(empty.steps.find((step) => step.id === "trust")?.status).toBe("BLOCKED");

    const trusted = buildSetupPath({ workspace: workspace([project()]), project: project(), settings });
    expect(trusted.coreComplete).toBe(4);
    expect(trusted.corePercent).toBe(100);
    expect(trusted.readyToWork).toBe(true);
  });

  it("keeps an untrusted project actionable instead of pretending it is ready", () => {
    const untrusted = project({ trust: "untrusted" });
    const path = buildSetupPath({ workspace: workspace([untrusted]), project: untrusted, settings });
    const trust = path.steps.find((step) => step.id === "trust");
    expect(trust?.status).toBe("ACTION_REQUIRED");
    expect(trust?.evidence).toContain("untrusted");
    expect(path.readyToWork).toBe(false);
    expect(path.coreComplete).toBe(3);
  });

  it("tracks provider and scan recommendations without turning them into readiness claims", () => {
    const path = buildSetupPath({
      workspace: workspace([project()]),
      project: project(),
      settings,
      providers: { configured: 1, total: 3 },
      scanAt: "2026-11-19T10:00:00.000Z",
    });
    expect(path.recommendedTotal).toBe(3);
    expect(path.recommendedComplete).toBe(3);
    expect(path.steps.find((step) => step.id === "providers")?.status).toBe("COMPLETE");
    expect(path.steps.find((step) => step.id === "scan")?.status).toBe("COMPLETE");

    const unknown = buildSetupPath({ workspace: workspace([project()]), project: project(), settings, providers: null });
    expect(unknown.steps.find((step) => step.id === "providers")?.status).toBe("NOT_EVALUATED");
    expect(unknown.steps.find((step) => step.id === "scan")?.status).toBe("ACTION_REQUIRED");
  });

  it("derives provider configuration only from explicit credential state", () => {
    expect(deriveProviderEvidence(null)).toBeNull();
    expect(deriveProviderEvidence(undefined)).toBeNull();
    expect(deriveProviderEvidence([
      { authState: "CONFIGURED", credentialState: "CONFIGURED" },
      { authState: "NOT_CONFIGURED", credentialState: "NOT_CONFIGURED" },
      { authState: "NOT_CONFIGURED", credentialState: "CONFIGURED" },
    ])).toEqual({ configured: 2, total: 3 });
  });

  it("keeps every step pointed at a real workbench destination", () => {
    for (const step of buildSetupPath({ workspace: workspace([project()]), project: project(), settings }).steps) {
      expect(step.target.activity).toBeTruthy();
      expect(step.target.view).toBeTruthy();
      expect(step.actionLabel.length).toBeGreaterThan(2);
      expect(step.summary.length).toBeGreaterThan(30);
    }
  });
});
