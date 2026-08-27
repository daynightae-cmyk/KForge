import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";

export interface ProjectCollectionEntry {
  path: string;
  lastOpenedAt?: string;
  lastScannedAt?: string;
  lastTaskAt?: string;
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
}

export interface ProjectCollectionPatch {
  favorite?: boolean;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
}

interface CollectionStore {
  version: 1;
  projects: Record<string, ProjectCollectionEntry>;
}

const defaultStore = (): CollectionStore => ({ version: 1, projects: {} });

function normalize(projectPath: string) {
  return path.resolve(projectPath);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  const tags = new Map<string, string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const tag = candidate.trim().replace(/\s+/g, " ");
    if (!tag || tag.length > 48) continue;
    tags.set(tag.toLocaleLowerCase(), tag);
    if (tags.size >= 20) break;
  }
  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

function blankEntry(projectPath: string): ProjectCollectionEntry {
  return { path: normalize(projectPath), favorite: false, pinned: false, archived: false, tags: [] };
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
        lastScannedAt: typeof entry.lastScannedAt === "string" ? entry.lastScannedAt : undefined,
        lastTaskAt: typeof entry.lastTaskAt === "string" ? entry.lastTaskAt : undefined,
        tags: normalizeTags(entry.tags),
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
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
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
  return store.projects[normalized] || blankEntry(normalized);
}

export async function recordProjectOpened(workspaceRoot: string, projectPath: string) {
  const normalized = normalize(projectPath);
  const store = await readStore(workspaceRoot);
  const current = store.projects[normalized] || blankEntry(normalized);
  const entry = { ...current, path: normalized, lastOpenedAt: new Date().toISOString() };
  store.projects[normalized] = entry;
  await writeStore(workspaceRoot, store);
  return entry;
}

export async function updateProjectCollection(workspaceRoot: string, projectPath: string, patch: ProjectCollectionPatch) {
  const normalized = normalize(projectPath);
  const store = await readStore(workspaceRoot);
  const current = store.projects[normalized] || blankEntry(normalized);
  const entry = { ...current, ...patch, tags: patch.tags ? normalizeTags(patch.tags) : current.tags, path: normalized };
  store.projects[normalized] = entry;
  await writeStore(workspaceRoot, store);
  return entry;
}

async function recordProjectTimestamp(workspaceRoot: string, projectPath: string, key: "lastScannedAt" | "lastTaskAt") {
  const normalized = normalize(projectPath);
  const store = await readStore(workspaceRoot);
  const current = store.projects[normalized] || blankEntry(normalized);
  const entry = { ...current, path: normalized, [key]: new Date().toISOString() };
  store.projects[normalized] = entry;
  await writeStore(workspaceRoot, store);
  return entry;
}

export async function recordProjectScanned(workspaceRoot: string, projectPath: string) {
  return recordProjectTimestamp(workspaceRoot, projectPath, "lastScannedAt");
}

export async function recordProjectTask(workspaceRoot: string, projectPath: string) {
  return recordProjectTimestamp(workspaceRoot, projectPath, "lastTaskAt");
}

export function collectionCategories(entry: ProjectCollectionEntry) {
  return {
    recent: Boolean(entry.lastOpenedAt),
    favorite: entry.favorite,
    pinned: entry.pinned,
    archive: entry.archived,
  };
}
