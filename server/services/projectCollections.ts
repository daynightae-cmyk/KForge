import { promises as fs } from "fs";
import path from "path";

export interface ProjectCollectionEntry {
  path: string;
  lastOpenedAt?: string;
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
}

interface CollectionStore {
  version: 1;
  projects: Record<string, ProjectCollectionEntry>;
}

const defaultStore = (): CollectionStore => ({ version: 1, projects: {} });

function normalize(projectPath: string) {
  return path.resolve(projectPath);
}

async function readStore(workspaceRoot: string): Promise<CollectionStore> {
  const file = path.join(workspaceRoot, ".kforge", "project-collections.json");
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaultStore();
    const data = parsed as { version?: unknown; projects?: unknown };
    if (data.version !== 1 || typeof data.projects !== "object" || data.projects === null || Array.isArray(data.projects)) return defaultStore();
    const projects: Record<string, ProjectCollectionEntry> = {};
    for (const [key, value] of Object.entries(data.projects)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const entry = value as Partial<ProjectCollectionEntry>;
      const projectPath = typeof entry.path === "string" ? normalize(entry.path) : normalize(key);
      projects[projectPath] = {
        path: projectPath,
        lastOpenedAt: typeof entry.lastOpenedAt === "string" ? entry.lastOpenedAt : undefined,
        favorite: entry.favorite === true,
        pinned: entry.pinned === true,
        archived: entry.archived === true,
      };
    }
    return { version: 1, projects };
  } catch {
    return defaultStore();
  }
}

async function writeStore(workspaceRoot: string, store: CollectionStore) {
  const directory = path.join(workspaceRoot, ".kforge");
  const file = path.join(directory, "project-collections.json");
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

export async function listProjectCollectionEntries(workspaceRoot: string) {
  const store = await readStore(workspaceRoot);
  return Object.values(store.projects);
}

export async function getProjectCollectionEntry(workspaceRoot: string, projectPath: string) {
  const normalized = normalize(projectPath);
  const store = await readStore(workspaceRoot);
  return store.projects[normalized] || { path: normalized, favorite: false, pinned: false, archived: false };
}

export async function recordProjectOpened(workspaceRoot: string, projectPath: string) {
  const normalized = normalize(projectPath);
  const store = await readStore(workspaceRoot);
  const current = store.projects[normalized] || { path: normalized, favorite: false, pinned: false, archived: false };
  const entry = { ...current, path: normalized, lastOpenedAt: new Date().toISOString() };
  store.projects[normalized] = entry;
  await writeStore(workspaceRoot, store);
  return entry;
}

export async function updateProjectCollection(workspaceRoot: string, projectPath: string, patch: Partial<Pick<ProjectCollectionEntry, "favorite" | "pinned" | "archived">>) {
  const normalized = normalize(projectPath);
  const store = await readStore(workspaceRoot);
  const current = store.projects[normalized] || { path: normalized, favorite: false, pinned: false, archived: false };
  const entry = { ...current, ...patch, path: normalized };
  store.projects[normalized] = entry;
  await writeStore(workspaceRoot, store);
  return entry;
}

export function collectionCategories(entry: ProjectCollectionEntry) {
  return {
    recent: Boolean(entry.lastOpenedAt),
    favorite: entry.favorite,
    pinned: entry.pinned,
    archive: entry.archived,
  };
}
