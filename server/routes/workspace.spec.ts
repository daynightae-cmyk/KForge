import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { createSnapshot, restoreSnapshot } from "../services/snapshots";
import { getLocalPlatformStatus, setLocalPlatformMode } from "../services/localPlatform";
import { getProjectTrust, setProjectTrust } from "../services/projectTrust";
import { collectionCategories, getProjectCollectionEntry, recordProjectOpened, recordProjectScanned, recordProjectTask, updateProjectCollection } from "../services/projectCollections";
import { applyDocumentationFix, auditDocumentation, previewDocumentationFix } from "../services/documentationAudit";
import { actionEvidenceFromTasks, candidateProjectPaths, detectProjectProfile, executePreviewFixVerify, executeProjectAction, githubReadState, makeProjectSummary, nonProductionSecurityEvidence, projectHealthEvidenceSources, releaseGateSourceVerdicts, scanProject, STALE_TASK_EVIDENCE_MS, taskEvidenceDetails } from "./workspace";
import { startPreview, stopPreviewAndWait, waitForPreviewHealth } from "../services/previewRuntime";
import type { KForgeTask } from "../services/tasks";
import { selectProjectRuntime } from "../services/projectExecution";

const fixturesRoot = path.resolve(process.cwd(), "fixtures");
const fixture = (name: string) => path.join(fixturesRoot, name);

describe("KForge Workspace engines", () => {
  it("classifies missing GitHub Checks evidence with explicit source states", () => {
    expect(githubReadState({ ok: true, output: "{}" })).toBe("AVAILABLE");
    expect(githubReadState({ ok: false, output: "gh: command not recognized" })).toBe("UNAVAILABLE");
    expect(githubReadState({ ok: false, output: "not logged into github.com; run gh auth login" })).toBe("NOT_CONNECTED");
    expect(githubReadState({ ok: false, output: "HTTP 403: Resource not accessible by integration" })).toBe("BLOCKED");
    expect(githubReadState({ ok: false, output: "HTTP 404: No commit found" })).toBe("UNAVAILABLE");
    expect(githubReadState({ ok: false, output: "temporary upstream failure" })).toBe("UNKNOWN");
  });

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

  it("classifies a missing environment template as a deterministic safe local patch", async () => {
    const projectPath = await fs.mkdtemp(path.join(process.cwd(), "kforge-env-example-"));
    try {
      await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "environment-template-fixture", version: "1.0.0", private: true }), "utf8");
      await fs.writeFile(path.join(projectPath, ".env"), "PUBLIC_API_URL=https://local.invalid\nSERVICE_TOKEN=fixture-value-not-copied\n", "utf8");
      const scan = await scanProject(await makeProjectSummary(projectPath));
      expect(scan.issues.find((entry) => entry.id.endsWith(":missing-env-example"))).toMatchObject({
        category: "completeness",
        fixability: "automatic",
        risk: "safe",
      });
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  it("reports an actual failing test command", async () => {
    const project = await makeProjectSummary(fixture("workspace-failing-test"));
    const result = await executeProjectAction(project, "test");
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("fixture test failed intentionally");
    expect(result.transparency).toMatchObject({ execution: "LOCAL", network: "NOT_REQUIRED", dataClasses: ["PROJECT_CONTEXT"], projectSourceSent: false, secretRedaction: true, result: "FAILED" });
  }, 15_000);

  it("blocks an unconfirmed Git push before any remote contact", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-push-confirmation-"));
    const previousWorkspaceRoot = process.env.KFORGE_WORKSPACE_ROOT;
    try {
      process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
      await setLocalPlatformMode(workspaceRoot, "online-optional");
      const project = { ...(await makeProjectSummary(fixture("workspace-clean"))), remoteUrl: "https://github.com/knoux/forge.git", modifiedFiles: 0, untrackedFiles: 0 };
      const result = await executeProjectAction(project, "push");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("explicitly confirmed");
      expect(result.transparency).toMatchObject({ execution: "HYBRID", network: "REQUIRED", dataClasses: ["METADATA", "SOURCE_CODE"], projectSourceSent: true, confirmation: "REQUIRED", result: "BLOCKED" });
      await expect(fs.stat(path.join(workspaceRoot, ".kforge", "network-contacts.json"))).rejects.toThrow();
    } finally {
      if (previousWorkspaceRoot === undefined) delete process.env.KFORGE_WORKSPACE_ROOT;
      else process.env.KFORGE_WORKSPACE_ROOT = previousWorkspaceRoot;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
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
      { name: "workspace-python", frameworks: ["FastAPI", "pytest"], languages: ["Python"], commands: { test: true, build: false, runtime: true }, preview: true },
      { name: "workspace-django", frameworks: ["Django", "pytest"], languages: ["Python"], commands: { test: true, build: false, runtime: false }, preview: false },
      { name: "workspace-go", frameworks: ["Go"], languages: ["Go"], commands: { test: true, build: true, runtime: true }, preview: false },
      { name: "workspace-rust", frameworks: ["Rust"], languages: ["Rust"], commands: { test: true, build: true, runtime: true }, preview: false },
      { name: "workspace-java-maven", frameworks: ["Maven", "Spring Boot"], languages: ["Java"], commands: { test: true, build: true, runtime: false }, preview: false },
      { name: "workspace-java-gradle", frameworks: ["Gradle"], languages: ["Java"], commands: { test: false, build: false, runtime: false }, preview: false },
      { name: "workspace-dotnet", frameworks: [".NET"], languages: ["C#"], commands: { test: true, build: true, runtime: true }, preview: false },
      { name: "workspace-php", frameworks: ["PHP", "Composer", "Laravel"], languages: ["PHP"], commands: { test: true, build: false, runtime: false }, preview: false },
    ] as const;
    for (const expectation of expectations) {
      const profile = await detectProjectProfile(await makeProjectSummary(fixture(expectation.name)));
      expect(profile.framework, expectation.name).toEqual(expect.arrayContaining([...expectation.frameworks]));
      expect(profile.languages, expectation.name).toEqual(expect.arrayContaining([...expectation.languages]));
      expect(profile.manifests.length, expectation.name).toBeGreaterThan(0);
      for (const [kind, known] of Object.entries(expectation.commands)) {
        const evidence = profile.commandEvidence.find((entry) => entry.kind === kind);
        expect(evidence?.known, `${expectation.name}:${kind}`).toBe(known);
        if (kind === "runtime") {
          const selected = selectProjectRuntime(profile, 43123);
          expect(selected.available, `${expectation.name}:Preview/runtime selector`).toBe(known);
          if (!known) expect(evidence?.detail, `${expectation.name}:unavailable reason`).toContain("UNAVAILABLE:");
        }
      }
      if ("preview" in expectation) expect(selectProjectRuntime(profile, 43123, "preview").available, `${expectation.name}:Preview`).toBe(expectation.preview);
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

  it("uses a unique atomic temporary file for overlapping project collection writes", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-collections-concurrent-"));
    const projectPath = path.join(workspaceRoot, "project");
    try {
      await fs.mkdir(projectPath);
      await Promise.all(Array.from({ length: 32 }, () => recordProjectOpened(workspaceRoot, projectPath)));
      const restored = await getProjectCollectionEntry(workspaceRoot, projectPath);
      expect(restored).toMatchObject({ path: projectPath });
      const collectionDirectory = path.join(workspaceRoot, ".kforge");
      const files = await fs.readdir(collectionDirectory);
      expect(files).toEqual(["project-collections.json"]);
      await expect(fs.readFile(path.join(collectionDirectory, "project-collections.json"), "utf8")).resolves.toContain("\"version\": 1");
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

  it("discovers supported non-Node projects from their canonical root metadata", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-non-node-discovery-"));
    const dotnetProject = path.join(workspaceRoot, "dotnet-app");
    const gradleProject = path.join(workspaceRoot, "gradle-app");
    const requirementsProject = path.join(workspaceRoot, "python-app");
    try {
      await Promise.all([
        fs.mkdir(dotnetProject),
        fs.mkdir(gradleProject),
        fs.mkdir(requirementsProject),
      ]);
      await Promise.all([
        fs.writeFile(path.join(dotnetProject, "App.csproj"), '<Project Sdk="Microsoft.NET.Sdk" />'),
        fs.writeFile(path.join(gradleProject, "build.gradle.kts"), "plugins { application }"),
        fs.writeFile(path.join(requirementsProject, "requirements.txt"), "pytest\n"),
      ]);
      await expect(candidateProjectPaths(workspaceRoot)).resolves.toEqual(expect.arrayContaining([dotnetProject, gradleProject, requirementsProject]));
      await expect(candidateProjectPaths(dotnetProject)).resolves.toContain(dotnetProject);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps Release Gate source verdicts independent and never hides absent CI evidence", async () => {
    const project = await makeProjectSummary(fixture("workspace-clean"));
    const scan = await scanProject(project);
    const release = releaseGateSourceVerdicts(scan);
    expect(Object.keys(release.verdicts)).toEqual(["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"]);
    expect(release.verdicts.SOURCE).toMatchObject({ kind: "SOURCE", state: "READY", timestamp: expect.any(String), evidence: expect.any(Array) });
    expect(release.verdicts.DESKTOP).toMatchObject({ kind: "DESKTOP", state: "UNAVAILABLE", source: expect.stringContaining("desktop"), freshness: "NOT_APPLICABLE" });
    expect(release.verdicts.WINDOWS_PACKAGE).toMatchObject({ kind: "WINDOWS_PACKAGE", state: "UNAVAILABLE", source: expect.stringContaining("windows package"), freshness: "NOT_APPLICABLE" });
    expect(release.verdicts.INSTALLER).toMatchObject({ kind: "INSTALLER", state: "UNAVAILABLE", source: expect.stringContaining("installer"), freshness: "NOT_APPLICABLE" });
    expect(release.verdicts.CI).toMatchObject({ kind: "CI", state: "NOT_CONFIGURED", source: expect.any(String), freshness: expect.any(String), evidence: expect.any(Array) });
    expect(release.verdicts.LOCAL.timestamp).toEqual(expect.any(String));
    expect(release.readiness).toBe("READY WITH WARNINGS");
  });

  it("runs Preview Fix & Verify through a snapshot, deterministic patch, commands, restart, and healthy probe", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-preview-loop-"));
    const projectPath = path.join(workspaceRoot, "project");
    const previousWorkspaceRoot = process.env.KFORGE_WORKSPACE_ROOT;
    let projectId = "";
    try {
      await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
      const typescriptCli = path.relative(projectPath, path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc")).replace(/\\/g, "/");
      await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "preview-fix-verify", private: true, scripts: { typecheck: `node ${typescriptCli} --noEmit`, build: "node build.cjs", dev: "node server.cjs" } }), "utf8");
      await fs.writeFile(path.join(projectPath, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true }, include: ["src"] }), "utf8");
      await fs.writeFile(path.join(projectPath, "src", "index.ts"), 'export const status: number = "ready";\n', "utf8");
      await fs.writeFile(path.join(projectPath, "build.cjs"), "process.exit(0);\n", "utf8");
      await fs.writeFile(path.join(projectPath, "server.cjs"), 'const http=require("http"),fs=require("fs"),path=require("path");const i=process.argv.indexOf("--port"),port=Number(i>=0?process.argv[i+1]:process.env.PORT);http.createServer((q,r)=>{const broken=fs.readFileSync(path.join(__dirname,"src/index.ts"),"utf8").includes(": number");r.statusCode=broken?500:200;r.setHeader("content-type","text/html");r.end(broken?"broken":"<a href=\\"/healthy\\">healthy</a>")}).listen(port,"127.0.0.1");', "utf8");
      process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
      await setProjectTrust(workspaceRoot, projectPath, "trusted");
      const project = await makeProjectSummary(projectPath);
      projectId = project.id;
      const profile = await detectProjectProfile(project);
      await startPreview(project.id, project.path, profile);
      const failing = await waitForPreviewHealth(project.id, 10_000, 100);
      expect(failing.health?.ok).toBe(false);
      const scan = await scanProject(project);
      const issue = scan.issues.find((entry) => entry.category === "typecheck" && entry.file === "src/index.ts");
      expect(issue).toBeTruthy();
      const result = await executePreviewFixVerify(project, issue!.id);
      expect(result).toMatchObject({ ok: true, rolledBack: false, previewAfter: { health: { ok: true } } });
      expect(result.stages.map((stage) => `${stage.id}:${stage.state}`)).toEqual(expect.arrayContaining(["preview-evidence:PASSED", "snapshot:PASSED", "fix:PASSED", "typecheck:PASSED", "build:PASSED", "preview-restart:PASSED", "preview-verify:PASSED"]));
      expect(await fs.readFile(path.join(projectPath, "src", "index.ts"), "utf8")).toContain('status: string = "ready"');

      await fs.writeFile(path.join(projectPath, "src", "index.ts"), 'export const status: number = "ready";\n', "utf8");
      await fs.writeFile(path.join(projectPath, "build.cjs"), "process.exit(9);\n", "utf8");
      const failingAgain = await waitForPreviewHealth(project.id, 2_000, 100);
      expect(failingAgain.health?.ok).toBe(false);
      const failed = await executePreviewFixVerify(project, issue!.id);
      expect(failed).toMatchObject({ ok: false, rolledBack: true });
      expect(failed.stages.map((stage) => `${stage.id}:${stage.state}`)).toEqual(expect.arrayContaining(["build:FAILED", "rollback:PASSED"]));
      expect(await fs.readFile(path.join(projectPath, "src", "index.ts"), "utf8")).toContain('status: number = "ready"');
    } finally {
      if (projectId) await stopPreviewAndWait(projectId);
      if (previousWorkspaceRoot === undefined) delete process.env.KFORGE_WORKSPACE_ROOT;
      else process.env.KFORGE_WORKSPACE_ROOT = previousWorkspaceRoot;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it("restores the latest completed verification evidence and preserves fresher in-memory results", () => {
    const projectId = "evidence-project";
    const tasks: KForgeTask[] = [
      { id: "test-old", projectId, kind: "test", status: "succeeded", progress: 100, logs: [], startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z", exitCode: 0, output: "old test pass" },
      { id: "test-new", projectId, kind: "test", status: "failed", progress: 100, logs: [], startedAt: "2026-01-02T00:00:00.000Z", finishedAt: "2026-01-02T00:01:00.000Z", exitCode: 1, error: "new test failure", output: "new test failure" },
      { id: "typecheck", projectId, kind: "typecheck", status: "succeeded", progress: 100, logs: [], startedAt: "2026-01-03T00:00:00.000Z", finishedAt: "2026-01-03T00:01:00.000Z", exitCode: 0, output: "typecheck pass" },
      { id: "agent", projectId, kind: "agent", status: "succeeded", progress: 100, logs: [], startedAt: "2026-01-04T00:00:00.000Z", finishedAt: "2026-01-04T00:01:00.000Z", output: "not a command result" },
    ];
    const evidence = actionEvidenceFromTasks(tasks, {
      test: { action: "test", projectId, ok: true, startedAt: "2026-01-05T00:00:00.000Z", completedAt: "2026-01-05T00:01:00.000Z", exitCode: 0, output: "current test pass", message: "Test completed successfully.", transparency: { execution: "LOCAL", network: "NOT_REQUIRED", dataClasses: ["PROJECT_CONTEXT"], projectSourceSent: false, secretRedaction: true, provider: "Local project toolchain", destination: "Selected project process", purpose: "Run tests.", confirmation: "NOT_REQUIRED", startedAt: "2026-01-05T00:00:00.000Z", completedAt: "2026-01-05T00:01:00.000Z", durationMs: 60_000, result: "SUCCEEDED" } },
    });
    expect(evidence.test).toMatchObject({ ok: true, output: "current test pass" });
    expect(evidence.typecheck).toMatchObject({ ok: true, output: "typecheck pass" });
    expect(evidence.build).toBeUndefined();
  });

  it("marks persisted command evidence as stale after the explicit freshness window", () => {
    const completedAt = new Date(Date.now() - STALE_TASK_EVIDENCE_MS - 1_000).toISOString();
    const details = taskEvidenceDetails({ action: "test", projectId: "freshness-project", ok: true, startedAt: completedAt, completedAt, output: "pass", message: "persisted pass", evidenceSource: "persisted", transparency: { execution: "LOCAL", network: "NOT_REQUIRED", dataClasses: ["PROJECT_CONTEXT"], projectSourceSent: false, secretRedaction: true, provider: "Local project toolchain", destination: "Selected project process", purpose: "Run tests.", confirmation: "NOT_REQUIRED", startedAt: completedAt, completedAt, durationMs: 0, result: "SUCCEEDED" } });
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

  it("separates synthetic test credential patterns from production security blockers", () => {
    expect(nonProductionSecurityEvidence("server/services/redaction.spec.ts")).toBe(true);
    expect(nonProductionSecurityEvidence("fixtures/security/token.ts")).toBe(true);
    expect(nonProductionSecurityEvidence("server/services/provider.ts")).toBe(false);
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
