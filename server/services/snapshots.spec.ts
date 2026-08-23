import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { createSnapshot, listSnapshots, restoreSnapshot } from "./snapshots";

describe("KForge snapshots", () => {
  it("restores real fixture bytes and leaves unrelated files unchanged", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-snapshot-fixture-"));
    const target = path.join(root, "src", "config.txt");
    const unrelated = path.join(root, "notes.txt");
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "original configuration\n", "utf8");
      await fs.writeFile(unrelated, "unrelated content\n", "utf8");

      const snapshot = await createSnapshot(root, ["src/config.txt"], "Real restore verification fixture");
      expect(snapshot.files).toEqual([{ path: "src/config.txt", existed: true, contentBase64: Buffer.from("original configuration\n").toString("base64") }]);
      expect((await listSnapshots(root)).map((entry) => entry.id)).toContain(snapshot.id);

      await fs.writeFile(target, "mutated configuration\n", "utf8");
      expect(await fs.readFile(target, "utf8")).toBe("mutated configuration\n");

      const restored = await restoreSnapshot(root, snapshot.id);
      expect(restored.id).toBe(snapshot.id);
      expect(restored.reason).toBe("Real restore verification fixture");
      expect(await fs.readFile(target, "utf8")).toBe("original configuration\n");
      expect(await fs.readFile(unrelated, "utf8")).toBe("unrelated content\n");
      await expect(fs.stat(path.join(root, ".kforge", "snapshots", snapshot.id, "manifest.json"))).resolves.toBeDefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });

  it("restores a non-existent snapshotted file by removing only that file", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-snapshot-absent-"));
    const generated = path.join(root, "generated.txt");
    const unrelated = path.join(root, "keep.txt");
    try {
      await fs.writeFile(unrelated, "keep\n", "utf8");
      const snapshot = await createSnapshot(root, ["generated.txt"], "Verify created file removal");
      await fs.writeFile(generated, "created after snapshot\n", "utf8");
      await restoreSnapshot(root, snapshot.id);
      await expect(fs.stat(generated)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(unrelated, "utf8")).toBe("keep\n");
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });
});
