import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, revalidateRemoteCache, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  PYPI_BASE_URL,
  PYPI_SOURCE_ID,
  buildPypiPackageUrl,
  normalizePypiPackage,
  parsePypiPackageResponse,
  pypiPackageToMarketplaceItem,
  validatedPypiPackageName,
  validatedPypiVersion,
} from "./adapters/pypi";

/**
 * PyPI read service: explicit action → policy gate → bounded cache → safe fetch
 * (P1-2). Catalog presence is not installation. Every attempt records redacted
 * contact under marketplace-registry.
 */

export interface PypiServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface PypiPackageResult {
  item: MarketplaceItem;
  versions: string[];
  evidence: PypiServiceEvidence;
  transparency: OperationTransparency;
}

export interface PypiSearchResult {
  items: MarketplaceItem[];
  evidence: PypiServiceEvidence;
  transparency: OperationTransparency;
}

interface ServiceInput {
  workspaceRoot: string;
  networkAllowed: boolean;
  fetchImpl?: FetchImpl;
  now?: string;
  hostResolver?: SafeFetchPolicy["hostResolver"];
  timeoutMs?: number;
  maxRetries?: number;
}

function policyOverrides(input: ServiceInput): Pick<SafeFetchPolicy, "timeoutMs" | "maxRetries" | "hostResolver"> {
  return {
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
    ...(input.hostResolver ? { hostResolver: input.hostResolver } : {}),
  };
}

const DESTINATION = "https://pypi.org";

function sourceOrThrow() {
  const source = getRemoteSource(PYPI_SOURCE_ID);
  if (!source) throw new Error("PyPI: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "PyPI: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(startedAt: string): Omit<PypiServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return { sourceId: PYPI_SOURCE_ID, destination: DESTINATION, method: "GET", startedAt, rateLimit: { observed429: false, source: "Python Package Index" } };
}

function transparencyFor(input: { purpose: string; startedAt: string; completedAt: string; result: "SUCCEEDED" | "FAILED" | "BLOCKED"; reason?: string; fromCache: boolean }): OperationTransparency {
  return createOperationTransparency({
    execution: input.fromCache ? "LOCAL" : "REMOTE",
    network: input.fromCache ? "NOT_REQUIRED" : "REQUIRED",
    dataClasses: ["METADATA"],
    projectSourceSent: false,
    provider: "Python Package Index",
    destination: DESTINATION,
    purpose: input.purpose,
    confirmation: "NOT_REQUIRED",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    result: input.result,
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

async function recordContact(workspaceRoot: string, attemptedAt: string, succeeded: boolean, error: string | null) {
  try {
    await recordRemoteContact(workspaceRoot, "marketplace-registry", { attemptedAt, succeeded, destination: DESTINATION, error });
  } catch {}
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

/** Explicit PyPI package detail (exact name). */
export async function getPypiPackage(input: ServiceInput & { name: string; version?: string }): Promise<PypiPackageResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const name = validatedPypiPackageName(input.name);
  const version = input.version ? validatedPypiVersion(input.version) : undefined;
  const url = buildPypiPackageUrl(PYPI_BASE_URL, name);
  const cacheKey = remoteCacheKey([PYPI_SOURCE_ID, "package", name.toLowerCase()]);
  const cached = await readRemoteCache(input.workspaceRoot, PYPI_SOURCE_ID, cacheKey);

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const normalized = normalizePypiPackage(parsePypiPackageResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED", version);
      return {
        item: pypiPackageToMarketplaceItem(normalized, completedAt),
        versions: normalized.versions,
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified, error: "OFFLINE: served from bounded cache; network access is disabled by the current operating mode." },
        transparency: transparencyFor({ purpose: "Explicit PyPI package detail served from bounded cache (offline mode).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    const completedAt = new Date().toISOString();
    const normalized = normalizePypiPackage(parsePypiPackageResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED", version);
    return {
      item: pypiPackageToMarketplaceItem(normalized, completedAt),
      versions: normalized.versions,
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: false, freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified },
      transparency: transparencyFor({ purpose: "Explicit PyPI package detail served from fresh bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
    };
  }

  try {
    const fetched = await safeFetchRemote(url, { sourceId: PYPI_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const normalized = normalizePypiPackage(parsePypiPackageResponse(rawText), fetched.notModified && cached ? cached.fetchedAt : completedAt, fetched.notModified ? "CACHE" : "LIVE", "CURRENT", version);
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
    } else if (!fetched.notModified) {
      await writeRemoteCache(input.workspaceRoot, { sourceId: PYPI_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }).catch(() => undefined);
    }
    return {
      item: pypiPackageToMarketplaceItem(normalized, completedAt),
      versions: normalized.versions,
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: fetched.notModified, fromCache: fetched.notModified, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached?.etag, lastModified: fetched.headers.lastModified ?? cached?.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit PyPI package detail fetched live.", startedAt, completedAt, result: "SUCCEEDED", fromCache: fetched.notModified }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "PyPI request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const normalized = normalizePypiPackage(parsePypiPackageResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "STALE", version);
      return {
        item: pypiPackageToMarketplaceItem(normalized, completedAt),
        versions: normalized.versions,
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, notModified: false, fromCache: true, stale: true, freshness: "STALE", etag: cached.etag, lastModified: cached.lastModified, error: `Provider failure; serving last-good cached package. ${message}`.slice(0, 500) },
        transparency: transparencyFor({ purpose: "Explicit PyPI package detail failed at provider; last-good cached package served as STALE.", startedAt, completedAt, result: "SUCCEEDED", reason: message.slice(0, 300), fromCache: true }),
      };
    }
    throw error;
  }
}

/** Explicit PyPI search: for PyPI, search is direct package lookup by exact name. Returns 0 or 1 item. */
export async function searchPypiPackages(input: ServiceInput & { text: string }): Promise<PypiSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  if (typeof input.text !== "string" || input.text.trim().length === 0 || input.text.length > 200) throw new Error("PyPI: search text must be 1-200 characters.");
  const name = validatedPypiPackageName(input.text.trim());
  try {
    const result = await getPypiPackage({ ...input, name });
    return { items: [result.item], evidence: result.evidence, transparency: result.transparency };
  } catch (error) {
    // If package not found (404) and no cache, return empty result as normal negative (not error) when explicitly searched?
    // For consistency, rethrow 404 as HTTP_ERROR; route will map to 404. Search wrapper should return empty on 404.
    if (error instanceof RemoteFetchError && error.httpStatus === 404) {
      const completedAt = new Date().toISOString();
      return {
        items: [],
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: 404, notModified: false, fromCache: false, stale: false, freshness: "UNKNOWN", error: "No PyPI package matched this query." },
        transparency: transparencyFor({ purpose: "Explicit PyPI search found no matching package.", startedAt, completedAt, result: "SUCCEEDED", fromCache: false }),
      };
    }
    throw error;
  }
}
