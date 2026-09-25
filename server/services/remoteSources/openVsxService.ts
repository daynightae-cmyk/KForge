import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  OPEN_VSX_BASE_URL,
  OPEN_VSX_SOURCE_ID,
  buildOvsxExtensionUrl,
  buildOvsxSearchUrl,
  buildOvsxVersionUrl,
  buildOvsxVersionsUrl,
  normalizeOvsxExtension,
  ovsxExtensionToMarketplaceItem,
  parseOvsxExtensionResponse,
  parseOvsxSearchResponse,
  parseOvsxVersionResponse,
  parseOvsxVersionsResponse,
  type OvsxSearchParams,
} from "./adapters/openVsx";

/**
 * Open VSX read service: explicit action → policy gate → bounded cache →
 * safe fetch → schema validation → normalization → provenance + freshness →
 * existing MarketplaceItem contract (Slice 2, P0).
 *
 * Same contract as the MCP service: OFFLINE refuses with zero fetch (or
 * serves bounded cache as CACHED), provider failures fall back to STALE
 * last-good evidence, and every attempt records redacted remote-contact
 * evidence under the marketplace-registry service.
 */

export interface OvsxServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface OvsxSearchResult {
  items: MarketplaceItem[];
  offset?: number;
  totalSize?: number;
  evidence: OvsxServiceEvidence;
  transparency: OperationTransparency;
}

export interface OvsxDetailResult {
  item: MarketplaceItem;
  versions: string[];
  evidence: OvsxServiceEvidence;
  transparency: OperationTransparency;
}

export interface OvsxVersionsResult {
  namespace: string;
  extension: string;
  versions: string[];
  evidence: OvsxServiceEvidence;
  transparency: OperationTransparency;
}

interface ServiceInput {
  workspaceRoot: string;
  networkAllowed: boolean;
  fetchImpl?: FetchImpl;
  now?: string;
  /** DNS resolver override for hermetic tests (no real DNS). */
  hostResolver?: SafeFetchPolicy["hostResolver"];
  /** Bounded retry/timeout overrides (tests and future policy tuning). */
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

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-+]{0,99}$/;
const MAX_QUERY_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const MAX_OFFSET = 100000;

function validatedSearch(params: OvsxSearchParams): Required<Pick<OvsxSearchParams, "size">> & OvsxSearchParams {
  const size = params.size ?? 20;
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error("Open VSX Registry: size must be an integer between 1 and 50.");
  }
  if (params.query !== undefined && (typeof params.query !== "string" || params.query.length > MAX_QUERY_LENGTH)) {
    throw new Error("Open VSX Registry: query must be a string of at most 200 characters.");
  }
  if (params.category !== undefined && (typeof params.category !== "string" || params.category.length > MAX_CATEGORY_LENGTH)) {
    throw new Error("Open VSX Registry: category must be a string of at most 100 characters.");
  }
  if (params.offset !== undefined && (!Number.isInteger(params.offset) || params.offset < 0 || params.offset > MAX_OFFSET)) {
    throw new Error("Open VSX Registry: offset must be an integer between 0 and 100000.");
  }
  return { ...params, size };
}

function validatedSegment(value: string, name: "namespace" | "extension"): string {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new Error(`Open VSX Registry: ${name} contains unsupported characters.`);
  }
  return value;
}

function validatedVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) throw new Error("Open VSX Registry: version contains unsupported characters.");
  return version;
}

function baseEvidence(destination: string, startedAt: string): Omit<OvsxServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: OPEN_VSX_SOURCE_ID,
    destination,
    method: "GET",
    startedAt,
    rateLimit: { observed429: false, source: "Open VSX Registry" },
  };
}

function transparencyFor(input: {
  destination: string;
  purpose: string;
  startedAt: string;
  completedAt: string;
  result: "SUCCEEDED" | "FAILED" | "BLOCKED";
  reason?: string;
  fromCache: boolean;
}): OperationTransparency {
  return createOperationTransparency({
    execution: input.fromCache ? "LOCAL" : "REMOTE",
    network: input.fromCache ? "NOT_REQUIRED" : "REQUIRED",
    dataClasses: ["METADATA"],
    projectSourceSent: false,
    provider: "Open VSX Registry",
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
  } catch {
    // Contact evidence is observational; it must never fail the catalog read.
  }
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "Open VSX Registry: network access is disabled by the current operating mode. No request was made.");
}

const DESTINATION = "https://open-vsx.org";

function sourceOrThrow() {
  const source = getRemoteSource(OPEN_VSX_SOURCE_ID);
  if (!source) throw new Error("Open VSX Registry: approved source definition is missing.");
  return source;
}

interface CachedRead {
  cached: Awaited<ReturnType<typeof readRemoteCache>>;
  completedAt: string;
}

/** Explicit Open VSX catalog search. OFFLINE refuses before any socket opens. */
export async function searchOvsxExtensions(input: ServiceInput & OvsxSearchParams): Promise<OvsxSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const params = validatedSearch(input);
  const url = buildOvsxSearchUrl(OPEN_VSX_BASE_URL, params);
  // Cache identity is the provider request only: mode flags, workspace paths,
  // and injected doubles must never fork the cache namespace.
  const cacheKey = remoteCacheKey([
    OPEN_VSX_SOURCE_ID,
    "search",
    params.query ?? "",
    params.category ?? "",
    String(params.size),
    String(params.offset ?? 0),
  ]);
  const cached = await readRemoteCache(input.workspaceRoot, OPEN_VSX_SOURCE_ID, cacheKey);

  const fromCache = (entry: NonNullable<CachedRead["cached"]>, stale: boolean, note?: string): OvsxSearchResult => {
    const completedAt = new Date().toISOString();
    const parsed = parseOvsxSearchResponse(JSON.stringify(entry.data));
    return {
      items: parsed.extensions.map((record) => ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, entry.fetchedAt, "CACHE"), completedAt)),
      offset: parsed.offset,
      totalSize: parsed.totalSize,
      evidence: {
        ...baseEvidence(DESTINATION, startedAt),
        completedAt,
        durationMs: 0,
        httpStatus: null,
        notModified: false,
        fromCache: true,
        stale,
        freshness: "CACHED",
        etag: entry.etag,
        lastModified: entry.lastModified,
        ...(note ? { error: note } : {}),
      },
      transparency: transparencyFor({
        destination: DESTINATION,
        purpose: note ?? "Explicit Open VSX search served from bounded cache without provider contact.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }

  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached, false);

  try {
    const fetched = await safeFetchRemote(
      url,
      {
        sourceId: OPEN_VSX_SOURCE_ID,
        allowedOrigins: source.allowedOrigins,
        networkAllowed: true,
        ifNoneMatch: cached?.etag,
        ifModifiedSince: cached?.lastModified,
        ...policyOverrides(input),
      },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, fetched.destination, null);
    if (fetched.notModified && cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }).catch(() => undefined);
      const parsed = parseOvsxSearchResponse(JSON.stringify(cached.data));
      return {
        items: parsed.extensions.map((record) => ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, completedAt, "CACHE"), completedAt)),
        offset: parsed.offset,
        totalSize: parsed.totalSize,
        evidence: {
          ...baseEvidence(fetched.destination, startedAt),
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          httpStatus: 304,
          notModified: true,
          fromCache: true,
          stale: false,
          freshness: "CURRENT",
          etag: fetched.headers.etag ?? cached.etag,
          lastModified: fetched.headers.lastModified ?? cached.lastModified,
          rateLimit: fetched.headers.rateLimit,
        },
        transparency: transparencyFor({
          destination: fetched.destination,
          purpose: "Explicit Open VSX search revalidated with the provider (HTTP 304); cached catalog remains current.",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    const parsed = parseOvsxSearchResponse(fetched.text);
    await writeRemoteCache(
      input.workspaceRoot,
      {
        sourceId: OPEN_VSX_SOURCE_ID,
        key: cacheKey,
        url,
        fetchedAt: completedAt,
        etag: fetched.headers.etag,
        lastModified: fetched.headers.lastModified,
        cacheControl: fetched.headers.cacheControl,
        data: JSON.parse(fetched.text) as unknown,
      },
    ).catch(() => undefined);
    return {
      items: parsed.extensions.map((record) => ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, completedAt, "LIVE"), completedAt)),
      offset: parsed.offset,
      totalSize: parsed.totalSize,
      evidence: {
        ...baseEvidence(fetched.destination, startedAt),
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        httpStatus: fetched.httpStatus,
        notModified: false,
        fromCache: false,
        stale: false,
        freshness: "CURRENT",
        etag: fetched.headers.etag,
        lastModified: fetched.headers.lastModified,
        rateLimit: fetched.headers.rateLimit,
      },
      transparency: transparencyFor({
        destination: fetched.destination,
        purpose: "Explicit Open VSX search fetched live catalog metadata (read-only discovery).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: false,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Open VSX Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION, message);
    if (cached) {
      const parsed = parseOvsxSearchResponse(JSON.stringify(cached.data));
      return {
        items: parsed.extensions.map((record) => ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, cached.fetchedAt, "CACHE"), completedAt)),
        offset: parsed.offset,
        totalSize: parsed.totalSize,
        evidence: {
          ...baseEvidence(DESTINATION, startedAt),
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached catalog. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          destination: DESTINATION,
          purpose: "Explicit Open VSX search failed at the provider; last-good cached catalog served as STALE.",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          reason: message.slice(0, 300),
          fromCache: true,
        }),
      };
    }
    throw error;
  }
}

async function readVersionedDetail(input: {
  workspaceRoot: string;
  networkAllowed: boolean;
  fetchImpl?: FetchImpl;
  hostResolver?: SafeFetchPolicy["hostResolver"];
  timeoutMs?: number;
  maxRetries?: number;
  now?: string;
  url: string;
  cacheKey: string;
  parse: (rawText: string) => { record: ReturnType<typeof parseOvsxExtensionResponse>; versions: string[] };
  purpose: string;
}): Promise<OvsxDetailResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const cached = await readRemoteCache(input.workspaceRoot, OPEN_VSX_SOURCE_ID, input.cacheKey);

  const fromCache = (entry: NonNullable<typeof cached>, stale: boolean, note?: string, validated = false): OvsxDetailResult => {
    const completedAt = new Date().toISOString();
    const { record, versions } = input.parse(JSON.stringify(entry.data));
    const at = validated ? completedAt : entry.fetchedAt;
    return {
      item: ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, at, "CACHE", versions), completedAt),
      versions,
      evidence: {
        ...baseEvidence(DESTINATION, startedAt),
        completedAt,
        durationMs: 0,
        httpStatus: validated ? 304 : null,
        notModified: validated,
        fromCache: true,
        stale,
        freshness: validated ? "CURRENT" : "CACHED",
        etag: entry.etag,
        lastModified: entry.lastModified,
        ...(note ? { error: note } : {}),
      },
      transparency: transparencyFor({
        destination: DESTINATION,
        purpose: note ?? input.purpose,
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached, false);

  try {
    const fetched = await safeFetchRemote(
      input.url,
      {
        sourceId: OPEN_VSX_SOURCE_ID,
        allowedOrigins: source.allowedOrigins,
        networkAllowed: true,
        ifNoneMatch: cached?.etag,
        ifModifiedSince: cached?.lastModified,
        ...policyOverrides(input),
      },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, fetched.destination, null);
    if (fetched.notModified && cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }).catch(() => undefined);
      return fromCache({ ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }, false, undefined, true);
    }
    const { record, versions } = input.parse(fetched.text);
    await writeRemoteCache(
      input.workspaceRoot,
      {
        sourceId: OPEN_VSX_SOURCE_ID,
        key: input.cacheKey,
        url: input.url,
        fetchedAt: completedAt,
        etag: fetched.headers.etag,
        lastModified: fetched.headers.lastModified,
        cacheControl: fetched.headers.cacheControl,
        data: JSON.parse(fetched.text) as unknown,
      },
    ).catch(() => undefined);
    return {
      item: ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, completedAt, "LIVE", versions), completedAt),
      versions,
      evidence: {
        ...baseEvidence(fetched.destination, startedAt),
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        httpStatus: fetched.httpStatus,
        notModified: false,
        fromCache: false,
        stale: false,
        freshness: "CURRENT",
        etag: fetched.headers.etag,
        lastModified: fetched.headers.lastModified,
        rateLimit: fetched.headers.rateLimit,
      },
      transparency: transparencyFor({
        destination: fetched.destination,
        purpose: `${input.purpose} (read-only discovery).`,
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: false,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Open VSX Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION, message);
    if (cached) {
      const { record, versions } = input.parse(JSON.stringify(cached.data));
      return {
        item: ovsxExtensionToMarketplaceItem(normalizeOvsxExtension(record, cached.fetchedAt, "CACHE", versions), completedAt),
        versions,
        evidence: {
          ...baseEvidence(DESTINATION, startedAt),
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached detail. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          destination: DESTINATION,
          purpose: `${input.purpose} failed at the provider; last-good cached detail served as STALE.`,
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          reason: message.slice(0, 300),
          fromCache: true,
        }),
      };
    }
    throw error;
  }
}

/** Explicit extension-detail read (latest version). Same offline/cache/stale contract. */
export async function getOvsxExtension(
  input: ServiceInput & { namespace: string; extension: string },
): Promise<OvsxDetailResult> {
  const namespace = validatedSegment(input.namespace, "namespace");
  const extension = validatedSegment(input.extension, "extension");
  return readVersionedDetail({
    ...input,
    url: buildOvsxExtensionUrl(OPEN_VSX_BASE_URL, namespace, extension),
    cacheKey: remoteCacheKey([OPEN_VSX_SOURCE_ID, "extension", namespace, extension]),
    parse: (rawText) => ({ record: parseOvsxExtensionResponse(rawText), versions: [] }),
    purpose: "Explicit Open VSX extension-detail read",
  });
}

/** Explicit version-detail read. Same offline/cache/stale contract. */
export async function getOvsxVersion(
  input: ServiceInput & { namespace: string; extension: string; version: string },
): Promise<OvsxDetailResult> {
  const namespace = validatedSegment(input.namespace, "namespace");
  const extension = validatedSegment(input.extension, "extension");
  const version = validatedVersion(input.version);
  return readVersionedDetail({
    ...input,
    url: buildOvsxVersionUrl(OPEN_VSX_BASE_URL, namespace, extension, version),
    cacheKey: remoteCacheKey([OPEN_VSX_SOURCE_ID, "version", namespace, extension, version]),
    parse: (rawText) => ({ record: parseOvsxVersionResponse(rawText), versions: [] }),
    purpose: "Explicit Open VSX version-detail read",
  });
}

/** Explicit version-references read. Same offline/cache/stale contract. */
export async function getOvsxVersions(
  input: ServiceInput & { namespace: string; extension: string },
): Promise<OvsxVersionsResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const namespace = validatedSegment(input.namespace, "namespace");
  const extension = validatedSegment(input.extension, "extension");
  const url = buildOvsxVersionsUrl(OPEN_VSX_BASE_URL, namespace, extension);
  const cacheKey = remoteCacheKey([OPEN_VSX_SOURCE_ID, "versions", namespace, extension]);
  const cached = await readRemoteCache(input.workspaceRoot, OPEN_VSX_SOURCE_ID, cacheKey);

  const fromCache = (versions: string[], stale: boolean, note?: string): OvsxVersionsResult => {
    const completedAt = new Date().toISOString();
    return {
      namespace,
      extension,
      versions,
      evidence: {
        ...baseEvidence(DESTINATION, startedAt),
        completedAt,
        durationMs: 0,
        httpStatus: null,
        notModified: false,
        fromCache: true,
        stale,
        freshness: "CACHED",
        etag: cached?.etag,
        lastModified: cached?.lastModified,
        ...(note ? { error: note } : {}),
      },
      transparency: transparencyFor({
        destination: DESTINATION,
        purpose: note ?? "Explicit Open VSX version-references read served from bounded cache.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(parseOvsxVersionsResponse(JSON.stringify(cached.data)), !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    return fromCache(parseOvsxVersionsResponse(JSON.stringify(cached.data)), false);
  }

  try {
    const fetched = await safeFetchRemote(
      url,
      {
        sourceId: OPEN_VSX_SOURCE_ID,
        allowedOrigins: source.allowedOrigins,
        networkAllowed: true,
        ifNoneMatch: cached?.etag,
        ifModifiedSince: cached?.lastModified,
        ...policyOverrides(input),
      },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, fetched.destination, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const versions = parseOvsxVersionsResponse(rawText);
    if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: OPEN_VSX_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    return {
      namespace,
      extension,
      versions,
      evidence: {
        ...baseEvidence(fetched.destination, startedAt),
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        httpStatus: fetched.httpStatus,
        notModified: fetched.notModified,
        fromCache: fetched.notModified,
        stale: false,
        freshness: "CURRENT",
        etag: fetched.headers.etag ?? cached?.etag,
        lastModified: fetched.headers.lastModified ?? cached?.lastModified,
        rateLimit: fetched.headers.rateLimit,
      },
      transparency: transparencyFor({
        destination: fetched.destination,
        purpose: "Explicit Open VSX version-references read (read-only discovery).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Open VSX Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, DESTINATION, message);
    if (cached) {
      return {
        ...fromCache(parseOvsxVersionsResponse(JSON.stringify(cached.data)), true),
        evidence: {
          ...fromCache(parseOvsxVersionsResponse(JSON.stringify(cached.data)), true).evidence,
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          stale: true,
          freshness: "STALE",
          error: `Provider failure; serving last-good cached versions. ${message}`.slice(0, 500),
        },
      };
    }
    throw error;
  }
}
