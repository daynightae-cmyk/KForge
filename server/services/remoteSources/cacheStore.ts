import { promises as fs } from "fs";
import { randomUUID, createHash } from "crypto";
import path from "path";
import { z } from "zod";
import type { RemoteSourceId } from "./contracts";

/**
 * Bounded local cache for remote catalog reads (Slice 1).
 *
 * Compatible with the existing KForge atomic-store pattern (temp file +
 * fsync + rename) and kept under `.kforge/remote-sources/` so the existing
 * `.kforge` persistence remains the primary local authority. No cloud
 * database, no SQLite: a bounded per-source file cache is sufficient for P0
 * catalog/search scale.
 */

export const REMOTE_CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
export const DEFAULT_CACHE_MAX_ENTRIES = 50;

const cacheEnvelopeSchema = z.object({
  version: z.literal(REMOTE_CACHE_SCHEMA_VERSION),
  sourceId: z.string().min(1),
  key: z.string().min(1),
  url: z.string().min(1),
  fetchedAt: z.string().min(1),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  cacheControl: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  data: z.unknown(),
});

export interface RemoteCacheEntry {
  sourceId: RemoteSourceId;
  key: string;
  url: string;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  cacheControl?: string;
  bytes: number;
  data: unknown;
}

export interface RemoteCacheInput extends Omit<RemoteCacheEntry, "sourceId" | "bytes"> {
  sourceId: RemoteSourceId;
}

/** Deterministic, traversal-safe cache key for a source request. */
export function remoteCacheKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function sourceDir(workspaceRoot: string, sourceId: RemoteSourceId): string {
  return path.join(path.resolve(workspaceRoot), ".kforge", "remote-sources", sourceId);
}

function entryPath(workspaceRoot: string, sourceId: RemoteSourceId, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Remote cache key must be a sha256 hex digest.");
  return path.join(sourceDir(workspaceRoot, sourceId), `${key}.json`);
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Persist one bounded cache entry and evict the oldest entries past the bound. */
export async function writeRemoteCache(
  workspaceRoot: string,
  entry: RemoteCacheInput,
  options: { ttlMs?: number; maxEntries?: number } = {},
): Promise<RemoteCacheEntry> {
  const maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  const stored: RemoteCacheEntry = { ...entry, bytes: Buffer.byteLength(JSON.stringify(entry.data ?? null), "utf8") };
  await writeJsonAtomic(entryPath(workspaceRoot, entry.sourceId, entry.key), { version: REMOTE_CACHE_SCHEMA_VERSION, ...stored });
  await evictOldest(workspaceRoot, entry.sourceId, maxEntries).catch(() => undefined);
  return stored;
}

async function evictOldest(workspaceRoot: string, sourceId: RemoteSourceId, maxEntries: number): Promise<void> {
  const dir = sourceDir(workspaceRoot, sourceId);
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((file) => file.endsWith(".json"));
  if (files.length <= maxEntries) return;
  const stamped = await Promise.all(
    files.map(async (file) => {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as { fetchedAt?: unknown };
        const at = typeof raw.fetchedAt === "string" ? Date.parse(raw.fetchedAt) : Number.NaN;
        return { file, at: Number.isNaN(at) ? 0 : at };
      } catch {
        return { file, at: 0 };
      }
    }),
  );
  stamped.sort((left, right) => left.at - right.at);
  for (const victim of stamped.slice(0, files.length - maxEntries)) {
    await fs.rm(path.join(dir, victim.file), { force: true }).catch(() => undefined);
  }
}

/** Read a cache entry. Malformed files are treated as absent, never as truth. */
export async function readRemoteCache(
  workspaceRoot: string,
  sourceId: RemoteSourceId,
  key: string,
): Promise<RemoteCacheEntry | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(entryPath(workspaceRoot, sourceId, key), "utf8"));
    const validation = cacheEnvelopeSchema.safeParse(parsed);
    if (!validation.success || validation.data.sourceId !== sourceId || validation.data.key !== key) return null;
    const { version: _version, ...entry } = validation.data;
    return entry as RemoteCacheEntry;
  } catch {
    return null;
  }
}

export function cacheAgeMs(entry: RemoteCacheEntry, now = Date.now()): number {
  const at = Date.parse(entry.fetchedAt);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - at);
}

/** Fresh when younger than TTL; otherwise stale but still usable as fallback. */
export function isCacheFresh(entry: RemoteCacheEntry, ttlMs: number, now = Date.now()): boolean {
  return cacheAgeMs(entry, now) <= ttlMs;
}
