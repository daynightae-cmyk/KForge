import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  WINGET_GITHUB_SEARCH_BASE,
  WINGET_RAW_BASE,
  WINGET_SOURCE_ID,
  buildWingetManifestUrl,
  buildWingetSearchUrl,
  normalizeWingetManifest,
  normalizeWingetSearchRecord,
  parseWingetManifestYaml,
  parseWingetSearchResponse,
  validatedWingetPackageId,
  validatedWingetSearch,
  wingetPackageToMarketplaceItem,
} from "./adapters/winget";

/**
 * WinGet read service: explicit action → policy gate → bounded cache → safe fetch
 * (P1-4). Community manifest presence is not publisher authenticity.
 * Every attempt records redacted contact under Developer Tools / marketplace-registry?
 * We record under marketplace-registry for consistency, destination is the specific origin.
 */

export interface WingetServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface WingetSearchResult {
  items: MarketplaceItem[];
  totalCount?: number;
  evidence: WingetServiceEvidence;
  transparency: OperationTransparency;
}

export interface WingetManifestResult {
  item: MarketplaceItem;
  manifest: ReturnType<typeof parseWingetManifestYaml>;
  evidence: WingetServiceEvidence;
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

const DESTINATION_SEARCH = "https://api.github.com";
const DESTINATION_RAW = "https://raw.githubusercontent.com";

function sourceOrThrow() {
  const source = getRemoteSource(WINGET_SOURCE_ID);
  if (!source) throw new Error("WinGet: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "WinGet: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(destination: string, startedAt: string): Omit<WingetServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return { sourceId: WINGET_SOURCE_ID, destination, method: "GET", startedAt, rateLimit: { observed429: false, source: "WinGet Community Repository" } };
}

function transparencyFor(input: { purpose: string; startedAt: string; completedAt: string; result: "SUCCEEDED" | "FAILED" | "BLOCKED"; reason?: string; fromCache: boolean; destination: string }): OperationTransparency {
  return createOperationTransparency({
    execution: input.fromCache ? "LOCAL" : "REMOTE",
    network: input.fromCache ? "NOT_REQUIRED" : "REQUIRED",
    dataClasses: ["METADATA"],
    projectSourceSent: false,
    provider: "Windows Package Manager Community Repository",
    destination: input.destination,
    purpose: input.purpose,
    confirmation: "NOT_REQUIRED",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    result: input.result,
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

async function recordContact(workspaceRoot: string, attemptedAt: string, succeeded: boolean, destination: string, error: string | null) {
  try {
    await recordRemoteContact(workspaceRoot, "marketplace-registry", { attemptedAt, succeeded, destination, error });
  } catch {}
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

/** Explicit WinGet search (GitHub code search). */
export async function searchWingetPackages(input: ServiceInput & { q: string }): Promise<WingetSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const q = validatedWingetSearch(input.q);
  const url = buildWingetSearchUrl(WINGET_GITHUB_SEARCH_BASE, q, 20, 1);
  const cacheKey = remoteCacheKey([WINGET_SOURCE_ID, "search", q]);
  const cached = await readRemoteCache(input.workspaceRoot, WINGET_SOURCE_ID, cacheKey);

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): WingetSearchResult => {
    const completedAt = new Date().toISOString();
    const parsed = parseWingetSearchResponse(JSON.stringify(rawData));
    const items = parsed.packages.map((pkg) => wingetPackageToMarketplaceItem(normalizeWingetSearchRecord(pkg, fetchedAt, "CACHE", stale ? "STALE" : "CACHED"), completedAt));
    return {
      items,
      totalCount: parsed.totalCount,
      evidence: { ...baseEvidence(DESTINATION_SEARCH, startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale, freshness: stale ? "STALE" : "CACHED", etag: cached?.etag, lastModified: cached?.lastModified, ...(note ? { error: note } : {}) },
      transparency: transparencyFor({ purpose: note ?? "Explicit WinGet search served from bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: DESTINATION_SEARCH }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached.data, cached.fetchedAt, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_SEARCH, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached.data, cached.fetchedAt, false);

  try {
    const fetched = await safeFetchRemote(url, { sourceId: WINGET_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, DESTINATION_SEARCH, null);
    if (fetched.notModified && cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }).catch(() => undefined);
      const parsed = parseWingetSearchResponse(JSON.stringify(cached.data));
      const items = parsed.packages.map((pkg) => wingetPackageToMarketplaceItem(normalizeWingetSearchRecord(pkg, completedAt, "CACHE", "CURRENT"), completedAt));
      return {
        items,
        totalCount: parsed.totalCount,
        evidence: { ...baseEvidence(fetched.destination, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: 304, notModified: true, fromCache: true, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached.etag, lastModified: fetched.headers.lastModified ?? cached.lastModified, rateLimit: fetched.headers.rateLimit },
        transparency: transparencyFor({ purpose: "Explicit WinGet search revalidated (304).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: fetched.destination }),
      };
    }
    const parsed = parseWingetSearchResponse(fetched.text);
    await writeRemoteCache(input.workspaceRoot, { sourceId: WINGET_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }).catch(() => undefined);
    const items = parsed.packages.map((pkg) => wingetPackageToMarketplaceItem(normalizeWingetSearchRecord(pkg, completedAt, "LIVE", "CURRENT"), completedAt));
    return {
      items,
      totalCount: parsed.totalCount,
      evidence: { ...baseEvidence(fetched.destination, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: false, fromCache: false, stale: false, freshness: "CURRENT", etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit WinGet search fetched live catalog metadata.", startedAt, completedAt, result: "SUCCEEDED", fromCache: false, destination: fetched.destination }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "WinGet request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_SEARCH, message);
    if (cached) {
      const stale = fromCache(cached.data, cached.fetchedAt, true);
      return { ...stale, evidence: { ...stale.evidence, completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, error: `Provider failure; serving last-good cached catalog. ${message}`.slice(0, 500) } };
    }
    throw error;
  }
}

/** Explicit WinGet manifest detail. */
export async function getWingetManifest(input: ServiceInput & { packageId: string; version: string }): Promise<WingetManifestResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const packageId = validatedWingetPackageId(input.packageId);
  if (typeof input.version !== "string" || input.version.length === 0 || input.version.length > 100) throw new Error("WinGet: version must be 1-100 characters.");
  const url = buildWingetManifestUrl(packageId, input.version);
  const cacheKey = remoteCacheKey([WINGET_SOURCE_ID, "manifest", packageId.toLowerCase(), input.version]);
  const cached = await readRemoteCache(input.workspaceRoot, WINGET_SOURCE_ID, cacheKey);

  if (!input.networkAllowed) {
    if (cached && typeof (cached.data as { text?: unknown })?.text === "string") {
      const completedAt = new Date().toISOString();
      const text = (cached.data as { text: string }).text;
      const manifest = parseWingetManifestYaml(text);
      const normalized = normalizeWingetManifest(manifest, cached.fetchedAt, "CACHE", "CACHED");
      return {
        item: wingetPackageToMarketplaceItem(normalized, completedAt),
        manifest,
        evidence: { ...baseEvidence(DESTINATION_RAW, startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified, error: "OFFLINE: served from bounded cache; network access is disabled by the current operating mode." },
        transparency: transparencyFor({ purpose: "Explicit WinGet manifest served from bounded cache (offline mode).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: DESTINATION_RAW }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_RAW, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS) && typeof (cached.data as { text?: unknown })?.text === "string") {
    const completedAt = new Date().toISOString();
    const text = (cached.data as { text: string }).text;
    const manifest = parseWingetManifestYaml(text);
    const normalized = normalizeWingetManifest(manifest, cached.fetchedAt, "CACHE", "CACHED");
    return {
      item: wingetPackageToMarketplaceItem(normalized, completedAt),
      manifest,
      evidence: { ...baseEvidence(DESTINATION_RAW, startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: false, freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified },
      transparency: transparencyFor({ purpose: "Explicit WinGet manifest served from fresh bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: DESTINATION_RAW }),
    };
  }

  try {
    const fetched = await safeFetchRemote(url, { sourceId: WINGET_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, DESTINATION_RAW, null);
    const text = fetched.notModified && cached && typeof (cached.data as { text?: unknown })?.text === "string" ? (cached.data as { text: string }).text : fetched.text;
    const manifest = parseWingetManifestYaml(text);
    const normalized = normalizeWingetManifest(manifest, fetched.notModified && cached ? cached.fetchedAt : completedAt, fetched.notModified ? "CACHE" : "LIVE", "CURRENT");
    if (!fetched.notModified) {
      await writeRemoteCache(input.workspaceRoot, { sourceId: WINGET_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: { text } }).catch(() => undefined);
    }
    return {
      item: wingetPackageToMarketplaceItem(normalized, completedAt),
      manifest,
      evidence: { ...baseEvidence(fetched.destination, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: fetched.notModified, fromCache: fetched.notModified, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached?.etag, lastModified: fetched.headers.lastModified ?? cached?.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit WinGet manifest fetched live.", startedAt, completedAt, result: "SUCCEEDED", fromCache: fetched.notModified, destination: fetched.destination }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "WinGet request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_RAW, message);
    if (cached && typeof (cached.data as { text?: unknown })?.text === "string") {
      const text = (cached.data as { text: string }).text;
      const manifest = parseWingetManifestYaml(text);
      const normalized = normalizeWingetManifest(manifest, cached.fetchedAt, "CACHE", "STALE");
      return {
        item: wingetPackageToMarketplaceItem(normalized, completedAt),
        manifest,
        evidence: { ...baseEvidence(DESTINATION_RAW, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, notModified: false, fromCache: true, stale: true, freshness: "STALE", etag: cached.etag, lastModified: cached.lastModified, error: `Provider failure; serving last-good cached manifest. ${message}`.slice(0, 500) },
        transparency: transparencyFor({ purpose: "Explicit WinGet manifest failed at provider; last-good cached manifest served as STALE.", startedAt, completedAt, result: "SUCCEEDED", reason: message.slice(0, 300), fromCache: true, destination: DESTINATION_RAW }),
      };
    }
    throw error;
  }
}
