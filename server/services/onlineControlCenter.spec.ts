import { promises as fs } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalPlatformStatus, ProjectSummary } from "../../shared/workspace";
import type { PreviewStatus } from "./previewRuntime";
import { localPlatformPolicy } from "./localPlatform";
import { createOperationTransparency, getOnlineControlCenter, recordRemoteContact } from "./onlineControlCenter";

const roots: string[] = [];

function platform(mode: LocalPlatformStatus["mode"]): LocalPlatformStatus {
  return { mode, policy: localPlatformPolicy(mode), coreReady: true, networkRequiredForCore: false, storagePath: "test", checkedAt: new Date().toISOString(), capabilities: [], optionalOnlineFeatures: [] };
}

function project(remoteUrl?: string): ProjectSummary {
  return {
    id: "project", name: "Project", trust: "trusted", path: "D:/Project", provider: remoteUrl?.includes("github.com") ? "GitHub" : remoteUrl ? "Git" : "Local", remoteUrl,
    branch: "main", lastActivity: new Date().toISOString(), projectType: "TypeScript", modifiedFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0,
    healthScore: null, securityStatus: "unknown", buildStatus: "unknown", testStatus: "unknown", syncStatus: "unknown", tags: [], favorite: false, pinned: false, archived: false,
    categories: { recent: true, favorite: false, pinned: false, archive: false },
  };
}

function preview(): PreviewStatus {
  return { projectId: "project", state: "idle", logs: [], healthHistory: [], routes: [], history: [], runtime: { execution: "LOCAL", network: "NOT_REQUIRED", source: "detected-project-script", projectSourceSent: false }, telemetry: { console: "process-stdout-stderr", network: "health-probe-only", browserConsoleCaptured: false } };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Online Control Center", () => {
  it("reports all eleven sources without claiming that opening contacted a remote", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-online-control-"));
    roots.push(root);
    const result = await getOnlineControlCenter({ workspaceRoot: root, platform: platform("offline"), project: project("https://github.com/knoux/forge.git"), hasCiConfiguration: true, preview: preview() });
    expect(result.remoteContactPerformed).toBe(false);
    expect(result.openingDisclosure).toMatchObject({ execution: "LOCAL", network: "NOT_REQUIRED", projectSourceSent: false, result: "SUCCEEDED" });
    expect(result.services.map((service) => service.id)).toEqual([
      "connection-mode", "network-state", "github", "remote-repository", "marketplace-registry", "model-registry", "cloud-ai", "remote-documentation", "remote-ci", "remote-preview", "updates",
    ]);
    expect(result.services.find((service) => service.id === "github")?.state).toBe("OFFLINE");
    expect(result.services.every((service) => "lastSuccessfulContact" in service && "lastAttemptedContact" in service && "freshness" in service && "reason" in service)).toBe(true);
  });

  it("persists redacted explicit contact evidence and distinguishes errors", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-online-control-"));
    roots.push(root);
    const succeededAt = new Date().toISOString();
    await recordRemoteContact(root, "github", { attemptedAt: succeededAt, succeeded: true, destination: "https://token:secret@api.github.com/repos/knoux/forge?access_token=nope" });
    let result = await getOnlineControlCenter({ workspaceRoot: root, platform: platform("online-optional"), project: project("https://github.com/knoux/forge.git"), hasCiConfiguration: true, preview: preview() });
    const connected = result.services.find((service) => service.id === "github");
    expect(connected).toMatchObject({ state: "CONNECTED", cachedEvidenceAvailable: true, lastSuccessfulContact: succeededAt, error: null });
    expect(connected?.destination).toBe("https://api.github.com/repos/knoux/forge");
    const failedAt = new Date(Date.now() + 1_000).toISOString();
    await recordRemoteContact(root, "github", { attemptedAt: failedAt, succeeded: false, destination: "https://api.github.com", error: "authentication failed" });
    result = await getOnlineControlCenter({ workspaceRoot: root, platform: platform("online-optional"), project: project("https://github.com/knoux/forge.git"), hasCiConfiguration: true, preview: preview() });
    expect(result.services.find((service) => service.id === "github")).toMatchObject({ state: "ERROR", lastSuccessfulContact: succeededAt, lastAttemptedContact: failedAt, error: "authentication failed" });
  });

  it("builds a complete transparency envelope with measured duration", () => {
    const evidence = createOperationTransparency({ execution: "REMOTE", network: "REQUIRED", dataClasses: ["METADATA", "CREDENTIAL_REFERENCE"], provider: "GitHub", destination: "https://token@api.github.com/repos/knoux/forge", purpose: "Read repository metadata", confirmation: "CONFIRMED", startedAt: "2026-08-24T00:00:00.000Z", completedAt: "2026-08-24T00:00:01.250Z", result: "SUCCEEDED" });
    expect(evidence).toMatchObject({ secretRedaction: true, projectSourceSent: false, durationMs: 1250, destination: "https://api.github.com/repos/knoux/forge", result: "SUCCEEDED" });
  });

  it("reports configured cloud providers without contacting them when the control center opens", async () => {
    vi.stubEnv("OPENAI_API_KEY", "online-control-secret");
    vi.stubEnv("KFORGE_OPENAI_MODEL", "configured-model");
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-online-control-"));
    roots.push(root);
    const result = await getOnlineControlCenter({ workspaceRoot: root, platform: platform("online"), project: project(), hasCiConfiguration: false, preview: preview() });
    expect(result.services.find((service) => service.id === "cloud-ai")).toMatchObject({ state: "DISCONNECTED", lastAttemptedContact: null, cachedEvidenceAvailable: false });
    expect(JSON.stringify(result)).not.toContain("online-control-secret");
    expect(result.remoteContactPerformed).toBe(false);
  });
});
