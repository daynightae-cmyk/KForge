import { promises as fs } from "fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import type { ProjectProfile, ProjectSummary } from "../../shared/workspace";
import {
  getMarketplace,
  getProjectMarketplace,
  healthCheckPackage,
  installPackage,
  listMarketplaceRegistryAdapters,
  runInstalledPackage,
  uninstallPackage,
  updatePackage,
} from "./marketplace";

const FIRST_PARTY_ID = "package:kforge:json-inspector";

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
      expect(marketplace.categories.find((category) => category.id === "extensions")).toMatchObject({ state: "AVAILABLE" });
      expect(marketplace.categories.find((category) => category.id === "testing")).toMatchObject({ state: "AVAILABLE" });
      expect(marketplace.items.some((item) => item.id === FIRST_PARTY_ID && item.taxonomy.includes("extensions"))).toBe(true);
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

async function makeFixtureCopy(name: string, mutate: (manifest: Record<string, unknown>) => void) {
  const fixturesRoot = path.resolve(process.cwd(), "fixtures");
  const dir = await fs.mkdtemp(path.join(fixturesRoot, `.marketplace-${name}-`));
  const sourceDir = path.join(fixturesRoot, "marketplace-first-party-v110");
  const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8")) as Record<string, unknown>;
  mutate(manifest);
  await fs.copyFile(path.join(sourceDir, "index.js"), path.join(dir, "index.js"));
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { dir, manifestPath: path.join(dir, "manifest.json") };
}

describe("Marketplace first-party lifecycle correctness", () => {
  let workspaceRoot = "";
  const fixtureDirs: string[] = [];

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-marketplace-lifecycle-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await Promise.all(fixtureDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("installs only after real size/SHA verification and persists truthful installed evidence", async () => {
    const result = await installPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(result).toMatchObject({ stage: "INSTALLED", installed: true, integrityVerified: true, sizeVerified: true });

    const health = await healthCheckPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(health).toMatchObject({ ok: true, installed: true, version: "1.0.0" });

    const marketplace = await getMarketplace(workspaceRoot, false);
    const item = marketplace.items.find((entry) => entry.id === FIRST_PARTY_ID);
    expect(item).toMatchObject({ installed: true, trust: "TRUSTED", installationState: { state: "VERIFIED", value: "INSTALLED" }, integrity: { state: "VERIFIED" } });
  }, 15_000);

  it("executes only a verified installed first-party package", async () => {
    await installPackage(workspaceRoot, FIRST_PARTY_ID);
    const execution = await runInstalledPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(execution.ok).toBe(true);
    expect(execution.result).toMatchObject({ result: "json-inspection-complete", evidence: "valid-json", version: "1.0.0" });
  }, 15_000);

  it("rejects traversal-shaped package ids before filesystem mutation", async () => {
    const result = await installPackage(workspaceRoot, "../../escape");
    expect(result).toMatchObject({ stage: "FAILED", installed: false });
    expect(result.error).toMatch(/invalid package id/i);
    await expect(fs.access(path.join(workspaceRoot, "escape"))).rejects.toBeTruthy();
  });

  it("detects installed artifact tampering and refuses execution", async () => {
    await installPackage(workspaceRoot, FIRST_PARTY_ID);
    const installedRoot = path.join(workspaceRoot, ".kforge", "marketplace", "installed");
    const entries = await fs.readdir(installedRoot);
    expect(entries).toHaveLength(1);
    await fs.writeFile(path.join(installedRoot, entries[0], "index.js"), "console.log('tampered')\n", "utf8");

    const health = await healthCheckPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(health.ok).toBe(false);
    expect(health.message).toMatch(/integrity|size/i);

    const execution = await runInstalledPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(execution.ok).toBe(false);
  }, 15_000);

  it("rejects an update with a bad SHA without changing the installed version", async () => {
    await installPackage(workspaceRoot, FIRST_PARTY_ID);
    const fixture = await makeFixtureCopy("bad-sha", (manifest) => {
      manifest.sha256 = "0".repeat(64);
      manifest.integrity = { algorithm: "sha256", expectedHash: "0".repeat(64) };
    });
    fixtureDirs.push(fixture.dir);

    const result = await updatePackage(workspaceRoot, FIRST_PARTY_ID, fixture.manifestPath);
    expect(result.stage).toBe("FAILED");
    expect(result.integrityVerified).toBe(false);

    const health = await healthCheckPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(health).toMatchObject({ ok: true, version: "1.0.0" });
  }, 15_000);

  it("rejects unknown permissions before install", async () => {
    const fixture = await makeFixtureCopy("bad-permission", (manifest) => {
      manifest.version = "1.0.0";
      manifest.permissions = [{ id: "root-shell", required: true, detail: "Must never be accepted." }];
    });
    fixtureDirs.push(fixture.dir);

    const result = await installPackage(workspaceRoot, FIRST_PARTY_ID, fixture.manifestPath);
    expect(result.stage).toBe("FAILED");
    expect(result.error).toMatch(/unknown permission/i);
  }, 15_000);

  it("updates, verifies the new version, then uninstalls with durable cleanup", async () => {
    await installPackage(workspaceRoot, FIRST_PARTY_ID);

    const update = await updatePackage(workspaceRoot, FIRST_PARTY_ID);
    expect(update).toMatchObject({ stage: "UPDATED", installed: true, integrityVerified: true, sizeVerified: true });

    const updatedHealth = await healthCheckPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(updatedHealth).toMatchObject({ ok: true, installed: true, version: "1.1.0" });

    const uninstall = await uninstallPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(uninstall).toMatchObject({ stage: "UNINSTALLED", installed: false });

    const after = await healthCheckPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(after.installed).toBe(false);

    const registry = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kforge", "marketplace-registry.json"), "utf8")) as { items: Array<{ id: string }> };
    expect(registry.items.some((entry) => entry.id === FIRST_PARTY_ID)).toBe(false);
  }, 15_000);
});
