import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, revalidateRemoteCache, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  KFORGE_GITHUB_API_VERSION,
  KFORGE_UPDATES_API_BASE,
  KFORGE_UPDATES_SOURCE_ID,
  buildKforgeReleaseTagUrl,
  buildKforgeReleasesUrl,
  decideKforgeUpdate,
  normalizeKforgeRelease,
  parseKforgeReleaseResponse,
  parseKforgeReleasesResponse,
  validatedReleaseTag,
  type KforgeUpdateDecision,
  type NormalizedKforgeRelease,
} from "./adapters/githubReleases";

/**
 * KForge update-discovery service: explicit action → policy gate → bounded
 * cache → safe fetch → schema validation → normalization → provenance +
 * freshness (Slice 5, P0).
 *
 * READ-ONLY DISCOVERY. The service reports release channels, tags, assets,
 * and update availability as catalog facts. UPDATE_AVAILABLE never means
 * TRUSTED_UPDATE: trusted install stays BLOCKED with stated reasons
 * (checksum sidecars unverified, Authenticode trust absent per
 * docs/SIGNING.md, no download/verify/install workflow in this slice).
 * No silent auto-update or auto-install exists.
 *
 * Same offline/cache/stale contract as the catalog services. Every attempt
 * records redacted remote-contact evidence under the updates service.
 */

export interface KforgeUpdatesEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface KforgeReleasesResult {
  releases: NormalizedKforgeRelease[];
  evidence: KforgeUpdatesEvidence;
  transparency: OperationTransparency;
}

export interface KforgeReleaseResult {
  release: NormalizedKforgeRelease;
  evidence: KforgeUpdatesEvidence;
  transparency: OperationTransparency;
}

export interface KforgeUpdateStatusResult {
  decision: KforgeUpdateDecision;
  evidence: KforgeUpdatesEvidence;
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

const DESTINATION = "https://api.github.com";
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": KFORGE_GITHUB_API_VERSION,
};

function sourceOrThrow() {
  const source = getRemoteSource(KFORGE_UPDATES_SOURCE_ID);
  if (!source) throw new Error("KForge Updates: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "KForge Updates: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(startedAt: string): Omit<KforgeUpdatesEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: KFORGE_UPDATES_SOURCE_ID,
    destination: DESTINATION,
    method: "GET",
    startedAt,
    rateLimit: { observed429: false, source: "KForge GitHub Releases" },
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
    provider: "KForge GitHub Releases",
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
    await recordRemoteContact(workspaceRoot, "updates", { attemptedAt, succeeded, destination: DESTINATION, error });
  } catch {
    // Contact evidence is observational; it must never fail update discovery.
  }
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function validatedPaging(perPage?: number, page?: number): { perPage: number; page: number } {
  const resolvedPerPage = perPage ?? 30;
  const resolvedPage = page ?? 1;
  if (!Number.isInteger(resolvedPerPage) || resolvedPerPage < 1 || resolvedPerPage > 100) {
    throw new Error("KForge Updates: per_page must be an integer between 1 and 100.");
  }
  if (!Number.isInteger(resolvedPage) || resolvedPage < 1 || resolvedPage > 1000) {
    throw new Error("KForge Updates: page must be an integer between 1 and 1000.");
  }
  return { perPage: resolvedPerPage, page: resolvedPage };
}

interface FetchInput extends ServiceInput {
  url: string;
  etag?: string;
  lastModified?: string;
}

async function fetchReleases(input: FetchInput) {
  const source = sourceOrThrow();
  return safeFetchRemote(
    input.url,
    {
      sourceId: KFORGE_UPDATES_SOURCE_ID,
      allowedOrigins: source.allowedOrigins,
      networkAllowed: true,
      headers: GITHUB_HEADERS,
      ifNoneMatch: input.etag,
      ifModifiedSince: input.lastModified,
      ...policyOverrides(input),
    },
    input.fetchImpl,
  );
}

/** Explicit KForge release-list read. OFFLINE refuses before any socket opens. */
export async function listKforgeReleases(
  input: ServiceInput & { perPage?: number; page?: number; channel?: "stable" | "prerelease" | "all" },
): Promise<KforgeReleasesResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const { perPage, page } = validatedPaging(input.perPage, input.page);
  if (input.channel !== undefined && !["stable", "prerelease", "all"].includes(input.channel)) {
    throw new Error("KForge Updates: channel must be stable, prerelease, or all.");
  }
  const channel = input.channel ?? "all";
  const url = buildKforgeReleasesUrl(KFORGE_UPDATES_API_BASE, { perPage, page });
  const cacheKey = remoteCacheKey([KFORGE_UPDATES_SOURCE_ID, "releases", String(perPage), String(page)]);
  const cached = await readRemoteCache(input.workspaceRoot, KFORGE_UPDATES_SOURCE_ID, cacheKey);

  const normalizeAll = (rawData: unknown, at: string, origin: "LIVE" | "CACHE", freshness: "CURRENT" | "CACHED" | "STALE"): NormalizedKforgeRelease[] =>
    parseKforgeReleasesResponse(JSON.stringify(rawData))
      .map((record) => normalizeKforgeRelease(record, at, origin, freshness))
      .filter((release) => channel === "all" || release.channel === channel || (channel === "stable" && release.channel === "stable"));

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): KforgeReleasesResult => {
    const completedAt = new Date().toISOString();
    return {
      releases: normalizeAll(rawData, fetchedAt, "CACHE", stale ? "STALE" : "CACHED"),
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
        purpose: note ?? "Explicit KForge release discovery served from bounded cache. Catalog facts only.",
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
    const fetched = await fetchReleases({ ...input, url, etag: cached?.etag, lastModified: cached?.lastModified });
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
      const releases = normalizeAll(cached.data, completedAt, "CACHE", "CURRENT");
      return {
        releases,
        evidence: {
          ...baseEvidence(startedAt),
          completedAt,
          durationMs: durationMs(startedAt, completedAt),
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
          purpose: "Explicit KForge release discovery revalidated with the provider (HTTP 304); cached catalog remains current.",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    const releases = normalizeAll(JSON.parse(fetched.text) as unknown, completedAt, "LIVE", "CURRENT");
    await writeRemoteCache(
      input.workspaceRoot,
      { sourceId: KFORGE_UPDATES_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
    ).catch(() => undefined);
    return {
      releases,
      evidence: {
        ...baseEvidence(startedAt),
        completedAt,
        durationMs: durationMs(startedAt, completedAt),
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
        purpose: "Explicit KForge release discovery fetched live catalog metadata. Catalog facts only.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: false,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "KForge Updates request failed.";
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
          error: `Provider failure; serving last-good cached releases. ${message}`.slice(0, 500),
        },
      };
    }
    throw error;
  }
}

/** Explicit KForge release-detail read by tag. Same offline/cache/stale contract. */
export async function getKforgeRelease(input: ServiceInput & { tag: string }): Promise<KforgeReleaseResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const tag = validatedReleaseTag(input.tag);
  const url = buildKforgeReleaseTagUrl(KFORGE_UPDATES_API_BASE, tag);
  const cacheKey = remoteCacheKey([KFORGE_UPDATES_SOURCE_ID, "release", tag]);
  const cached = await readRemoteCache(input.workspaceRoot, KFORGE_UPDATES_SOURCE_ID, cacheKey);

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      return {
        release: normalizeKforgeRelease(parseKforgeReleaseResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED"),
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
          purpose: "Explicit KForge release read served from bounded cache (offline mode). Catalog facts only.",
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
      release: normalizeKforgeRelease(parseKforgeReleaseResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED"),
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
        purpose: "Explicit KForge release read served from fresh bounded cache. Catalog facts only.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: true,
      }),
    };
  }

  try {
    const fetched = await fetchReleases({ ...input, url, etag: cached?.etag, lastModified: cached?.lastModified });
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const release = normalizeKforgeRelease(
      parseKforgeReleaseResponse(rawText),
      fetched.notModified && cached ? cached.fetchedAt : completedAt,
      fetched.notModified ? "CACHE" : "LIVE",
      "CURRENT",
    );
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
    } else if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: KFORGE_UPDATES_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    return {
      release,
      evidence: {
        ...baseEvidence(startedAt),
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
        purpose: "Explicit KForge release read. Catalog facts only.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "KForge Updates request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      return {
        release: normalizeKforgeRelease(parseKforgeReleaseResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "STALE"),
        evidence: {
          ...baseEvidence(startedAt),
          completedAt,
          durationMs: durationMs(startedAt, completedAt),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached release. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          purpose: "Explicit KForge release read failed at the provider; last-good cached release served as STALE.",
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

/** Explicit update-status read: availability vs the installed version. Trusted install stays BLOCKED. */
export async function getKforgeUpdateStatus(
  input: ServiceInput & { currentVersion: string; perPage?: number },
): Promise<KforgeUpdateStatusResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const listed = await listKforgeReleases({ ...input, perPage: input.perPage ?? 30, page: 1, channel: "all" });
  const completedAt = new Date().toISOString();
  return {
    decision: decideKforgeUpdate(listed.releases, input.currentVersion),
    evidence: listed.evidence,
    transparency: transparencyFor({
      purpose: "Explicit KForge update check compared installed version against release catalog. Availability is a catalog fact; trusted install stays blocked.",
      startedAt,
      completedAt,
      result: "SUCCEEDED",
      fromCache: listed.evidence.fromCache,
    }),
  };
}
