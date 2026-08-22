import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export interface SnapshotFile {
  path: string;
  existed: boolean;
  contentBase64?: string;
}

export interface SnapshotManifest {
  id: string;
  projectPath: string;
  createdAt: string;
  reason: string;
  files: SnapshotFile[];
}

function snapshotDirectory(projectPath: string) {
  return path.join(projectPath, ".kforge", "snapshots");
}

function resolveSafeProjectFile(projectPath: string, file: string) {
  const resolved = path.resolve(projectPath, file);
  const relative = path.relative(projectPath, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Snapshot paths must refer to files inside the project root.");
  return { resolved, relative: relative.replace(/\\/g, "/") };
}

export async function createSnapshot(projectPath: string, files: string[], reason: string): Promise<SnapshotManifest> {
  if (!files.length) throw new Error("Select at least one project file for a snapshot.");
  const snapshotFiles: SnapshotFile[] = [];
  for (const file of [...new Set(files)]) {
    const safe = resolveSafeProjectFile(projectPath, file);
    try {
      const content = await fs.readFile(safe.resolved);
      snapshotFiles.push({ path: safe.relative, existed: true, contentBase64: content.toString("base64") });
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT") snapshotFiles.push({ path: safe.relative, existed: false });
      else throw error;
    }
  }
  const manifest: SnapshotManifest = { id: `${Date.now()}-${randomUUID()}`, projectPath, createdAt: new Date().toISOString(), reason, files: snapshotFiles };
  const target = path.join(snapshotDirectory(projectPath), manifest.id);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export async function listSnapshots(projectPath: string): Promise<SnapshotManifest[]> {
  const root = snapshotDirectory(projectPath);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const manifests = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try { return JSON.parse(await fs.readFile(path.join(root, entry.name, "manifest.json"), "utf8")) as SnapshotManifest; } catch { return null; }
  }));
  return manifests.filter((manifest): manifest is SnapshotManifest => manifest !== null).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function restoreSnapshot(projectPath: string, snapshotId: string): Promise<SnapshotManifest> {
  const manifestPath = path.join(snapshotDirectory(projectPath), snapshotId, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SnapshotManifest;
  if (path.resolve(manifest.projectPath) !== path.resolve(projectPath)) throw new Error("Snapshot does not belong to this project.");
  for (const file of manifest.files) {
    const safe = resolveSafeProjectFile(projectPath, file.path);
    if (file.existed && file.contentBase64 !== undefined) {
      await fs.mkdir(path.dirname(safe.resolved), { recursive: true });
      await fs.writeFile(safe.resolved, Buffer.from(file.contentBase64, "base64"));
    } else {
      await fs.rm(safe.resolved, { force: true });
    }
  }
  return manifest;
}
