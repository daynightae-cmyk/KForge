import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { createSnapshot, restoreSnapshot } from "../services/snapshots";
import { getLocalPlatformStatus, setLocalPlatformMode } from "../services/localPlatform";
import { getProjectTrust, setProjectTrust } from "../services/projectTrust";
import { applyDocumentationFix, auditDocumentation, previewDocumentationFix } from "../services/documentationAudit";
import { detectProjectProfile, executeProjectAction, makeProjectSummary, scanProject } from "./workspace";

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
  });

  it("normalizes a TypeScript compiler failure into a typecheck diagnostic", async () => {
    const project = await makeProjectSummary(fixture("workspace-broken-typescript"));
    const scan = await scanProject(project);
    expect(scan.summaries.typecheck).toBe("fail");
    expect(scan.issues.some((entry) => entry.category === "typecheck" && entry.source === "TypeScript")).toBe(true);
  }, 45_000);

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
