import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import type { ProjectProfile } from "../../shared/workspace";
import { listAgentTools, resolveAgentToolStatus, executeAgentTool } from "./agentTools";

function profile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    projectId: "project",
    rootPath: "/project",
    framework: ["React", "Vite"],
    languages: ["TypeScript"],
    packageManager: "npm",
    dependencies: [],
    scripts: { typecheck: "tsc --noEmit", lint: "eslint .", build: "vite build" },
    commands: { typecheck: "npm run typecheck", build: "npm run build", runtime: "npm run dev" },
    commandEvidence: [],
    manifests: ["package.json"],
    lockfiles: ["package-lock.json"],
    workspaceKind: "single",
    testRoots: [],
    performance: { scale: "small", parallelism: 1, maxIndexedFiles: 5_000, graphDepth: 8, scannerConcurrency: 1, cacheEnabled: true, rationale: "fixture" },
    envFiles: [], ci: [], docker: [], deployment: [], sourceFileCount: 1, totalFileCount: 1, projectSizeBytes: 10, sourceRoots: ["src"],
    fileDiscovery: { state: "COMPLETE", scannedCount: 1, totalOrUnknown: 1, limit: 20_000, reason: "fixture", source: "fixture" },
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KForge agent tool status semantics", () => {
  it("maps automatically executable tools to AVAILABLE", () => {
    expect(resolveAgentToolStatus({ permission: "safe" })).toBe("AVAILABLE");
  });

  it("maps confirmation-gated ask semantics to AVAILABLE_WITH_CONFIRMATION", () => {
    expect(resolveAgentToolStatus({ permission: "dangerous", requiresConfirmation: true })).toBe("AVAILABLE_WITH_CONFIRMATION");
  });

  it("maps safe-write tools to AVAILABLE_WITH_CONFIRMATION", () => {
    expect(resolveAgentToolStatus({ permission: "safe-write", requiresConfirmation: true })).toBe("AVAILABLE_WITH_CONFIRMATION");
  });

  it("maps blocked tools to BLOCKED even when a policy reason is present", () => {
    expect(resolveAgentToolStatus({ permission: "blocked", unavailableReason: "Forbidden by policy." })).toBe("BLOCKED");
  });

  it("maps unavailable executables to UNAVAILABLE", () => {
    expect(resolveAgentToolStatus({ permission: "safe", unavailableReason: "Executable not installed." })).toBe("UNAVAILABLE");
  });

  it("maps runtime detection failures to ERROR", () => {
    expect(resolveAgentToolStatus({ permission: "safe", runtimeError: "Probe timed out." })).toBe("ERROR");
  });

  it("uses canonical project commands as executable evidence when detailed command evidence is absent", () => {
    const tools = listAgentTools({ profile: profile(), trust: "trusted" });
    expect(tools.find((tool) => tool.name === "typecheck")).toMatchObject({ status: "AVAILABLE", evidence: { handler: "VERIFIED", runtime: "DETECTED" } });
    expect(tools.find((tool) => tool.name === "build")).toMatchObject({ status: "AVAILABLE", evidence: { handler: "VERIFIED", runtime: "DETECTED" } });
    expect(tools.find((tool) => tool.name === "test")).toMatchObject({ status: "UNAVAILABLE", evidence: { runtime: "NOT_DETECTED" } });
  });

  it("detects lint only from an explicit project lint script and never from definition existence", () => {
    const withLint = listAgentTools({ profile: profile(), trust: "trusted" }).find((tool) => tool.name === "lint");
    const withoutLint = listAgentTools({ profile: profile({ scripts: {} }), trust: "trusted" }).find((tool) => tool.name === "lint");
    expect(withLint).toMatchObject({ status: "AVAILABLE", evidence: { handler: "VERIFIED", runtime: "DETECTED" } });
    expect(withoutLint).toMatchObject({ status: "UNAVAILABLE", evidence: { handler: "VERIFIED", runtime: "NOT_DETECTED" } });
  });

  it("blocks executable tools for untrusted projects while leaving read-only inspection available", () => {
    const tools = listAgentTools({ profile: profile(), trust: "untrusted" });
    expect(tools.find((tool) => tool.name === "typecheck")?.status).toBe("UNAVAILABLE");
    expect(tools.find((tool) => tool.name === "read_file")?.status).toBe("AVAILABLE");
  });

  describe("P1 symlink / junction security boundary", () => {
    const fixturesDir = path.resolve(process.cwd(), "fixtures");

    it("lexical boundary rejects absolute external paths", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-abs-"));
      await fs.mkdir(root, { recursive: true });
      // Create a REAL absolute external file outside the project root for platform portability.
      const outsideDir = await fs.mkdtemp(path.join(fixturesDir, "security-abs-outside-"));
      await fs.writeFile(path.join(outsideDir, "secret.txt"), "KFORGE_EXTERNAL_SENTINEL", "utf8");
      const absoluteExternalPath = path.join(outsideDir, "secret.txt");
      const result = await executeAgentTool(root, { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) }, "read_file", { path: absoluteExternalPath });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("escapes");
      await fs.rm(outsideDir, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    });

    it("lexical boundary rejects relative parent escapes", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-rel-"));
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, "file.txt"), "hello", "utf8");
      const result = await executeAgentTool(root, { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) }, "read_file", { path: "../secret.txt" });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("escapes");
      await fs.rm(root, { recursive: true, force: true });
    });

    it("external file symlink is blocked for read_file and inspect_file", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-symlink-file-"));
      await fs.mkdir(path.join(root, "project"), { recursive: true });
      const outsideDir = await fs.mkdtemp(path.join(fixturesDir, "security-symlink-outside-"));
      await fs.writeFile(path.join(outsideDir, "secret.txt"), "KFORGE_EXTERNAL_SENTINEL_DO_NOT_READ", "utf8");
      await fs.symlink(path.join(outsideDir, "secret.txt"), path.join(root, "project", "external-secret.txt"));

      const handlers = { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) };

      const readResult = await executeAgentTool(path.join(root, "project"), handlers, "read_file", { path: "external-secret.txt" });
      expect(readResult.ok).toBe(false);
      expect(readResult.message).toContain("outside");

      const inspectResult = await executeAgentTool(path.join(root, "project"), handlers, "inspect_file", { path: "external-secret.txt" });
      expect(inspectResult.ok).toBe(false);
      expect(inspectResult.message).toContain("outside");

      await fs.rm(outsideDir, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    });

    it("external directory symlink is blocked for list_files, read_file, inspect_file", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-symlink-dir-"));
      await fs.mkdir(path.join(root, "project"), { recursive: true });
      const outsideDir = await fs.mkdtemp(path.join(fixturesDir, "security-symlink-dir-outside-"));
      await fs.mkdir(path.join(outsideDir, "sub"), { recursive: true });
      await fs.writeFile(path.join(outsideDir, "sub", "secret.ts"), "export const SECRET = 'KFORGE_EXTERNAL_SENTINEL';", "utf8");
      await fs.symlink(outsideDir, path.join(root, "project", "outside-link"));

      const handlers = { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) };

      const listResult = await executeAgentTool(path.join(root, "project"), handlers, "list_files", { directory: "outside-link" });
      expect(listResult.ok).toBe(false);
      expect(listResult.message).toContain("outside");

      const readResult = await executeAgentTool(path.join(root, "project"), handlers, "read_file", { path: "outside-link/sub/secret.ts" });
      expect(readResult.ok).toBe(false);
      expect(readResult.message).toContain("outside");

      const inspectResult = await executeAgentTool(path.join(root, "project"), handlers, "inspect_file", { path: "outside-link/sub/secret.ts" });
      expect(inspectResult.ok).toBe(false);
      expect(inspectResult.message).toContain("outside");

      await fs.rm(outsideDir, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    });

    it("search_files does not leak external symlink contents", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-search-"));
      await fs.mkdir(path.join(root, "project"), { recursive: true });
      await fs.writeFile(path.join(root, "project", "real.ts"), "export const A = 1;", "utf8");
      const outsideDir = await fs.mkdtemp(path.join(fixturesDir, "security-search-outside-"));
      await fs.writeFile(path.join(outsideDir, "secret.ts"), "export const EXTERNAL_ONLY_SYMBOL = 'KFORGE_EXTERNAL_SENTINEL';", "utf8");
      await fs.symlink(path.join(outsideDir, "secret.ts"), path.join(root, "project", "external-secret.ts"));

      const handlers = { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) };

      const searchResult = await executeAgentTool(path.join(root, "project"), handlers, "search_files", { query: "EXTERNAL_ONLY_SYMBOL" });
      expect(searchResult.ok).toBe(true);
      expect((searchResult.output as Array<{ path: string }>).length).toBe(0);

      const symbolResult = await executeAgentTool(path.join(root, "project"), handlers, "find_symbol", { query: "EXTERNAL_ONLY_SYMBOL" });
      expect(symbolResult.ok).toBe(true);
      expect((symbolResult.output as Array<{ path: string }>).length).toBe(0);

      await fs.rm(outsideDir, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    });

    it("normal project file read and inspect remain available", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-normal-"));
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "index.ts"), "export const STATUS = 1;", "utf8");

      const handlers = { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) };

      const readResult = await executeAgentTool(root, handlers, "read_file", { path: "src/index.ts" });
      expect(readResult.ok).toBe(true);
      expect((readResult.output as { path: string }).path).toBe("src/index.ts");

      const inspectResult = await executeAgentTool(root, handlers, "inspect_file", { path: "src/index.ts" });
      expect(inspectResult.ok).toBe(true);

      await fs.rm(root, { recursive: true, force: true });
    });

    it("in-project file symlink is allowed after realpath containment (read_file)", async () => {
      const root = await fs.mkdtemp(path.join(fixturesDir, "security-internal-symlink-"));
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "real.ts"), "export const INTERNAL = 1;", "utf8");
      await fs.symlink(path.join(root, "src", "real.ts"), path.join(root, "src", "link-inside.ts"));

      const handlers = { typecheck: async () => ({}), lint: async () => ({}), test: async () => ({}), build: async () => ({}), start: async () => ({}), health: async () => ({}), logs: async () => ({}), gitStatus: async () => ({}), gitDiff: async () => ({}), scan: async () => ({}), sonar: async () => ({}), graph: async () => ({}), dependencyAudit: async () => ({}) };

      const readResult = await executeAgentTool(root, handlers, "read_file", { path: "src/link-inside.ts" });
      expect(readResult.ok).toBe(true);
      expect((readResult.output as { content: string }).content).toContain("INTERNAL");

      await fs.rm(root, { recursive: true, force: true });
    });
  });
});
