import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { healthCheckPackage, installPackage } from "./marketplace";
import { updatePackageSafely } from "./marketplaceLifecycleSafe";

const FIRST_PARTY_ID = "package:kforge:json-inspector";
const roots: string[] = [];

describe("Marketplace safe update boundary", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("removes operation staging when staged artifact verification fails before rollback begins", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-marketplace-safe-update-"));
    roots.push(workspaceRoot);

    const install = await installPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(install.stage).toBe("INSTALLED");

    const originalCopyFile = fs.copyFile.bind(fs);
    vi.spyOn(fs, "copyFile").mockImplementation(async (...args: Parameters<typeof fs.copyFile>) => {
      await originalCopyFile(...args);
      const destination = String(args[1]);
      if (destination.includes(`${path.sep}staging${path.sep}`)) {
        await fs.appendFile(destination, "\ncorrupted-after-copy\n", "utf8");
      }
    });

    const update = await updatePackageSafely(workspaceRoot, FIRST_PARTY_ID);
    expect(update.stage).toBe("FAILED");
    expect(update.rollback).toBe(false);

    const stagingRoot = path.join(workspaceRoot, ".kforge", "marketplace", "staging");
    const stagingEntries = await fs.readdir(stagingRoot).catch(() => [] as string[]);
    expect(stagingEntries).toEqual([]);

    const health = await healthCheckPackage(workspaceRoot, FIRST_PARTY_ID);
    expect(health).toMatchObject({ ok: true, installed: true, version: "1.0.0" });
  }, 15_000);
});
