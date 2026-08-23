import { promises as fs } from "fs";
import path from "path";
import type { ProjectPerformanceStrategy } from "../../shared/workspace";

export interface BenchmarkEvidence {
  id: string;
  createdAt: string;
  fixture: { files: number; packages: number; sourceFiles: number };
  measurements: Record<string, number>;
}

export async function persistBenchmarkEvidence(workspaceRoot: string, evidence: BenchmarkEvidence) {
  const directory = path.join(workspaceRoot, ".kforge", "benchmarks");
  const target = path.join(directory, `${evidence.id}.json`);
  const temporary = `${target}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(evidence, null, 2), "utf8");
  await fs.rename(temporary, target);
  return { path: target, evidence };
}

export function chooseProjectPerformance(totalFiles: number, projectSizeBytes: number): ProjectPerformanceStrategy {
  const megabytes = projectSizeBytes / (1024 * 1024);
  if (totalFiles >= 20_000 || megabytes >= 1_024) {
    return { scale: "very-large", parallelism: 2, maxIndexedFiles: 20_000, graphDepth: 2, scannerConcurrency: 1, cacheEnabled: true, rationale: `Very Large: ${totalFiles.toLocaleString()} files / ${Math.round(megabytes)} MB; bounded indexing and shallow graph protect interactivity.` };
  }
  if (totalFiles >= 5_000 || megabytes >= 256) {
    return { scale: "large", parallelism: 3, maxIndexedFiles: 12_000, graphDepth: 3, scannerConcurrency: 2, cacheEnabled: true, rationale: `Large: ${totalFiles.toLocaleString()} files / ${Math.round(megabytes)} MB; incremental cached analysis is enabled.` };
  }
  if (totalFiles >= 1_000 || megabytes >= 64) {
    return { scale: "medium", parallelism: 4, maxIndexedFiles: 6_000, graphDepth: 4, scannerConcurrency: 3, cacheEnabled: true, rationale: `Medium: ${totalFiles.toLocaleString()} files / ${Math.round(megabytes)} MB; standard caching and bounded graph depth apply.` };
  }
  return { scale: "small", parallelism: 4, maxIndexedFiles: 2_000, graphDepth: 6, scannerConcurrency: 4, cacheEnabled: true, rationale: `Small: ${totalFiles.toLocaleString()} files / ${Math.round(megabytes)} MB; full local indexing is available.` };
}

const CACHE_FORMAT_VERSION = 1;

export interface CacheEntry<T> {
  version: number;
  projectPath: string;
  value: T;
  fingerprint: string;
  createdAt: string;
  hits: number;
  invalidations: number;
}

const caches = new Map<string, CacheEntry<unknown>>();

function identityFromKey(key: string) {
  const separator = key.lastIndexOf(":");
  return separator > 0 ? key.slice(0, separator) : "unknown";
}

export function readCache<T>(key: string, fingerprint: string): T | undefined {
  const entry = caches.get(key);
  if (!entry) return undefined;
  if (entry.version !== CACHE_FORMAT_VERSION || entry.projectPath !== identityFromKey(key) || typeof entry.fingerprint !== "string") {
    caches.delete(key);
    return undefined;
  }
  if (entry.fingerprint !== fingerprint) {
    entry.invalidations += 1;
    caches.delete(key);
    return undefined;
  }
  entry.hits += 1;
  return entry.value as T;
}

export function writeCache<T>(key: string, fingerprint: string, value: T) {
  caches.set(key, { version: CACHE_FORMAT_VERSION, projectPath: identityFromKey(key), value, fingerprint, createdAt: new Date().toISOString(), hits: 0, invalidations: 0 });
  return value;
}

export function clearProjectCache(projectPath: string) {
  let removed = 0;
  for (const key of caches.keys()) {
    if (key.startsWith(`${projectPath}:`)) { caches.delete(key); removed += 1; }
  }
  return { removed };
}

export function projectCacheStatus(projectPath: string) {
  return [...caches.entries()].filter(([key]) => key.startsWith(`${projectPath}:`)).map(([key, entry]) => ({ key: key.slice(projectPath.length + 1), version: entry.version, projectPath: entry.projectPath, createdAt: entry.createdAt, hits: entry.hits, invalidations: entry.invalidations, fingerprint: entry.fingerprint }));
}
