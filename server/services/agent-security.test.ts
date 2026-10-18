import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { readContextFile, safeFile } from "./agent";

describe("KForge agent filesystem boundary", () => {
  it("allows a normal file inside the project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    try {
      const filePath = path.join(root, "src", "index.ts");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "export const value = 1;\n", "utf8");
      const safe = await safeFile(root, "src/index.ts");
      expect(safe.relative).toBe("src/index.ts");
      const entry = await readContextFile(root, "src/index.ts", "configuration", 1000);
      expect(entry).not.toBeNull();
      expect(entry?.path).toBe("src/index.ts");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("denies relative traversal outside the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    try {
      await expect(safeFile(root, "../outside.ts")).rejects.toThrow(/escaped|outside/i);
      const entry = await readContextFile(root, "../outside.ts", "configuration", 1000);
      expect(entry).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("denies an absolute external file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.txt");
      await fs.writeFile(outsideFile, "secret\n", "utf8");
      await expect(safeFile(root, outsideFile)).rejects.toThrow(/escaped|outside/i);
      const entry = await readContextFile(root, outsideFile, "configuration", 1000);
      expect(entry).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("denies a symlink pointing outside the root when creatable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.txt");
      await fs.writeFile(outsideFile, "secret\n", "utf8");
      const linkPath = path.join(root, "link.ts");
      try {
        await fs.symlink(outsideFile, linkPath, "file");
      } catch (error) {
        // Environment lacks symlink privileges; skip platform-specific assertion.
        console.warn("symlink creation skipped:", (error as Error).message);
        return;
      }
      await expect(safeFile(root, "link.ts")).rejects.toThrow(/outside|escaped/i);
      const entry = await readContextFile(root, "link.ts", "configuration", 1000);
      expect(entry).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("denies a junction/reparse point pointing outside when creatable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.txt");
      await fs.writeFile(outsideFile, "secret\n", "utf8");
      const junctionPath = path.join(root, "junctiondir");
      try {
        await fs.symlink(outsideDir, junctionPath, "junction");
      } catch (error) {
        console.warn("junction creation skipped:", (error as Error).message);
        return;
      }
      // A file reference through the junction should be denied.
      await expect(safeFile(root, "junctiondir/secret.txt")).rejects.toThrow(/outside|escaped/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("denies nested link ancestry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-outside-"));
    try {
      const outsideFile = path.join(outsideDir, "secret.txt");
      await fs.writeFile(outsideFile, "secret\n", "utf8");
      const innerDir = path.join(root, "inner");
      await fs.mkdir(innerDir, { recursive: true });
      const linkPath = path.join(innerDir, "escape.ts");
      try {
        await fs.symlink(outsideFile, linkPath, "file");
      } catch (error) {
        console.warn("symlink creation skipped:", (error as Error).message);
        return;
      }
      await expect(safeFile(root, "inner/escape.ts")).rejects.toThrow(/outside|escaped/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("returns a controlled result for a nonexistent path inside the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    try {
      const safe = await safeFile(root, "does/not/exist.ts");
      expect(safe.relative).toBe("does/not/exist.ts");
      const entry = await readContextFile(root, "does/not/exist.ts", "configuration", 1000);
      expect(entry).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves normal permitted project operations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-agent-"));
    try {
      await fs.writeFile(path.join(root, "package.json"), '{"name":"x"}\n', "utf8");
      const entry = await readContextFile(root, "package.json", "configuration", 1000);
      expect(entry).not.toBeNull();
      expect(entry?.content).toContain("name");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
