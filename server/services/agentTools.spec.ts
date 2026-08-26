import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "../../shared/workspace";
import { listAgentTools, resolveAgentToolStatus } from "./agentTools";

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
});
