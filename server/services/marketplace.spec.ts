import { promises as fs } from "fs";
import { describe, expect, it } from "vitest";
import path from "path";
import type { ProjectProfile, ProjectSummary } from "../../shared/workspace";
import { getMarketplace, getProjectMarketplace, listMarketplaceRegistryAdapters } from "./marketplace";

function project(): ProjectSummary {
  return { id: "project", name: "React App", trust: "trusted", path: "D:/Project", provider: "Local", branch: "main", lastActivity: new Date().toISOString(), projectType: "React", modifiedFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0, healthScore: null, securityStatus: "unknown", buildStatus: "unknown", testStatus: "unknown", syncStatus: "unknown", tags: [], favorite: false, pinned: false, archived: false, categories: { recent: true, favorite: false, pinned: false, archive: false } };
}

function profile(): ProjectProfile {
  return { projectId: "project", rootPath: "D:/Project", framework: ["React", "Vite"], languages: ["TypeScript", "JavaScript"], packageManager: "npm", dependencies: [], scripts: { typecheck: "tsc", build: "vite build" }, commands: { typecheck: "npm run typecheck", build: "npm run build", runtime: "npm start" }, commandEvidence: [], manifests: ["package.json"], lockfiles: ["package-lock.json"], workspaceKind: "single", sourceRoots: ["src"], testRoots: [], runtimeEntrypoint: "src/main.tsx", performance: { scale: "small", parallelism: 1, maxIndexedFiles: 5_000, graphDepth: 8, scannerConcurrency: 1, cacheEnabled: true, rationale: "fixture" }, envFiles: [], ci: [], docker: [], deployment: [], sourceFileCount: 10, totalFileCount: 20, projectSizeBytes: 1_000, fileDiscovery: { state: "COMPLETE", scannedCount: 20, totalOrUnknown: 20, limit: 20_000, reason: "fixture", source: "fixture" }, detectedAt: new Date().toISOString() };
}

describe("KForge Marketplace adapters", () => {
  it("exposes installed local agents and tools while keeping remote data offline", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-marketplace-"));
    try {
      const marketplace = await getMarketplace(workspaceRoot, false);
      expect(marketplace.items.some((item) => item.category === "agents" && item.id === "agent:kforge:engineer" && item.installed)).toBe(true);
      expect(marketplace.items.some((item) => item.category === "tools" && item.id === "tool:kforge:read_file" && item.local)).toBe(true);
      expect(marketplace.providers.find((provider) => provider.id === "ollama-official")?.state).toBe("OFFLINE");
      expect(marketplace.providers.find((provider) => provider.id === "extension-registries")?.state).toBe("OFFLINE");
      expect(marketplace.adapters.find((adapter) => adapter.id === "ollama-official")?.configured).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("reports an unconfigured remote registry as NOT_CONFIGURED in Online Optional mode", () => {
    const remote = listMarketplaceRegistryAdapters(true).find((adapter) => adapter.id === "ollama-official");
    expect(remote).toMatchObject({ kind: "remote", configured: false, state: "NOT_CONFIGURED" });
    expect(remote?.capabilities).toEqual(expect.arrayContaining(["catalog", "version", "changelog", "install"]));
    expect(remote?.detail).toContain("no remote catalog adapter is configured");
  }, 15_000);

  it("represents the complete product taxonomy without fabricating empty catalog entries", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-marketplace-taxonomy-"));
    try {
      const marketplace = await getMarketplace(workspaceRoot, true);
      expect(marketplace.categories.map((category) => category.id)).toEqual([
        "models", "extensions", "agents", "tools", "analyzers", "security", "testing", "build", "runtime", "git", "github-integrations", "templates", "presets", "themes", "language-packs", "integrations",
      ]);
      expect(marketplace.categories.find((category) => category.id === "extensions")).toMatchObject({ state: "NOT_CONFIGURED", itemCount: 0 });
      expect(marketplace.categories.find((category) => category.id === "testing")).toMatchObject({ state: "AVAILABLE" });
      expect(marketplace.items.filter((item) => item.taxonomy.includes("extensions"))).toHaveLength(0);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("returns complete detail evidence and all permission classes for every verified item", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-marketplace-details-"));
    try {
      const marketplace = await getMarketplace(workspaceRoot, false);
      const expectedPermissions = ["filesystem-read", "filesystem-write", "network", "process-execution", "git", "project-read", "project-write", "ai-access", "external-apis"];
      for (const item of marketplace.items) {
        expect(item.overview).toBeTruthy();
        expect(item.permissions.map((permission) => permission.id)).toEqual(expectedPermissions);
        expect(item).toHaveProperty("security.state");
        expect(item).toHaveProperty("publisher.state");
        expect(item).toHaveProperty("repository.state");
        expect(item).toHaveProperty("releaseHistory.state");
        expect(item).toHaveProperty("changelog.state");
        expect(item).toHaveProperty("installationState.state");
        expect(item).toHaveProperty("updateState.state");
        expect(item).toHaveProperty("dependencies.state");
        expect(item).toHaveProperty("provenance.state");
        expect(item).toHaveProperty("integrity.state");
      }
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("keeps remote registry packages untrusted and reports absent metadata explicitly", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-marketplace-trust-"));
    try {
      await fs.mkdir(path.join(workspaceRoot, ".kforge"), { recursive: true });
      await fs.writeFile(path.join(workspaceRoot, ".kforge", "marketplace-registry.json"), JSON.stringify({ items: [{ id: "remote:extension", category: "plugins", name: "Remote Extension", description: "Registry metadata", source: "Test remote", local: false, trust: "TRUSTED", installed: true, enabled: true, installAction: "INSTALL_REQUIRES_CONFIRMATION", installationState: { state: "VERIFIED", source: "Untrusted remote claim", value: "INSTALLED" }, publisher: {}, permissions: [{ id: "network", required: true, detail: "Contacts an external API." }] }] }), "utf8");
      const marketplace = await getMarketplace(workspaceRoot, true);
      const item = marketplace.items.find((entry) => entry.id === "remote:extension");
      expect(item).toMatchObject({ trust: "UNTRUSTED", taxonomy: ["extensions"], installed: false, enabled: false, installAction: "NOT_AVAILABLE", installationState: { state: "VERIFIED", value: "NOT_INSTALLED" } });
      expect(item?.publisher.state).toBe("UNKNOWN");
      expect(item?.changelog.state).toBe("NOT_AVAILABLE");
      expect(item?.integrity.state).toBe("NOT_AVAILABLE");
      expect(item?.permissions.find((permission) => permission.id === "network")).toMatchObject({ required: true });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("returns project-aware compatibility and the complete Agent-to-Marketplace evidence flow", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-project-marketplace-"));
    try {
      const marketplace = await getProjectMarketplace(workspaceRoot, false, project(), profile());
      const typecheck = marketplace.items.find((item) => item.id === "tool:kforge:typecheck");
      const test = marketplace.items.find((item) => item.id === "tool:kforge:test");
      expect(typecheck?.projectCompatibility).toMatchObject({ state: "COMPATIBLE", source: "KForge Agent capability analysis" });
      expect(typecheck?.projectCompatibility?.flow.map((stage) => stage.stage)).toEqual(["agent-gap", "marketplace", "inspect", "compatibility", "permissions", "trust", "install", "verify", "return-to-agent"]);
      expect(typecheck?.lifecycle.map((stage) => stage.id)).toHaveLength(18);
      expect(test?.projectCompatibility?.state).toBe("INCOMPATIBLE");
      expect(marketplace.capabilityGaps).toEqual(expect.arrayContaining([expect.objectContaining({ capability: "test", recommendationState: "NOT_CONFIGURED", itemId: null })]));
      expect(marketplace.capabilityGaps.find((gap) => gap.capability === "test")?.flow.at(-1)).toMatchObject({ stage: "return-to-agent", state: "BLOCKED" });
      expect(marketplace.recommendations.some((entry) => entry.itemId === "tool:kforge:test")).toBe(false);
      expect(marketplace.recommendations.some((entry) => entry.itemId === "tool:kforge:stop")).toBe(false);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);
});
