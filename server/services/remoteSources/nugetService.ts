import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  NUGET_REGISTRATION_BASE_URL,
  NUGET_SEARCH_BASE_URL,
  NUGET_SOURCE_ID,
  buildNugetRegistrationUrl,
  buildNugetSearchUrl,
  normalizeNugetCatalogEntry,
  normalizeNugetSearchRecord,
  nugetPackageToMarketplaceItem,
  parseNugetRegistrationResponse,
  parseNugetSearchResponse,
  validatedNugetPackageId,
  validatedNugetSearch,
} from "./adapters/nuget";

/**
 * NuGet read service: explicit action → policy gate → bounded cache → safe fetch
 * (P1-3). Catalog presence is not installation. Every attempt records redacted
 * contact under marketplace-registry.
 */

export interface NugetServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface NugetSearchResult {
  items: MarketplaceItem[];
  totalHits?: number;
  evidence: NugetServiceEvidence;
  transparency: OperationTransparency;
}

export interface NugetRegistrationResult {
  items: MarketplaceItem[];
  versions: string[];
  evidence: NugetServiceEvidence;
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

const DESTINATION_SEARCH = "https://azuresearch-usnc.nuget.org";
const DESTINATION_REGISTRATION = "https://api.nuget.org";

function sourceOrThrow() {
  const source = getRemoteSource(NUGET_SOURCE_ID);
  if (!source) throw new Error("NuGet Registry: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "NuGet Registry: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(destination: string, startedAt: string): Omit<NugetServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return { sourceId: NUGET_SOURCE_ID, destination, method: "GET", startedAt, rateLimit: { observed429: false, source: "nuget.org" } };
}

function transparencyFor(input: { purpose: string; startedAt: string; completedAt: string; result: "SUCCEEDED" | "FAILED" | "BLOCKED"; reason?: string; fromCache: boolean; destination: string }): OperationTransparency {
  return createOperationTransparency({
    execution: input.fromCache ? "LOCAL" : "REMOTE",
    network: input.fromCache ? "NOT_REQUIRED" : "REQUIRED",
    dataClasses: ["METADATA"],
    projectSourceSent: false,
    provider: "nuget.org",
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

/** Explicit NuGet search. */
export async function searchNugetPackages(input: ServiceInput & { q: string; skip?: number; take?: number }): Promise<NugetSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const validated = validatedNugetSearch(input.q, input.skip, input.take);
  const url = buildNugetSearchUrl(NUGET_SEARCH_BASE_URL, validated);
  const cacheKey = remoteCacheKey([NUGET_SOURCE_ID, "search", validated.q, String(validated.skip), String(validated.take)]);
  const cached = await readRemoteCache(input.workspaceRoot, NUGET_SOURCE_ID, cacheKey);

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): NugetSearchResult => {
    const completedAt = new Date().toISOString();
    const parsed = parseNugetSearchResponse(JSON.stringify(rawData));
    const items = parsed.packages.map((pkg) => nugetPackageToMarketplaceItem(normalizeNugetSearchRecord(pkg, fetchedAt, "CACHE", stale ? "STALE" : "CACHED"), completedAt));
    return {
      items,
      totalHits: parsed.totalHits,
      evidence: { ...baseEvidence(DESTINATION_SEARCH, startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale, freshness: stale ? "STALE" : "CACHED", etag: cached?.etag, lastModified: cached?.lastModified, ...(note ? { error: note } : {}) },
      transparency: transparencyFor({ purpose: note ?? "Explicit NuGet search served from bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: DESTINATION_SEARCH }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached.data, cached.fetchedAt, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_SEARCH, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached.data, cached.fetchedAt, false);

  try {
    const fetched = await safeFetchRemote(url, { sourceId: NUGET_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, DESTINATION_SEARCH, null);
    if (fetched.notModified && cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }).catch(() => undefined);
      const parsed = parseNugetSearchResponse(JSON.stringify(cached.data));
      const items = parsed.packages.map((pkg) => nugetPackageToMarketplaceItem(normalizeNugetSearchRecord(pkg, completedAt, "CACHE", "CURRENT"), completedAt));
      return {
        items,
        totalHits: parsed.totalHits,
        evidence: { ...baseEvidence(fetched.destination, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: 304, notModified: true, fromCache: true, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached.etag, lastModified: fetched.headers.lastModified ?? cached.lastModified, rateLimit: fetched.headers.rateLimit },
        transparency: transparencyFor({ purpose: "Explicit NuGet search revalidated (304).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: fetched.destination }),
      };
    }
    const parsed = parseNugetSearchResponse(fetched.text);
    await writeRemoteCache(input.workspaceRoot, { sourceId: NUGET_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }).catch(() => undefined);
    const items = parsed.packages.map((pkg) => nugetPackageToMarketplaceItem(normalizeNugetSearchRecord(pkg, completedAt, "LIVE", "CURRENT"), completedAt));
    return {
      items,
      totalHits: parsed.totalHits,
      evidence: { ...baseEvidence(fetched.destination, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: false, fromCache: false, stale: false, freshness: "CURRENT", etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit NuGet search fetched live catalog metadata.", startedAt, completedAt, result: "SUCCEEDED", fromCache: false, destination: fetched.destination }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "NuGet Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_SEARCH, message);
    if (cached) {
      const stale = fromCache(cached.data, cached.fetchedAt, true);
      return { ...stale, evidence: { ...stale.evidence, completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, error: `Provider failure; serving last-good cached catalog. ${message}`.slice(0, 500) } };
    }
    throw error;
  }
}

/** Explicit NuGet registration detail (versions). */
export async function getNugetRegistration(input: ServiceInput & { id: string }): Promise<NugetRegistrationResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const id = validatedNugetPackageId(input.id);
  const url = buildNugetRegistrationUrl(NUGET_REGISTRATION_BASE_URL, id);
  const cacheKey = remoteCacheKey([NUGET_SOURCE_ID, "registration", id.toLowerCase()]);
  const cached = await readRemoteCache(input.workspaceRoot, NUGET_SOURCE_ID, cacheKey);

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const entries = parseNugetRegistrationResponse(JSON.stringify(cached.data));
      const versions = entries.map((e) => e.version || "").filter(Boolean);
      const items = entries.map((e) => nugetPackageToMarketplaceItem(normalizeNugetCatalogEntry(e, cached.fetchedAt, "CACHE", "CACHED", versions), completedAt));
      return {
        items,
        versions,
        evidence: { ...baseEvidence(DESTINATION_REGISTRATION, startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified, error: "OFFLINE: served from bounded cache; network access is disabled by the current operating mode." },
        transparency: transparencyFor({ purpose: "Explicit NuGet registration served from bounded cache (offline mode).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: DESTINATION_REGISTRATION }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_REGISTRATION, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    const completedAt = new Date().toISOString();
    const entries = parseNugetRegistrationResponse(JSON.stringify(cached.data));
    const versions = entries.map((e) => e.version || "").filter(Boolean);
    const items = entries.map((e) => nugetPackageToMarketplaceItem(normalizeNugetCatalogEntry(e, cached.fetchedAt, "CACHE", "CACHED", versions), completedAt));
    return {
      items,
      versions,
      evidence: { ...baseEvidence(DESTINATION_REGISTRATION, startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: false, freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified },
      transparency: transparencyFor({ purpose: "Explicit NuGet registration served from fresh bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true, destination: DESTINATION_REGISTRATION }),
    };
  }

  try {
    const fetched = await safeFetchRemote(url, { sourceId: NUGET_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, DESTINATION_REGISTRATION, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const entries = parseNugetRegistrationResponse(rawText);
    const versions = entries.map((e) => e.version || "").filter(Boolean);
    const items = entries.map((e) => nugetPackageToMarketplaceItem(normalizeNugetCatalogEntry(e, fetched.notModified && cached ? cached.fetchedAt : completedAt, fetched.notModified ? "CACHE" : "LIVE", "CURRENT", versions), completedAt));
    if (!fetched.notModified) {
      await writeRemoteCache(input.workspaceRoot, { sourceId: NUGET_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }).catch(() => undefined);
    }
    return {
      items,
      versions,
      evidence: { ...baseEvidence(fetched.destination, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: fetched.notModified, fromCache: fetched.notModified, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached?.etag, lastModified: fetched.headers.lastModified ?? cached?.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit NuGet registration fetched live.", startedAt, completedAt, result: "SUCCEEDED", fromCache: fetched.notModified, destination: fetched.destination }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "NuGet Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION_REGISTRATION, message);
    if (cached) {
      const entries = parseNugetRegistrationResponse(JSON.stringify(cached.data));
      const versions = entries.map((e) => e.version || "").filter(Boolean);
      const items = entries.map((e) => nugetPackageToMarketplaceItem(normalizeNugetCatalogEntry(e, cached.fetchedAt, "CACHE", "STALE", versions), completedAt));
      return {
        items,
        versions,
        evidence: { ...baseEvidence(DESTINATION_REGISTRATION, startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, notModified: false, fromCache: true, stale: true, freshness: "STALE", etag: cached.etag, lastModified: cached.lastModified, error: `Provider failure; serving last-good cached registration. ${message}`.slice(0, 500) },
        transparency: transparencyFor({ purpose: "Explicit NuGet registration failed at provider; last-good cached registration served as STALE.", startedAt, completedAt, result: "SUCCEEDED", reason: message.slice(0, 300), fromCache: true, destination: DESTINATION_REGISTRATION }),
      };
    }
    throw error;
  }
}
