import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  OSV_BASE_URL,
  OSV_SOURCE_ID,
  buildOsvBatchBody,
  buildOsvBatchUrl,
  buildOsvQueryBody,
  buildOsvQueryUrl,
  buildOsvVulnUrl,
  normalizeOsvAdvisory,
  parseOsvBatchResponse,
  parseOsvQueryResponse,
  parseOsvVulnResponse,
  validatedOsvBatch,
  validatedOsvQuery,
  validatedOsvVulnId,
  type NormalizedOsvAdvisory,
  type OsvPackageQuery,
} from "./adapters/osv";

/**
 * OSV.dev read service: explicit action → policy gate → bounded cache →
 * safe fetch → schema validation → normalization → provenance + freshness
 * (Slice 3, P0).
 *
 * OBSERVATIONAL ONLY. The service reports advisories with affected ranges
 * and fixed versions; it never modifies dependency manifests. A fix proposal
 * MAY be displayed, but package.json / lockfile mutation remains a separate
 * confirmed workflow that does not exist in this slice.
 *
 * Same offline/cache/stale contract as the catalog services: OFFLINE refuses
 * with zero fetch (or serves bounded cache as CACHED), provider failures
 * fall back to STALE last-good evidence, and every attempt records redacted
 * remote-contact evidence under the security-intelligence service.
 */

export interface OsvServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface OsvQueryResult {
  query: OsvPackageQuery;
  advisories: NormalizedOsvAdvisory[];
  evidence: OsvServiceEvidence;
  transparency: OperationTransparency;
}

export interface OsvBatchResult {
  results: Array<{ query: OsvPackageQuery; advisories: NormalizedOsvAdvisory[] }>;
  evidence: OsvServiceEvidence;
  transparency: OperationTransparency;
}

export interface OsvVulnResult {
  advisory: NormalizedOsvAdvisory;
  evidence: OsvServiceEvidence;
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

const DESTINATION = "https://api.osv.dev";

function sourceOrThrow() {
  const source = getRemoteSource(OSV_SOURCE_ID);
  if (!source) throw new Error("OSV.dev: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "OSV.dev: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(startedAt: string): Omit<OsvServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: OSV_SOURCE_ID,
    destination: DESTINATION,
    method: "POST",
    startedAt,
    rateLimit: { observed429: false, source: "OSV.dev" },
  };
}

function transparencyFor(input: {
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
    provider: "OSV.dev",
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
    await recordRemoteContact(workspaceRoot, "security-intelligence", { attemptedAt, succeeded, destination: DESTINATION, error });
  } catch {
    // Contact evidence is observational; it must never fail the advisory read.
  }
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

interface PostInput extends ServiceInput {
  url: string;
  body: string;
  etag?: string;
  lastModified?: string;
}

async function postOsv(input: PostInput): Promise<{ text: string; httpStatus: number; notModified: boolean; etag?: string; lastModified?: string; cacheControl?: string; destination: string; rateLimit: OsvServiceEvidence["rateLimit"] }> {
  const source = sourceOrThrow();
  const fetched = await safeFetchRemote(
    input.url,
    {
      sourceId: OSV_SOURCE_ID,
      allowedOrigins: source.allowedOrigins,
      networkAllowed: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: input.body,
      ifNoneMatch: input.etag,
      ifModifiedSince: input.lastModified,
      ...policyOverrides(input),
    },
    input.fetchImpl,
  );
  return {
    text: fetched.text,
    httpStatus: fetched.httpStatus,
    notModified: fetched.notModified,
    etag: fetched.headers.etag,
    lastModified: fetched.headers.lastModified,
    cacheControl: fetched.headers.cacheControl,
    destination: fetched.destination,
    rateLimit: fetched.headers.rateLimit,
  };
}

/** Explicit OSV package query. OFFLINE refuses before any socket opens. */
export async function queryOsvAdvisories(input: ServiceInput & { package: OsvPackageQuery }): Promise<OsvQueryResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const query = validatedOsvQuery(input.package);
  const body = buildOsvQueryBody(query);
  const url = buildOsvQueryUrl(OSV_BASE_URL);
  // Cache identity is the provider request only: mode flags, workspace paths,
  // and injected doubles must never fork the cache namespace.
  const cacheKey = remoteCacheKey([OSV_SOURCE_ID, "query", query.ecosystem ?? "", query.name ?? "", query.purl ?? "", query.version ?? "", query.commit ?? ""]);
  const cached = await readRemoteCache(input.workspaceRoot, OSV_SOURCE_ID, cacheKey);

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): OsvQueryResult => {
    const completedAt = new Date().toISOString();
    const advisories = parseOsvQueryResponse(JSON.stringify(rawData)).map((record) => normalizeOsvAdvisory(record, fetchedAt, "CACHE", stale ? "STALE" : "CACHED"));
    return {
      query,
      advisories,
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
      transparency: transparencyFor({
        purpose: note ?? "Explicit OSV package query served from bounded cache without provider contact. Observational only.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached.data, cached.fetchedAt, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached.data, cached.fetchedAt, false);

  try {
    const fetched = await postOsv({ ...input, url, body, etag: cached?.etag, lastModified: cached?.lastModified });
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const advisories = parseOsvQueryResponse(rawText).map((record) =>
      normalizeOsvAdvisory(record, completedAt, fetched.notModified ? "CACHE" : "LIVE", fetched.notModified ? "CURRENT" : "CURRENT"),
    );
    if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: OSV_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.etag, lastModified: fetched.lastModified, cacheControl: fetched.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    } else if (cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.etag ?? cached.etag }).catch(() => undefined);
    }
    return {
      query,
      advisories,
      evidence: {
        ...baseEvidence(startedAt),
        completedAt,
        durationMs: durationMs(startedAt, completedAt),
        httpStatus: fetched.httpStatus,
        notModified: fetched.notModified,
        fromCache: fetched.notModified,
        stale: false,
        freshness: "CURRENT",
        etag: fetched.etag ?? cached?.etag,
        lastModified: fetched.lastModified ?? cached?.lastModified,
        rateLimit: fetched.rateLimit,
      },
      transparency: transparencyFor({
        purpose: "Explicit OSV package query fetched live advisory metadata (observational; no manifest was modified).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "OSV.dev request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const stale = fromCache(cached.data, cached.fetchedAt, true);
      return {
        ...stale,
        evidence: {
          ...stale.evidence,
          completedAt,
          durationMs: durationMs(startedAt, completedAt),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          error: `Provider failure; serving last-good cached advisories. ${message}`.slice(0, 500),
        },
      };
    }
    throw error;
  }
}

/** Explicit OSV batch query (bounded). Same offline/cache/stale contract. */
export async function queryOsvBatch(input: ServiceInput & { queries: OsvPackageQuery[] }): Promise<OsvBatchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const queries = validatedOsvBatch(input.queries);
  const body = buildOsvBatchBody(queries);
  const url = buildOsvBatchUrl(OSV_BASE_URL);
  const cacheKey = remoteCacheKey([OSV_SOURCE_ID, "batch", body]);
  const cached = await readRemoteCache(input.workspaceRoot, OSV_SOURCE_ID, cacheKey);

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): OsvBatchResult => {
    const completedAt = new Date().toISOString();
    const groups = parseOsvBatchResponse(JSON.stringify(rawData));
    return {
      results: queries.map((query, index) => ({
        query,
        advisories: (groups[index] ?? []).map((record) => normalizeOsvAdvisory(record, fetchedAt, "CACHE", stale ? "STALE" : "CACHED")),
      })),
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
      transparency: transparencyFor({
        purpose: note ?? "Explicit OSV batch query served from bounded cache without provider contact. Observational only.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  };

  if (!input.networkAllowed) {
    if (cached) return fromCache(cached.data, cached.fetchedAt, !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS), "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.");
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) return fromCache(cached.data, cached.fetchedAt, false);

  try {
    const fetched = await postOsv({ ...input, url, body, etag: cached?.etag, lastModified: cached?.lastModified });
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const groups = parseOsvBatchResponse(rawText);
    if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: OSV_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.etag, lastModified: fetched.lastModified, cacheControl: fetched.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    const at = fetched.notModified && cached ? cached.fetchedAt : completedAt;
    const origin = fetched.notModified ? "CACHE" as const : "LIVE" as const;
    return {
      results: queries.map((query, index) => ({
        query,
        advisories: (groups[index] ?? []).map((record) => normalizeOsvAdvisory(record, at, origin, "CURRENT")),
      })),
      evidence: {
        ...baseEvidence(startedAt),
        completedAt,
        durationMs: durationMs(startedAt, completedAt),
        httpStatus: fetched.httpStatus,
        notModified: fetched.notModified,
        fromCache: fetched.notModified,
        stale: false,
        freshness: "CURRENT",
        etag: fetched.etag ?? cached?.etag,
        lastModified: fetched.lastModified ?? cached?.lastModified,
        rateLimit: fetched.rateLimit,
      },
      transparency: transparencyFor({
        purpose: "Explicit OSV batch query fetched live advisory metadata (observational; no manifest was modified).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "OSV.dev request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const stale = fromCache(cached.data, cached.fetchedAt, true);
      return {
        ...stale,
        evidence: {
          ...stale.evidence,
          completedAt,
          durationMs: durationMs(startedAt, completedAt),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          error: `Provider failure; serving last-good cached advisories. ${message}`.slice(0, 500),
        },
      };
    }
    throw error;
  }
}

/** Explicit OSV vulnerability-detail read. Same offline/cache/stale contract. */
export async function getOsvVuln(input: ServiceInput & { id: string }): Promise<OsvVulnResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const id = validatedOsvVulnId(input.id);
  const url = buildOsvVulnUrl(OSV_BASE_URL, id);
  const cacheKey = remoteCacheKey([OSV_SOURCE_ID, "vuln", id]);
  const cached = await readRemoteCache(input.workspaceRoot, OSV_SOURCE_ID, cacheKey);
  const source = sourceOrThrow();

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const advisory = normalizeOsvAdvisory(parseOsvVulnResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED");
      return {
        advisory,
        evidence: {
          ...baseEvidence(startedAt),
          completedAt,
          durationMs: 0,
          httpStatus: null,
          notModified: false,
          fromCache: true,
          stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS),
          freshness: "CACHED",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: "OFFLINE: served from bounded cache; network access is disabled by the current operating mode.",
        },
        transparency: transparencyFor({
          purpose: "Explicit OSV vulnerability read served from bounded cache (offline mode). Observational only.",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    const completedAt = new Date().toISOString();
    return {
      advisory: normalizeOsvAdvisory(parseOsvVulnResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED"),
      evidence: {
        ...baseEvidence(startedAt),
        completedAt,
        durationMs: 0,
        httpStatus: null,
        notModified: false,
        fromCache: true,
        stale: false,
        freshness: "CACHED",
        etag: cached.etag,
        lastModified: cached.lastModified,
      },
      transparency: transparencyFor({
        purpose: "Explicit OSV vulnerability read served from fresh bounded cache. Observational only.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  }

  try {
    const fetched = await safeFetchRemote(
      url,
      { sourceId: OSV_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const advisory = normalizeOsvAdvisory(
      parseOsvVulnResponse(rawText),
      fetched.notModified && cached ? cached.fetchedAt : completedAt,
      fetched.notModified ? "CACHE" : "LIVE",
      "CURRENT",
    );
    if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: OSV_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    return {
      advisory,
      evidence: {
        ...baseEvidence(startedAt),
        method: "GET",
        completedAt,
        durationMs: durationMs(startedAt, completedAt),
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
        purpose: "Explicit OSV vulnerability read (observational; no manifest was modified).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "OSV.dev request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      return {
        advisory: normalizeOsvAdvisory(parseOsvVulnResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "STALE"),
        evidence: {
          ...baseEvidence(startedAt),
          method: "GET",
          completedAt,
          durationMs: durationMs(startedAt, completedAt),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached advisory. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          purpose: "Explicit OSV vulnerability read failed at the provider; last-good cached advisory served as STALE.",
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
