import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, revalidateRemoteCache, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  NPM_BASE_URL,
  NPM_SOURCE_ID,
  buildNpmPackageUrl,
  buildNpmSearchUrl,
  buildNpmVersionUrl,
  normalizeNpmPackage,
  normalizeNpmSearchRecord,
  npmPackageToMarketplaceItem,
  parseNpmPackageResponse,
  parseNpmSearchResponse,
  parseNpmVersionResponse,
  validatedNpmPackageName,
  validatedNpmVersion,
  validatedNpmSearch,
} from "./adapters/npm";

/**
 * npm Registry read service: explicit action → policy gate → bounded cache →
 * safe fetch → schema validation → normalization → provenance + freshness
 * (P1).
 *
 * Catalog presence is not installation. Same offline/cache/stale contract
 * as previous services. Every attempt records redacted contact under
 * marketplace-registry.
 */

export interface NpmServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface NpmSearchResult {
  items: MarketplaceItem[];
  total?: number;
  evidence: NpmServiceEvidence;
  transparency: OperationTransparency;
}

export interface NpmPackageResult {
  item: MarketplaceItem;
  versions: string[];
  evidence: NpmServiceEvidence;
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

const DESTINATION = "https://registry.npmjs.org";

function sourceOrThrow() {
  const source = getRemoteSource(NPM_SOURCE_ID);
  if (!source) throw new Error("npm Registry: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "npm Registry: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(startedAt: string): Omit<NpmServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: NPM_SOURCE_ID,
    destination: DESTINATION,
    method: "GET",
    startedAt,
    rateLimit: { observed429: false, source: "npm Public Registry" },
  };
}

function transparencyFor(input: { purpose: string; startedAt: string; completedAt: string; result: "SUCCEEDED" | "FAILED" | "BLOCKED"; reason?: string; fromCache: boolean }): OperationTransparency {
  return createOperationTransparency({
    execution: input.fromCache ? "LOCAL" : "REMOTE",
    network: input.fromCache ? "NOT_REQUIRED" : "REQUIRED",
    dataClasses: ["METADATA"],
    projectSourceSent: false,
    provider: "npm Public Registry",
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

/** Explicit npm search. OFFLINE refuses before any socket. */
export async function searchNpmPackages(input: ServiceInput & { text: string; size?: number; from?: number }): Promise<NpmSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const validated = validatedNpmSearch(input.text, input.size, input.from);
  const url = buildNpmSearchUrl(NPM_BASE_URL, validated);
  const cacheKey = remoteCacheKey([NPM_SOURCE_ID, "search", validated.text, String(validated.size), String(validated.from)]);
  const cached = await readRemoteCache(input.workspaceRoot, NPM_SOURCE_ID, cacheKey);

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): NpmSearchResult => {
    const completedAt = new Date().toISOString();
    const parsed = parseNpmSearchResponse(JSON.stringify(rawData));
    const items = parsed.packages.map((pkg) => npmPackageToMarketplaceItem(normalizeNpmSearchRecord(pkg, fetchedAt, "CACHE", stale ? "STALE" : "CACHED"), completedAt));
    return {
      items,
      total: parsed.total,
      evidence: {
        ...baseEvidence(startedAt),
        completedAt,
        durationMs: 0,
        httpStatus: null,
        notModified: false,
        fromCache: true,
        stale,
        freshness: stale ? "STALE" : "CACHED",
        etag: cached?.etag,
        lastModified: cached?.lastModified,
        ...(note ? { error: note } : {}),
      },
      transparency: transparencyFor({ purpose: note ?? "Explicit npm search served from bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached.data, cached.fetchedAt, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached.data, cached.fetchedAt, false);

  try {
    const fetched = await safeFetchRemote(url, { sourceId: NPM_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
      const parsed = parseNpmSearchResponse(JSON.stringify(cached.data));
      const items = parsed.packages.map((pkg) => npmPackageToMarketplaceItem(normalizeNpmSearchRecord(pkg, completedAt, "CACHE", "CURRENT"), completedAt));
      return {
        items,
        total: parsed.total,
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: 304, notModified: true, fromCache: true, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached.etag, lastModified: fetched.headers.lastModified ?? cached.lastModified, rateLimit: fetched.headers.rateLimit },
        transparency: transparencyFor({ purpose: "Explicit npm search revalidated (304).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
      };
    }
    const parsed = parseNpmSearchResponse(fetched.text);
    await writeRemoteCache(input.workspaceRoot, { sourceId: NPM_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }, ).catch(() => undefined);
    const items = parsed.packages.map((pkg) => npmPackageToMarketplaceItem(normalizeNpmSearchRecord(pkg, completedAt, "LIVE", "CURRENT"), completedAt));
    return {
      items,
      total: parsed.total,
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: false, fromCache: false, stale: false, freshness: "CURRENT", etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit npm search fetched live catalog metadata.", startedAt, completedAt, result: "SUCCEEDED", fromCache: false }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "npm Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const stale = fromCache(cached.data, cached.fetchedAt, true);
      return { ...stale, evidence: { ...stale.evidence, completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, error: `Provider failure; serving last-good cached catalog. ${message}`.slice(0, 500) } };
    }
    throw error;
  }
}

/** Explicit npm package detail. */
export async function getNpmPackage(input: ServiceInput & { name: string }): Promise<NpmPackageResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const name = validatedNpmPackageName(input.name);
  const url = buildNpmPackageUrl(NPM_BASE_URL, name);
  const cacheKey = remoteCacheKey([NPM_SOURCE_ID, "package", name]);
  const cached = await readRemoteCache(input.workspaceRoot, NPM_SOURCE_ID, cacheKey);

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const normalized = normalizeNpmPackage(parseNpmPackageResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED");
      return {
        item: npmPackageToMarketplaceItem(normalized, completedAt),
        versions: normalized.versions,
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified, error: "OFFLINE: served from bounded cache; network access is disabled by the current operating mode." },
        transparency: transparencyFor({ purpose: "Explicit npm package detail served from bounded cache (offline mode).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    const completedAt = new Date().toISOString();
    const normalized = normalizeNpmPackage(parseNpmPackageResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED");
    return {
      item: npmPackageToMarketplaceItem(normalized, completedAt),
      versions: normalized.versions,
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: false, freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified },
      transparency: transparencyFor({ purpose: "Explicit npm package detail served from fresh bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
    };
  }

  try {
    const fetched = await safeFetchRemote(url, { sourceId: NPM_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const normalized = normalizeNpmPackage(parseNpmPackageResponse(rawText), fetched.notModified && cached ? cached.fetchedAt : completedAt, fetched.notModified ? "CACHE" : "LIVE", "CURRENT");
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
    } else if (!fetched.notModified) {
      await writeRemoteCache(input.workspaceRoot, { sourceId: NPM_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }, ).catch(() => undefined);
    }
    return {
      item: npmPackageToMarketplaceItem(normalized, completedAt),
      versions: normalized.versions,
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: fetched.notModified, fromCache: fetched.notModified, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached?.etag, lastModified: fetched.headers.lastModified ?? cached?.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit npm package detail fetched live.", startedAt, completedAt, result: "SUCCEEDED", fromCache: fetched.notModified }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "npm Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const normalized = normalizeNpmPackage(parseNpmPackageResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "STALE");
      return {
        item: npmPackageToMarketplaceItem(normalized, completedAt),
        versions: normalized.versions,
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, notModified: false, fromCache: true, stale: true, freshness: "STALE", etag: cached.etag, lastModified: cached.lastModified, error: `Provider failure; serving last-good cached package. ${message}`.slice(0, 500) },
        transparency: transparencyFor({ purpose: "Explicit npm package detail failed at provider; last-good cached package served as STALE.", startedAt, completedAt, result: "SUCCEEDED", reason: message.slice(0, 300), fromCache: true }),
      };
    }
    throw error;
  }
}

/** Explicit npm version detail. */
export async function getNpmVersion(input: ServiceInput & { name: string; version: string }): Promise<NpmPackageResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const name = validatedNpmPackageName(input.name);
  const version = validatedNpmVersion(input.version);
  const url = buildNpmVersionUrl(NPM_BASE_URL, name, version);
  const cacheKey = remoteCacheKey([NPM_SOURCE_ID, "version", name, version]);
  const cached = await readRemoteCache(input.workspaceRoot, NPM_SOURCE_ID, cacheKey);

  // For version detail we still normalize via package-like record built from version response for consistency,
  // but we can also directly use version data for item projection. Simpler: treat version response as package detail with single version.
  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const versionRecord = parseNpmVersionResponse(JSON.stringify(cached.data));
      // Build minimal package record for normalization
      const pkgRecord = { name, versions: { [version]: versionRecord }, "dist-tags": { latest: version } } as unknown as Parameters<typeof normalizeNpmPackage>[0];
      const normalized = normalizeNpmPackage(pkgRecord, cached.fetchedAt, "CACHE", "CACHED", version);
      return {
        item: npmPackageToMarketplaceItem(normalized, completedAt),
        versions: [version],
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified, error: "OFFLINE: served from bounded cache; network access is disabled by the current operating mode." },
        transparency: transparencyFor({ purpose: "Explicit npm version detail served from bounded cache (offline mode).", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    const completedAt = new Date().toISOString();
    const versionRecord = parseNpmVersionResponse(JSON.stringify(cached.data));
    const pkgRecord = { name, versions: { [version]: versionRecord }, "dist-tags": { latest: version } } as unknown as Parameters<typeof normalizeNpmPackage>[0];
    const normalized = normalizeNpmPackage(pkgRecord, cached.fetchedAt, "CACHE", "CACHED", version);
    return {
      item: npmPackageToMarketplaceItem(normalized, completedAt),
      versions: [version],
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: 0, httpStatus: null, notModified: false, fromCache: true, stale: false, freshness: "CACHED", etag: cached.etag, lastModified: cached.lastModified },
      transparency: transparencyFor({ purpose: "Explicit npm version detail served from fresh bounded cache.", startedAt, completedAt, result: "SUCCEEDED", fromCache: true }),
    };
  }

  try {
    const fetched = await safeFetchRemote(url, { sourceId: NPM_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) }, input.fetchImpl);
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const versionRecord = parseNpmVersionResponse(rawText);
    const pkgRecord = { name, versions: { [version]: versionRecord }, "dist-tags": { latest: version } } as unknown as Parameters<typeof normalizeNpmPackage>[0];
    const normalized = normalizeNpmPackage(pkgRecord, fetched.notModified && cached ? cached.fetchedAt : completedAt, fetched.notModified ? "CACHE" : "LIVE", "CURRENT", version);
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
    } else if (!fetched.notModified) {
      await writeRemoteCache(input.workspaceRoot, { sourceId: NPM_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown }, ).catch(() => undefined);
    }
    return {
      item: npmPackageToMarketplaceItem(normalized, completedAt),
      versions: [version],
      evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: fetched.httpStatus, notModified: fetched.notModified, fromCache: fetched.notModified, stale: false, freshness: "CURRENT", etag: fetched.headers.etag ?? cached?.etag, lastModified: fetched.headers.lastModified ?? cached?.lastModified, rateLimit: fetched.headers.rateLimit },
      transparency: transparencyFor({ purpose: "Explicit npm version detail fetched live.", startedAt, completedAt, result: "SUCCEEDED", fromCache: fetched.notModified }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "npm Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const versionRecord = parseNpmVersionResponse(JSON.stringify(cached.data));
      const pkgRecord = { name, versions: { [version]: versionRecord }, "dist-tags": { latest: version } } as unknown as Parameters<typeof normalizeNpmPackage>[0];
      const normalized = normalizeNpmPackage(pkgRecord, cached.fetchedAt, "CACHE", "STALE", version);
      return {
        item: npmPackageToMarketplaceItem(normalized, completedAt),
        versions: [version],
        evidence: { ...baseEvidence(startedAt), completedAt, durationMs: durationMs(startedAt, completedAt), httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null, notModified: false, fromCache: true, stale: true, freshness: "STALE", etag: cached.etag, lastModified: cached.lastModified, error: `Provider failure; serving last-good cached version. ${message}`.slice(0, 500) },
        transparency: transparencyFor({ purpose: "Explicit npm version detail failed at provider; last-good cached version served as STALE.", startedAt, completedAt, result: "SUCCEEDED", reason: message.slice(0, 300), fromCache: true }),
      };
    }
    throw error;
  }
}
