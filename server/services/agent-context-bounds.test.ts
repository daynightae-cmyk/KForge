import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildAgentContext, collectProjectFiles, contextScanSummary } from "./agent";
import type { ProjectSummary, ProjectScan } from "../../shared/workspace";

function makeProject(root: string): ProjectSummary {
  return {
    name: "test",
    path: root,
    branch: "main",
    projectType: "node",
  } as ProjectSummary;
}

function makeScan(): ProjectScan {
  return {
    technology: [],
    profile: { commands: {} } as any,
    git: {} as any,
    issues: [],
  } as ProjectScan;
}

describe("KForge agent context scan bounds", () => {
  it("completes on a small repository", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
      expect(result.status).toBe("COMPLETE");
      expect(result.complete).toBe(true);
      expect(result.truncated).toBe(false);
      expect(result.files).toContain("src/a.ts");
      expect(result.unreadable).toEqual([]);
      expect(result.unreadableTruncated).toBe(false);
      expect(result.stopReasons).toEqual([]);
      expect(result.skippedLinks).toBe(0);
      expect(result.skippedOutsideRoot).toEqual([]);
      const summary = contextScanSummary({ contextScan: result } as never);
      expect(summary.status).toBe("COMPLETE");
      expect(summary.unreadableCount).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("truncates and reports partial metadata on a large tree", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      // Create 200 files to exceed a small maxFiles bound.
      const dir = path.join(root, "many");
      await fs.mkdir(dir, { recursive: true });
      for (let i = 0; i < 200; i += 1) {
        await fs.writeFile(path.join(dir, `f${i}.ts`), "export const x = 1;\n", "utf8");
      }
      const result = await collectProjectFiles(root, { maxFiles: 50, maxDepth: 5, timeBudgetMs: 5000 });
      expect(result.truncated).toBe(true);
      expect(result.complete).toBe(false);
      expect(result.status).toBe("PARTIAL");
      expect(result.unreadable).toEqual([]);
      expect(result.stopReasons).toContain("max-files");
      expect(result.files.length).toBeLessThanOrEqual(50);
      expect(result.filesScanned).toBeGreaterThanOrEqual(50);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("excludes dependency/generated directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
      await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "x", "utf8");
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
      expect(result.files).toContain("src/a.ts");
      expect(result.files.some((f) => f.includes("node_modules"))).toBe(false);
      expect(result.excluded).toContain("node_modules");
      expect(result.status).toBe("COMPLETE");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports a missing repository root as failed instead of complete", async () => {
    const missing = path.join(os.tmpdir(), `kforge-ctx-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const result = await collectProjectFiles(missing, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
    expect(result.status).toBe("FAILED");
    expect(result.complete).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.filesScanned).toBe(0);
    expect(result.unreadable).toEqual([{ path: ".", reason: "ENOENT" }]);
  });

  it("reports an injected root readdir failure as failed without inventing completion", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n", "utf8");
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000, injectedWalkFailure: { directory: "", code: "EACCES" } });
      expect(result.status).toBe("FAILED");
      expect(result.complete).toBe(false);
      expect(result.files).toEqual([]);
      expect(result.unreadable).toEqual([{ path: ".", reason: "EACCES" }]);
      expect(contextScanSummary({ contextScan: result } as never)).toMatchObject({ status: "FAILED", unreadableCount: 1 });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps available results and reports partial when a subtree cannot be read", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
      await fs.mkdir(path.join(root, "locked"), { recursive: true });
      await fs.writeFile(path.join(root, "locked", "b.ts"), "export const b = 2;\n", "utf8");
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000, injectedWalkFailure: { directory: "locked", code: "EIO" } });
      expect(result.status).toBe("PARTIAL");
      expect(result.complete).toBe(false);
      expect(result.files).toContain("src/a.ts");
      expect(result.files.some((f) => f.startsWith("locked/"))).toBe(false);
      expect(result.unreadable).toEqual([{ path: "locked", reason: "EIO" }]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("models a subtree that disappears after its parent was listed as a partial read failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.writeFile(path.join(root, "canonical.ts"), "export const c = 3;\n", "utf8");
      // The directory exists while the parent walk lists it, then its own readdir
      // fails the way ENOENT behaves after a removal between the two fs calls.
      await fs.mkdir(path.join(root, "gone"), { recursive: true });
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000, injectedWalkFailure: { directory: "gone", code: "ENOENT" } });
      expect(result.status).toBe("PARTIAL");
      expect(result.complete).toBe(false);
      expect(result.files).toContain("canonical.ts");
      expect(result.unreadable).toEqual([{ path: "gone", reason: "ENOENT" }]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not follow symlinks during enumeration", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-outside-"));
    try {
      await fs.mkdir(path.join(outsideDir, "deep"), { recursive: true });
      for (let i = 0; i < 5; i += 1) {
        await fs.writeFile(path.join(outsideDir, "deep", `o${i}.ts`), "x", "utf8");
      }
      const linkPath = path.join(root, "linked");
      let junctionCreated = true;
      try {
        await fs.symlink(outsideDir, linkPath, "junction");
      } catch (error) {
        junctionCreated = false;
        console.warn("junction creation skipped:", (error as Error).message);
      }
      if (!junctionCreated) return;
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
      expect(result.files.some((f) => f.includes("linked"))).toBe(false);
      expect(result.skippedLinks).toBe(1);
      expect(result.status).toBe("COMPLETE");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("keeps boundary metadata empty for a plain pattern-search tree", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "nested"), { recursive: true });
      await fs.writeFile(path.join(root, "nested", "m.ts"), "export const m = 1;\n", "utf8");
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
      expect(result.status).toBe("COMPLETE");
      expect(result.skippedOutsideRoot).toEqual([]);
      expect(result.skippedLinks).toBe(0);
      expect(result.files).toContain("nested/m.ts");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("counts nested junctions as skipped links without enumerating their targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-outside-"));
    try {
      await fs.mkdir(path.join(outsideDir, "deep"), { recursive: true });
      await fs.writeFile(path.join(outsideDir, "deep", "s.ts"), "x", "utf8");
      await fs.mkdir(path.join(root, "nested"), { recursive: true });
      await fs.writeFile(path.join(root, "nested", "m.ts"), "x", "utf8");
      const linkPath = path.join(root, "nested", "linked");
      let junctionCreated = true;
      try {
        await fs.symlink(outsideDir, linkPath, "junction");
      } catch (error) {
        junctionCreated = false;
        console.warn("junction creation skipped:", (error as Error).message);
      }
      if (!junctionCreated) return;
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
      expect(result.files.some((f) => f.includes("linked/") || f.startsWith("linked/"))).toBe(false);
      expect(result.skippedLinks).toBe(1);
      expect(result.status).toBe("COMPLETE");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("handles cancellation/time budget gracefully", { timeout: 30_000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      const dir = path.join(root, "many");
      await fs.mkdir(dir, { recursive: true });
      for (let i = 0; i < 500; i += 1) {
        await fs.writeFile(path.join(dir, `f${i}.ts`), "export const x = 1;\n", "utf8");
      }
      const result = await collectProjectFiles(root, { maxFiles: 100000, maxDepth: 10, timeBudgetMs: 1 });
      // With a 1ms budget, should truncate (unless very fast). Accept either but metadata consistent.
      expect(typeof result.elapsedMs).toBe("number");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      if (result.truncated) {
        expect(result.status).toBe("PARTIAL");
        expect(result.complete).toBe(false);
        expect(result.stopReasons).toContain("time-budget");
      } else {
        expect(result.status).toBe("COMPLETE");
      }
      expect(result.stopReasons.every((reason) => ["max-depth", "max-files", "time-budget", "walk-error"].includes(reason))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("buildAgentContext reports SKIPPED scan truth when no active problem selects it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "feature.ts"), "export const feature = 1;\n", "utf8");
      await fs.writeFile(path.join(root, "src", "feature.test.ts"), "test('x',()=>{})\n", "utf8");
      const ctx = await buildAgentContext(makeProject(root), makeScan(), undefined);
      expect(ctx.contextScan).toBeDefined();
      expect(ctx.contextScan?.status).toBe("SKIPPED");
      expect(ctx.contextScan?.complete).toBe(false);
      expect(ctx.contextScan?.filesScanned).toBe(0);
      expect(typeof ctx.contextScan?.elapsedMs).toBe("number");
      expect(contextScanSummary(ctx)).toMatchObject({ status: "SKIPPED", unreadableCount: 0 });
      // config files still read
      expect(ctx.files.length).toBeLessThanOrEqual(10);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("buildAgentContext exposes scan metadata and selects related tests for an active problem", { timeout: 20_000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "feature.ts"), "export const feature = 1;\n", "utf8");
      await fs.writeFile(path.join(root, "src", "feature.test.ts"), "test('x',()=>{})\n", "utf8");
      const scan = {
        technology: [],
        profile: { commands: {} },
        git: {},
        issues: [{ id: "i1", title: "Literal mismatch", message: "not assignable", description: "", file: "src/feature.ts", line: 1, severity: "high", category: "typecheck", source: "local", suggestion: "", rule: "TS2322", risk: "" }],
      } as unknown as ProjectScan;
      const ctx = await buildAgentContext(makeProject(root), scan, "i1");
      expect(ctx.contextScan?.status).toBe("COMPLETE");
      expect(ctx.contextScan?.complete).toBe(true);
      expect(ctx.contextScan?.filesMatched).toBeGreaterThan(0);
      expect(ctx.files.some((entry) => entry.reason === "related-test")).toBe(true);
      expect(contextScanSummary(ctx).unreadableCount).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
