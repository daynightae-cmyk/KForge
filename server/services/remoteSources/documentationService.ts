import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  REMOTE_DOC_SOURCE_ID,
  buildDocumentationRecord,
  getDocumentationSource,
  listDocumentationSources,
  searchDocumentationText,
  validatedDocumentationQuery,
  validatedDocumentationSourceId,
  type DocumentationRecord,
  type DocumentationSearchHit,
  type DocumentationSource,
} from "./adapters/documentation";

/**
 * Remote Documentation service: explicit refresh → policy gate → bounded
 * cache → safe fetch → provenance record; local-only search over cached
 * records (Slice 6, P0).
 *
 * Framework guarantees:
 * - Only allowlisted provider documents can be refreshed; unknown ids and
 *   non-allowlisted URLs are refused before any socket opens.
 * - OFFLINE refuses with zero fetch (or serves bounded cache as CACHED).
 * - Search NEVER fetches: it reads bounded cache locally. Live provider
 *   search happens only through explicit per-source refresh.
 * - Every record carries provider, canonicalUrl, title, version,
 *   retrievedAt, ETag/Last-Modified, content hash, authority, and
 *   license/terms classification.
 * - Every refresh records redacted remote-contact evidence under the
 *   remote-documentation service.
 */

export interface DocsServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface DocsRefreshResult {
  record: DocumentationRecord;
  evidence: DocsServiceEvidence;
  transparency: OperationTransparency;
}

export interface DocsSearchResult {
  query: string;
  hits: DocumentationSearchHit[];
  searchedSources: number;
  evidence: {
    fromCache: true;
    network: "NOT_REQUIRED";
    transparency: OperationTransparency;
  };
}

export interface CachedDocRecord {
  record: DocumentationRecord;
  text: string;
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

const DESTINATION_LABEL = "allowlisted provider documentation origins";

function sourceOrThrow() {
  const source = getRemoteSource(REMOTE_DOC_SOURCE_ID);
  if (!source) throw new Error("Remote Documentation: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "Remote Documentation: network access is disabled by the current operating mode. No request was made.");
}

function acceptFor(source: DocumentationSource): string {
  if (source.kind === "openapi-json") return "application/json";
  if (source.kind === "openapi-yaml") return "text/yaml, application/yaml, text/plain";
  return "text/markdown, text/plain";
}

function baseEvidence(destination: string, startedAt: string): Omit<DocsServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: REMOTE_DOC_SOURCE_ID,
    destination,
    method: "GET",
    startedAt,
    rateLimit: { observed429: false, source: "Remote Documentation" },
  };
}

function transparencyFor(input: {
  provider: string;
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
    provider: input.provider,
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
    await recordRemoteContact(workspaceRoot, "remote-documentation", { attemptedAt, succeeded, destination, error });
  } catch {
    // Contact evidence is observational; it must never fail documentation reads.
  }
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function cacheKeyFor(sourceId: string): string {
  return remoteCacheKey([REMOTE_DOC_SOURCE_ID, "document", sourceId]);
}

/** Approved documentation sources. LOCAL read; never contacts a provider. */
export function listAvailableDocumentation(): DocumentationSource[] {
  return listDocumentationSources();
}

interface StoredDoc {
  text: string;
  contentType?: string;
}

/** Read one cached document (local only). Malformed cache is absent, never truth. */
export async function readCachedDocumentation(workspaceRoot: string, sourceId: string): Promise<CachedDocRecord | null> {
  const source = getDocumentationSource(sourceId);
  if (!source) return null;
  const cached = await readRemoteCache(workspaceRoot, REMOTE_DOC_SOURCE_ID, cacheKeyFor(sourceId));
  if (!cached || typeof cached.data !== "object" || cached.data === null) return null;
  const stored = cached.data as Partial<StoredDoc>;
  if (typeof stored.text !== "string") return null;
  const stale = !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS);
  return {
    record: buildDocumentationRecord({
      source,
      text: stored.text,
      contentType: typeof stored.contentType === "string" ? stored.contentType : undefined,
      etag: cached.etag,
      lastModified: cached.lastModified,
      retrievedAt: cached.fetchedAt,
      origin: "CACHE",
      freshness: stale ? "STALE" : "CACHED",
    }),
    text: stored.text,
  };
}

/** Read all cached documents (local only). Used by search and Global Search enrichment. */
export async function listCachedDocumentation(workspaceRoot: string): Promise<CachedDocRecord[]> {
  const records: CachedDocRecord[] = [];
  for (const source of listDocumentationSources()) {
    const cached = await readCachedDocumentation(workspaceRoot, source.id);
    if (cached) records.push(cached);
  }
  return records;
}

/** Explicit refresh of one allowlisted provider document. OFFLINE refuses before any socket opens. */
export async function refreshDocumentation(input: ServiceInput & { sourceId: string }): Promise<DocsRefreshResult> {
  const startedAt = input.now ?? new Date().toISOString();
  sourceOrThrow();
  const source = validatedDocumentationSourceId(input.sourceId);
  const destination = new URL(source.url).origin;
  const cached = await readRemoteCache(input.workspaceRoot, REMOTE_DOC_SOURCE_ID, cacheKeyFor(source.id));

  if (!input.networkAllowed) {
    if (cached && typeof (cached.data as Partial<StoredDoc>)?.text === "string") {
      const completedAt = new Date().toISOString();
      const stored = cached.data as StoredDoc;
      return {
        record: buildDocumentationRecord({
          source,
          text: stored.text,
          contentType: stored.contentType,
          etag: cached.etag,
          lastModified: cached.lastModified,
          retrievedAt: cached.fetchedAt,
          origin: "CACHE",
          freshness: "CACHED",
        }),
        evidence: {
          ...baseEvidence(destination, startedAt),
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
          provider: source.provider,
          destination,
          purpose: "Explicit documentation refresh served from bounded cache (offline mode).",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, destination, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw offlineError();
  }
  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS) && typeof (cached.data as Partial<StoredDoc>)?.text === "string") {
    const completedAt = new Date().toISOString();
    const stored = cached.data as StoredDoc;
    return {
      record: buildDocumentationRecord({
        source,
        text: stored.text,
        contentType: stored.contentType,
        etag: cached.etag,
        lastModified: cached.lastModified,
        retrievedAt: cached.fetchedAt,
        origin: "CACHE",
        freshness: "CACHED",
      }),
      evidence: {
        ...baseEvidence(destination, startedAt),
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
        provider: source.provider,
        destination,
        purpose: "Explicit documentation refresh served from fresh bounded cache without provider contact.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  }

  try {
    const fetched = await safeFetchRemote(
      source.url,
      {
        sourceId: REMOTE_DOC_SOURCE_ID,
        allowedOrigins: source.allowedOrigins,
        networkAllowed: true,
        headers: { Accept: acceptFor(source) },
        ifNoneMatch: cached?.etag,
        ifModifiedSince: cached?.lastModified,
        ...policyOverrides(input),
      },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, fetched.destination, null);
    const text = fetched.notModified && cached ? (cached.data as StoredDoc).text : fetched.text;
    if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: REMOTE_DOC_SOURCE_ID, key: cacheKeyFor(source.id), url: source.url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: { text } satisfies StoredDoc },
      ).catch(() => undefined);
    } else if (cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }).catch(() => undefined);
    }
    return {
      record: buildDocumentationRecord({
        source,
        text,
        etag: fetched.headers.etag ?? cached?.etag,
        lastModified: fetched.headers.lastModified ?? cached?.lastModified,
        retrievedAt: fetched.notModified && cached ? cached.fetchedAt : completedAt,
        origin: fetched.notModified ? "CACHE" : "LIVE",
        freshness: "CURRENT",
      }),
      evidence: {
        ...baseEvidence(fetched.destination, startedAt),
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
        provider: source.provider,
        destination: fetched.destination,
        purpose: fetched.notModified
          ? "Explicit documentation refresh revalidated with the provider (HTTP 304); cached document remains current."
          : "Explicit documentation refresh fetched the allowlisted provider document.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Remote Documentation request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, destination, message);
    if (cached && typeof (cached.data as Partial<StoredDoc>)?.text === "string") {
      const stored = cached.data as StoredDoc;
      return {
        record: buildDocumentationRecord({
          source,
          text: stored.text,
          contentType: stored.contentType,
          etag: cached.etag,
          lastModified: cached.lastModified,
          retrievedAt: cached.fetchedAt,
          origin: "CACHE",
          freshness: "STALE",
        }),
        evidence: {
          ...baseEvidence(destination, startedAt),
          completedAt,
          durationMs: durationMs(startedAt, completedAt),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached document. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          provider: source.provider,
          destination,
          purpose: "Explicit documentation refresh failed at the provider; last-good cached document served as STALE.",
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

/**
 * Search cached provider documents. LOCAL ONLY: reads bounded cache, never
 * opens a socket. Live provider search happens exclusively through explicit
 * per-source refresh.
 */
export async function searchCachedDocumentation(workspaceRoot: string, query: string): Promise<DocsSearchResult> {
  const startedAt = new Date().toISOString();
  const needle = validatedDocumentationQuery(query);
  const cached = await listCachedDocumentation(workspaceRoot);
  const hits: DocumentationSearchHit[] = [];
  for (const entry of cached) {
    const searchable = `${entry.record.title}\n${entry.record.provider}\n${entry.text}`;
    const found = searchDocumentationText(searchable, needle);
    if (found.matchCount === 0) continue;
    hits.push({
      sourceId: entry.record.sourceId,
      provider: entry.record.provider,
      title: entry.record.title,
      canonicalUrl: entry.record.canonicalUrl,
      version: entry.record.version,
      freshness: entry.record.freshness,
      matchCount: found.matchCount,
      truncated: found.truncated,
      snippets: found.snippets,
    });
  }
  const completedAt = new Date().toISOString();
  return {
    query: needle,
    hits,
    searchedSources: cached.length,
    evidence: {
      fromCache: true,
      network: "NOT_REQUIRED",
      transparency: {
        execution: "LOCAL",
        network: "NOT_REQUIRED",
        dataClasses: ["METADATA"],
        projectSourceSent: false,
        secretRedaction: true,
        provider: "Cached provider documentation",
        destination: workspaceRoot,
        purpose: "Search bounded documentation cache locally without contacting any provider.",
        confirmation: "NOT_REQUIRED",
        startedAt,
        completedAt,
        durationMs: durationMs(startedAt, completedAt),
        result: "SUCCEEDED",
      },
    },
  };
}
