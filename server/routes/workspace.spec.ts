import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { createSnapshot, restoreSnapshot } from "../services/snapshots";
import { getLocalPlatformStatus, setLocalPlatformMode } from "../services/localPlatform";
import { getProjectTrust, setProjectTrust } from "../services/projectTrust";
import { collectionCategories, getProjectCollectionEntry, recordProjectOpened, recordProjectScanned, recordProjectTask, updateProjectCollection } from "../services/projectCollections";
import { applyDocumentationFix, auditDocumentation, previewDocumentationFix } from "../services/documentationAudit";
import { actionEvidenceFromTasks, candidateProjectPaths, detectProjectProfile, executeProjectAction, makeProjectSummary, projectHealthEvidenceSources, releaseGateSourceVerdicts, scanProject, STALE_TASK_EVIDENCE_MS, taskEvidenceDetails } from "./workspace";
import type { KForgeTask } from "../services/tasks";

const fixturesRoot = path.resolve(process.cwd(), "fixtures");
const fixture = (name: string) => path.join(fixturesRoot, name);

describe("KForge Workspace engines", () => {
  it("detects a React and Vite project with source and script evidence", async () => {
    const project = await makeProjectSummary(fixture("workspace-clean"));
    const scan = await scanProject(project);
    expect(scan.profile.framework).toEqual(expect.arrayContaining(["React", "Vite", "Node.js"]));
    expect(scan.profile.languages).toEqual(expect.arrayContaining(["TypeScript", "JavaScript"]));
    expect(scan.profile.scripts).toHaveProperty("build");
    expect(scan.profile.sourceFileCount).toBeGreaterThan(0);
  }, 15_000);

  it("separates Project Health sources without silently contacting remote providers", async () => {
    const project = await makeProjectSummary(fixture("workspace-clean"));
    const profile = await detectProjectProfile(project);
    const timestamp = "2026-08-24T00:00:00.000Z";
    const sources = projectHealthEvidenceSources(project, profile, "READY", false, timestamp);
    expect(Object.keys(sources)).toEqual(["LOCAL", "GITHUB", "CI", "REMOTE_REGISTRY", "PREVIEW"]);
    expect(sources.LOCAL).toMatchObject({ state: "READY", timestamp, freshness: "CURRENT_SCAN", network: "NOT_REQUIRED" });
    expect(sources.GITHUB.state).toBe(project.remoteUrl?.includes("github.com") ? "OFFLINE" : "NOT_CONFIGURED");
    expect(sources.REMOTE_REGISTRY).toMatchObject({ state: "OFFLINE", network: "NOT_REQUIRED" });
    expect(sources.PREVIEW.network).toBe("NOT_REQUIRED");
    for (const source of Object.values(sources)) {
      expect(source.source).toBeTruthy();
      expect(source.provider).toBeTruthy();
      expect(source.evidence.length).toBeGreaterThan(0);
    }
  }, 15_000);

  it("normalizes a TypeScript compiler failure into a typecheck diagnostic after explicit trust", async () => {
    const projectPath = fixture("workspace-broken-typescript");
    const workspaceRoot = path.resolve(process.cwd(), "..");
    try {
      await setProjectTrust(workspaceRoot, projectPath, "trusted");
      const project = await makeProjectSummary(projectPath);
      const scan = await scanProject(project);
      expect(scan.summaries.typecheck).toBe("fail");
      expect(scan.issues.some((entry) => entry.category === "typecheck" && entry.source === "TypeScript")).toBe(true);
    } finally {
      await setProjectTrust(workspaceRoot, projectPath, "untrusted");
    }
  }, 45_000);

  it("blocks network-based npm audit during offline scans without delaying local diagnostics", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-offline-audit-"));
    const projectPath = path.join(workspaceRoot, "npm-project");
    const previousWorkspaceRoot = process.env.KFORGE_WORKSPACE_ROOT;
    try {
      await fs.mkdir(projectPath);
      await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "offline-audit-fixture", version: "1.0.0" }), "utf8");
      await fs.writeFile(path.join(projectPath, "package-lock.json"), JSON.stringify({ name: "offline-audit-fixture", lockfileVersion: 3 }), "utf8");
      process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
      await setLocalPlatformMode(workspaceRoot, "offline");
      await setProjectTrust(workspaceRoot, projectPath, "trusted");
      const scan = await scanProject(await makeProjectSummary(projectPath));
      const audit = scan.tools.find((tool) => tool.name === "npm-audit");
      expect(audit).toMatchObject({ available: false });
      expect(audit?.reason).toContain("Offline Mode blocks network-based npm audit");
    } finally {
      if (previousWorkspaceRoot === undefined) delete process.env.KFORGE_WORKSPACE_ROOT;
      else process.env.KFORGE_WORKSPACE_ROOT = previousWorkspaceRoot;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("detects TODO-based project completeness findings", async () => {
    const project = await makeProjectSummary(fixture("workspace-mock"));
    const scan = await scanProject(project);
    expect(scan.issues.some((entry) => entry.category === "completeness" && entry.file === "src/index.ts")).toBe(true);
  });

  it("reports an actual failing test command", async () => {
    const project = await makeProjectSummary(fixture("workspace-failing-test"));
    const result = await executeProjectAction(project, "test");
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("fixture test failed intentionally");
  }, 15_000);

  it("defaults the local platform to offline core operation without a network requirement", async () => {
    const projectPath = fixture("workspace-clean");
    const stateFile = path.join(projectPath, ".kforge", "local-platform.json");
    try {
      await fs.rm(stateFile, { force: true });
      const offline = await getLocalPlatformStatus(projectPath);
      expect(offline.mode).toBe("offline");
      expect(offline.networkRequiredForCore).toBe(false);
      expect(offline.optionalOnlineFeatures.find((entry) => entry.id === "clone")?.enabled).toBe(false);
      const onlineOptional = await setLocalPlatformMode(projectPath, "online-optional");
      expect(onlineOptional.optionalOnlineFeatures.find((entry) => entry.id === "clone")?.enabled).toBe(true);
    } finally {
      await fs.rm(stateFile, { force: true });
    }
  }, 15_000);

  it("runs the universal Golden Matrix with technology and command evidence for common project types", async () => {
    const expectations = [
      { name: "workspace-clean", frameworks: ["React", "Vite", "Node.js"], languages: ["TypeScript", "JavaScript"], commands: { test: true, build: true } },
      { name: "workspace-node", frameworks: ["Node.js", "Express"], languages: ["JavaScript"], commands: { test: true, build: true, runtime: true } },
      { name: "workspace-python", frameworks: ["FastAPI", "pytest"], languages: ["Python"], commands: { test: true, build: false } },
      { name: "workspace-django", frameworks: ["Django", "pytest"], languages: ["Python"], commands: { test: true, build: false } },
      { name: "workspace-go", frameworks: ["Go"], languages: ["Go"], commands: { test: true, build: true } },
      { name: "workspace-rust", frameworks: ["Rust"], languages: ["Rust"], commands: { test: true, build: true } },
      { name: "workspace-java-maven", frameworks: ["Maven", "Spring Boot"], languages: ["Java"], commands: { test: true, build: true } },
      { name: "workspace-java-gradle", frameworks: ["Gradle"], languages: ["Java"], commands: { test: false, build: false } },
      { name: "workspace-dotnet", frameworks: [".NET"], languages: ["C#"], commands: { test: true, build: true } },
      { name: "workspace-php", frameworks: ["PHP", "Composer", "Laravel"], languages: ["PHP"], commands: { test: true, build: false } },
    ] as const;
    for (const expectation of expectations) {
      const profile = await detectProjectProfile(await makeProjectSummary(fixture(expectation.name)));
      expect(profile.framework, expectation.name).toEqual(expect.arrayContaining([...expectation.frameworks]));
      expect(profile.languages, expectation.name).toEqual(expect.arrayContaining([...expectation.languages]));
      expect(profile.manifests.length, expectation.name).toBeGreaterThan(0);
      for (const [kind, known] of Object.entries(expectation.commands)) {
        expect(profile.commandEvidence.find((entry) => entry.kind === kind)?.known, `${expectation.name}:${kind}`).toBe(known);
      }
    }
  }, 30_000);

  it("produces evidence-backed documentation findings and verifies an exact safe fix", async () => {
    const project = await makeProjectSummary(fixture("workspace-documentation"));
    const profile = await detectProjectProfile(project);
    const readme = path.join(project.path, "README.md");
    const original = await fs.readFile(readme, "utf8");
    try {
      const audit = await auditDocumentation(project.path, profile);
      const staleCommand = audit.findings.find((entry) => entry.claim === "npm run obsolete");
      expect(staleCommand?.actualState).toContain("does not define scripts.obsolete");
      expect(audit.findings.some((entry) => entry.claim === "docs/setup.md")).toBe(true);
      expect(await previewDocumentationFix(project.path, audit, staleCommand!.id)).toMatchObject({ patch: { document: "README.md", before: "npm run obsolete", after: "npm run dev" } });
      const applied = await applyDocumentationFix(project.path, profile, audit, staleCommand!.id);
      expect(applied.applied).toBe(true);
      expect(applied.verified).toBe(true);
    } finally {
      await fs.writeFile(readme, original, "utf8");
    }
  });

  it("persists project collections and derives truthful category membership", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-collections-"));
    const projectPath = path.join(workspaceRoot, "project");
    try {
      await fs.mkdir(projectPath);
      await recordProjectOpened(workspaceRoot, projectPath);
      await recordProjectScanned(workspaceRoot, projectPath);
      await recordProjectTask(workspaceRoot, projectPath);
      await updateProjectCollection(workspaceRoot, projectPath, { favorite: true, pinned: true, archived: false, tags: ["backend", "Release", "backend", "  local first  "] });
      const restored = await getProjectCollectionEntry(workspaceRoot, projectPath);
      expect(restored.favorite).toBe(true);
      expect(restored.pinned).toBe(true);
      expect(restored.archived).toBe(false);
      expect(restored.lastOpenedAt).toEqual(expect.any(String));
      expect(restored.lastScannedAt).toEqual(expect.any(String));
      expect(restored.lastTaskAt).toEqual(expect.any(String));
      expect(restored.tags).toEqual(["backend", "local first", "Release"]);
      expect(collectionCategories(restored)).toEqual({ recent: true, favorite: true, pinned: true, archive: false });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("ignores a deleted project path retained in local collections", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-stale-collection-"));
    const removedProject = path.join(workspaceRoot, "removed-project");
    try {
      await fs.mkdir(removedProject);
      await recordProjectOpened(workspaceRoot, removedProject);
      await fs.rm(removedProject, { recursive: true, force: true });
      await expect(candidateProjectPaths(workspaceRoot)).resolves.not.toContain(removedProject);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps Release Gate source verdicts independent and never hides absent CI evidence", async () => {
    const project = await makeProjectSummary(fixture("workspace-clean"));
    const scan = await scanProject(project);
    const release = releaseGateSourceVerdicts(scan);
    expect(Object.keys(release.verdicts)).toEqual(["LOCAL", "GITHUB", "CI", "PREVIEW"]);
    expect(release.verdicts.CI).toMatchObject({ kind: "CI", state: "NOT_CONFIGURED", source: expect.any(String), freshness: expect.any(String), evidence: expect.any(Array) });
    expect(release.verdicts.LOCAL.timestamp).toEqual(expect.any(String));
    expect(release.readiness).toBe("READY WITH WARNINGS");
  });

  it("restores the latest completed verification evidence and preserves fresher in-memory results", () => {
    const projectId = "evidence-project";
    const tasks: KForgeTask[] = [
      { id: "test-old", projectId, kind: "test", status: "succeeded", progress: 100, logs: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z", exitCode: 0, output: "old test pass" },
      { id: "test-new", projectId, kind: "test", status: "failed", progress: 100, logs: [], startedAt: "2026-01-02T00:00:00.000Z", finishedAt: "2026-01-02T00:01:00.000Z", exitCode: 1, error: "new test failure", output: "new test failure" },
      { id: "typecheck", projectId, kind: "typecheck", status: "succeeded", progress: 100, logs: [], startedAt: "2026-01-03T00:00:00.000Z", finishedAt: "2026-01-03T00:01:00.000Z", exitCode: 0, output: "typecheck pass" },
      { id: "agent", projectId, kind: "agent", status: "succeeded", progress: 100, logs: [], startedAt: "2026-01-04T00:00:00.000Z", finishedAt: "2026-01-04T00:01:00.000Z", output: "not a command result" },
    ];
    const evidence = actionEvidenceFromTasks(tasks, {
      test: { action: "test", projectId, ok: true, startedAt: "2026-01-05T00:00:00.000Z", completedAt: "2026-01-05T00:01:00.000Z", exitCode: 0, output: "current test pass", message: "Test completed successfully." },
    });
    expect(evidence.test).toMatchObject({ ok: true, output: "current test pass" });
    expect(evidence.typecheck).toMatchObject({ ok: true, output: "typecheck pass" });
    expect(evidence.build).toBeUndefined();
  });

  it("marks persisted command evidence as stale after the explicit freshness window", () => {
    const completedAt = new Date(Date.now() - STALE_TASK_EVIDENCE_MS - 1_000).toISOString();
    const details = taskEvidenceDetails({ action: "test", projectId: "freshness-project", ok: true, startedAt: completedAt, completedAt, output: "pass", message: "persisted pass", evidenceSource: "persisted" });
    expect(details.freshness).toBe("stale-task");
    expect(details.evidenceSource).toContain("stale");
    expect(details.evidenceAgeMs).toBeGreaterThan(STALE_TASK_EVIDENCE_MS);
  });

  it("keeps a newly opened project untrusted until explicit local approval", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-trust-"));
    const projectPath = path.join(workspaceRoot, "unknown-project");
    try {
      await fs.mkdir(projectPath);
      await expect(getProjectTrust(workspaceRoot, projectPath)).resolves.toBe("untrusted");
      await setProjectTrust(workspaceRoot, projectPath, "trusted");
      await expect(getProjectTrust(workspaceRoot, projectPath)).resolves.toBe("trusted");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps untrusted projects read-only while detecting hardcoded credential evidence", async () => {
    const projectPath = await fs.mkdtemp(path.join(process.cwd(), "kforge-security-"));
    try {
      await fs.mkdir(path.join(projectPath, "src"));
      const keyName = ["API", "KEY"].join("_");
      const keyValue = ["fixture", "secret", "value", "123456"].join("-");
      await fs.writeFile(path.join(projectPath, "src", "keys.ts"), `export const ${keyName} = "${keyValue}";\n`, "utf8");
      const project = await makeProjectSummary(projectPath);
      const scan = await scanProject(project);
      expect(project.trust).toBe("untrusted");
      expect(scan.issues.some((entry) => entry.rule === "kforge/hardcoded-secret" && entry.file === "src/keys.ts")).toBe(true);
      expect(scan.tools.find((entry) => entry.name === "typescript")?.available).toBe(false);
      expect(scan.tools.find((entry) => entry.name === "typescript")?.reason).toContain("Untrusted Project Mode");
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  it("creates and restores a file snapshot", async () => {
    const projectPath = fixture("workspace-clean");
    const file = path.join(projectPath, "src", "snapshot-target.txt");
    await fs.writeFile(file, "before", "utf8");
    const snapshot = await createSnapshot(projectPath, ["src/snapshot-target.txt"], "Workspace snapshot test");
    await fs.writeFile(file, "after", "utf8");
    await restoreSnapshot(projectPath, snapshot.id);
    await expect(fs.readFile(file, "utf8")).resolves.toBe("before");
    await fs.rm(file, { force: true });
  });
});
