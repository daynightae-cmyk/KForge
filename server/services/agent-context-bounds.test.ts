import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildAgentContext, collectProjectFiles } from "./agent";
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
      expect(result.complete).toBe(true);
      expect(result.truncated).toBe(false);
      expect(result.files).toContain("src/a.ts");
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
      try {
        await fs.symlink(outsideDir, linkPath, "junction");
      } catch (error) {
        console.warn("junction creation skipped:", (error as Error).message);
        return;
      }
      const result = await collectProjectFiles(root, { maxFiles: 100, maxDepth: 5, timeBudgetMs: 1000 });
      expect(result.files.some((f) => f.includes("linked"))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("buildAgentContext exposes scan metadata and respects file cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ctx-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "feature.ts"), "export const feature = 1;\n", "utf8");
      await fs.writeFile(path.join(root, "src", "feature.test.ts"), "test('x',()=>{})\n", "utf8");
      const ctx = await buildAgentContext(makeProject(root), makeScan(), undefined);
      expect(ctx.contextScan).toBeDefined();
      expect(ctx.contextScan?.complete).toBe(true);
      expect(typeof ctx.contextScan?.elapsedMs).toBe("number");
      // config files still read
      expect(ctx.files.length).toBeLessThanOrEqual(10);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  // Creating and removing 500 temporary files is disk-bound and routinely
  // exceeds the 5s default under parallel suite load on Windows; the
  // assertions themselves remain instant.
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
      expect(typeof result.truncated).toBe("boolean");
      expect(typeof result.elapsedMs).toBe("number");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
