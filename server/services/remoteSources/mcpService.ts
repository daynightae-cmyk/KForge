import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, revalidateRemoteCache, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  MCP_BASE_URL,
  MCP_SOURCE_ID,
  buildMcpServersUrl,
  buildMcpVersionDetailUrl,
  buildMcpVersionsUrl,
  mcpServerToMarketplaceItem,
  normalizeMcpServer,
  parseMcpListResponse,
  parseMcpVersionDetailResponse,
  parseMcpVersionsResponse,
  type McpSearchParams,
} from "./adapters/mcpRegistry";

/**
 * MCP Registry read service: explicit action → policy gate → bounded cache →
 * safe fetch → schema validation → normalization → provenance + freshness →
 * existing MarketplaceItem contract (Slice 1, P0).
 *
 * Flow guarantees:
 * - OFFLINE / network-disabled callers get OFFLINE_BLOCKED with zero fetch.
 * - A fresh cache answers WITHOUT contacting the provider (still an explicit
 *   user action; evidence marks fromCache/CACHED distinctly from LIVE).
 * - Provider failures fall back to stale cache (STALE) instead of failing
 *   when last-good evidence exists; malformed provider data never replaces it.
 * - Every attempt records (redacted) remote-contact evidence for the Online
 *   Control Center under the marketplace-registry service.
 */

export interface McpServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface McpSearchResult {
  items: MarketplaceItem[];
  nextCursor?: string;
  evidence: McpServiceEvidence;
  transparency: OperationTransparency;
}

export interface McpVersionsResult {
  serverName: string;
  versions: Array<{ version: string; releaseDate?: string; description?: string; license?: string }>;
  nextCursor?: string;
  evidence: McpServiceEvidence;
  transparency: OperationTransparency;
}

export interface McpVersionDetailResult {
  serverName: string;
  item: MarketplaceItem;
  evidence: McpServiceEvidence;
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

const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/@]{0,199}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-+]{0,99}$/;
const MAX_SEARCH_LENGTH = 200;
const MAX_CURSOR_LENGTH = 2000;
const MAX_LIMIT = 100;

function validatedSearch(params: McpSearchParams): Required<Pick<McpSearchParams, "limit">> & McpSearchParams {
  const limit = params.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`MCP Registry: limit must be an integer between 1 and ${MAX_LIMIT}.`);
  }
  if (params.search !== undefined && (typeof params.search !== "string" || params.search.length > MAX_SEARCH_LENGTH)) {
    throw new Error("MCP Registry: search must be a string of at most 200 characters.");
  }
  if (params.cursor !== undefined && (typeof params.cursor !== "string" || params.cursor.length > MAX_CURSOR_LENGTH)) {
    throw new Error("MCP Registry: cursor must be an opaque string of at most 2000 characters.");
  }
  if (params.updatedSince !== undefined && Number.isNaN(Date.parse(params.updatedSince))) {
    throw new Error("MCP Registry: updated_since must be a valid date-time.");
  }
  if (params.version !== undefined && !VERSION_PATTERN.test(params.version)) {
    throw new Error("MCP Registry: version filter contains unsupported characters.");
  }
  return { ...params, limit };
}

function validatedServerName(serverName: string): string {
  if (!SERVER_NAME_PATTERN.test(serverName) || serverName.includes("..")) {
    throw new Error("MCP Registry: server name contains unsupported characters.");
  }
  return serverName;
}

function validatedVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) throw new Error("MCP Registry: version contains unsupported characters.");
  return version;
}

function baseEvidence(destination: string, startedAt: string, now: string): Omit<McpServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: MCP_SOURCE_ID,
    destination,
    method: "GET",
    startedAt,
    rateLimit: { observed429: false, source: "Official MCP Registry" },
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
    provider: "Official MCP Registry",
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

/** Explicit MCP catalog search. OFFLINE refuses before any socket opens. */
export async function searchMcpServers(
  input: ServiceInput & McpSearchParams,
): Promise<McpSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = getRemoteSource(MCP_SOURCE_ID);
  if (!source) throw new Error("MCP Registry: approved source definition is missing.");
  const params = validatedSearch(input);
  const url = buildMcpServersUrl(MCP_BASE_URL, params);
  const destination = "https://registry.modelcontextprotocol.io";
  // Cache identity is the provider request only: mode flags, workspace paths,
  // and injected doubles must never fork the cache namespace.
  const cacheKey = remoteCacheKey([
    MCP_SOURCE_ID,
    "servers",
    params.search ?? "",
    params.cursor ?? "",
    String(params.limit),
    params.updatedSince ?? "",
    params.version ?? "",
    String(params.includeDeleted ?? false),
  ]);
  const cached = await readRemoteCache(input.workspaceRoot, MCP_SOURCE_ID, cacheKey);

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const items = parseMcpListResponse(JSON.stringify(cached.data)).servers.map((server) =>
        mcpServerToMarketplaceItem(normalizeMcpServer(server, cached.fetchedAt, "CACHE"), completedAt),
      );
      return {
        items,
        nextCursor: (cached.data as { nextCursor?: string })?.nextCursor,
        evidence: {
          ...baseEvidence(destination, startedAt, completedAt),
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
          destination,
          purpose: "Explicit MCP Registry search served from bounded cache without network contact (offline mode).",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    await recordContact(input.workspaceRoot, startedAt, false, destination, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw new RemoteFetchError("OFFLINE_BLOCKED", "MCP Registry: network access is disabled by the current operating mode. No request was made.");
  }

  if (cached && isCacheFresh(cached, DEFAULT_CACHE_TTL_MS)) {
    const completedAt = new Date().toISOString();
    const parsed = parseMcpListResponse(JSON.stringify(cached.data));
    return {
      items: parsed.servers.map((server) => mcpServerToMarketplaceItem(normalizeMcpServer(server, cached.fetchedAt, "CACHE"), completedAt)),
      nextCursor: parsed.nextCursor,
      evidence: {
        ...baseEvidence(destination, startedAt, completedAt),
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
        destination,
        purpose: "Explicit MCP Registry search served from fresh bounded cache without contacting the provider.",
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
      {
        sourceId: MCP_SOURCE_ID,
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
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
      const parsed = parseMcpListResponse(JSON.stringify(cached.data));
      return {
        items: parsed.servers.map((server) => mcpServerToMarketplaceItem(normalizeMcpServer(server, completedAt, "CACHE"), completedAt)),
        nextCursor: parsed.nextCursor,
        evidence: {
          ...baseEvidence(fetched.destination, startedAt, completedAt),
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
          purpose: "Explicit MCP Registry search revalidated with the provider (HTTP 304); cached catalog remains current.",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    const parsed = parseMcpListResponse(fetched.text);
    await writeRemoteCache(
      input.workspaceRoot,
      {
        sourceId: MCP_SOURCE_ID,
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
      items: parsed.servers.map((server) => mcpServerToMarketplaceItem(normalizeMcpServer(server, completedAt, "LIVE"), completedAt)),
      nextCursor: parsed.nextCursor,
      evidence: {
        ...baseEvidence(fetched.destination, startedAt, completedAt),
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
        purpose: "Explicit MCP Registry search fetched live catalog metadata (read-only discovery).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: false,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "MCP Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, destination, message);
    if (cached) {
      const parsed = parseMcpListResponse(JSON.stringify(cached.data));
      return {
        items: parsed.servers.map((server) => mcpServerToMarketplaceItem(normalizeMcpServer(server, cached.fetchedAt, "CACHE"), completedAt)),
        nextCursor: parsed.nextCursor,
        evidence: {
          ...baseEvidence(destination, startedAt, completedAt),
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
          destination,
          purpose: "Explicit MCP Registry search failed at the provider; last-good cached catalog served as STALE.",
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

/** Explicit MCP version-history read. Same offline/cache/stale contract as search. */
export async function getMcpServerVersions(
  input: ServiceInput & { serverName: string },
): Promise<McpVersionsResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = getRemoteSource(MCP_SOURCE_ID);
  if (!source) throw new Error("MCP Registry: approved source definition is missing.");
  const serverName = validatedServerName(input.serverName);
  const url = buildMcpVersionsUrl(MCP_BASE_URL, serverName);
  const destination = "https://registry.modelcontextprotocol.io";
  const cacheKey = remoteCacheKey([MCP_SOURCE_ID, "versions", serverName]);
  const cached = await readRemoteCache(input.workspaceRoot, MCP_SOURCE_ID, cacheKey);

  if (!input.networkAllowed && !cached) {
    await recordContact(input.workspaceRoot, startedAt, false, destination, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw new RemoteFetchError("OFFLINE_BLOCKED", "MCP Registry: network access is disabled by the current operating mode. No request was made.");
  }
  if (cached && (!input.networkAllowed || isCacheFresh(cached, DEFAULT_CACHE_TTL_MS))) {
    const completedAt = new Date().toISOString();
    const parsed = parseMcpVersionsResponse(JSON.stringify(cached.data));
    return {
      serverName,
      versions: parsed.versions.map((entry) => ({ version: entry.version, releaseDate: entry.release_date, description: entry.description?.slice(0, 500), license: entry.license })),
      nextCursor: parsed.nextCursor,
      evidence: {
        ...baseEvidence(destination, startedAt, completedAt),
        completedAt,
        durationMs: 0,
        httpStatus: null,
        notModified: false,
        fromCache: true,
        stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS),
        freshness: "CACHED",
        etag: cached.etag,
        lastModified: cached.lastModified,
      },
      transparency: transparencyFor({
        destination,
        purpose: "Explicit MCP version-history read served from bounded cache without provider contact.",
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
      { sourceId: MCP_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, fetched.destination, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const parsed = parseMcpVersionsResponse(rawText);
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
    } else if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: MCP_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    return {
      serverName,
      versions: parsed.versions.map((entry) => ({ version: entry.version, releaseDate: entry.release_date, description: entry.description?.slice(0, 500), license: entry.license })),
      nextCursor: parsed.nextCursor,
      evidence: {
        ...baseEvidence(fetched.destination, startedAt, completedAt),
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
        purpose: "Explicit MCP version-history read (read-only discovery).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "MCP Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, destination, message);
    if (cached) {
      const parsed = parseMcpVersionsResponse(JSON.stringify(cached.data));
      return {
        serverName,
        versions: parsed.versions.map((entry) => ({ version: entry.version, releaseDate: entry.release_date, description: entry.description?.slice(0, 500), license: entry.license })),
        nextCursor: parsed.nextCursor,
        evidence: {
          ...baseEvidence(destination, startedAt, completedAt),
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached version history. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          destination,
          purpose: "Explicit MCP version-history read failed at the provider; last-good cached history served as STALE.",
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

/** Explicit MCP version-detail read. Same offline/cache/stale contract. */
export async function getMcpServerVersion(
  input: ServiceInput & { serverName: string; version: string },
): Promise<McpVersionDetailResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = getRemoteSource(MCP_SOURCE_ID);
  if (!source) throw new Error("MCP Registry: approved source definition is missing.");
  const serverName = validatedServerName(input.serverName);
  const version = validatedVersion(input.version);
  const url = buildMcpVersionDetailUrl(MCP_BASE_URL, serverName, version);
  const destination = "https://registry.modelcontextprotocol.io";
  const cacheKey = remoteCacheKey([MCP_SOURCE_ID, "version", serverName, version]);
  const cached = await readRemoteCache(input.workspaceRoot, MCP_SOURCE_ID, cacheKey);

  if (!input.networkAllowed && !cached) {
    await recordContact(input.workspaceRoot, startedAt, false, destination, "OFFLINE: network access is disabled by the current operating mode. No request was made.");
    throw new RemoteFetchError("OFFLINE_BLOCKED", "MCP Registry: network access is disabled by the current operating mode. No request was made.");
  }
  if (cached && (!input.networkAllowed || isCacheFresh(cached, DEFAULT_CACHE_TTL_MS))) {
    const completedAt = new Date().toISOString();
    const detail = parseMcpVersionDetailResponse(JSON.stringify(cached.data));
    const item = mcpServerToMarketplaceItem(
      { ...normalizeMcpServer({ name: serverName, version_detail: detail }, cached.fetchedAt, "CACHE"), version: detail.version },
      completedAt,
    );
    return {
      serverName,
      item,
      evidence: {
        ...baseEvidence(destination, startedAt, completedAt),
        completedAt,
        durationMs: 0,
        httpStatus: null,
        notModified: false,
        fromCache: true,
        stale: !isCacheFresh(cached, DEFAULT_CACHE_TTL_MS),
        freshness: "CACHED",
        etag: cached.etag,
        lastModified: cached.lastModified,
      },
      transparency: transparencyFor({
        destination,
        purpose: "Explicit MCP version-detail read served from bounded cache without provider contact.",
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
      { sourceId: MCP_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, fetched.destination, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const detail = parseMcpVersionDetailResponse(rawText);
    if (fetched.notModified && cached) {
      await revalidateRemoteCache(input.workspaceRoot, cached, completedAt, fetched.headers).catch(() => undefined);
    } else if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: MCP_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    const item = mcpServerToMarketplaceItem(
      { ...normalizeMcpServer({ name: serverName, version_detail: detail }, completedAt, fetched.notModified ? "CACHE" : "LIVE"), version: detail.version },
      completedAt,
    );
    return {
      serverName,
      item,
      evidence: {
        ...baseEvidence(fetched.destination, startedAt, completedAt),
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
        purpose: "Explicit MCP version-detail read (read-only discovery).",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "MCP Registry request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, destination, message);
    if (cached) {
      const detail = parseMcpVersionDetailResponse(JSON.stringify(cached.data));
      const item = mcpServerToMarketplaceItem(
        { ...normalizeMcpServer({ name: serverName, version_detail: detail }, cached.fetchedAt, "CACHE"), version: detail.version },
        completedAt,
      );
      return {
        serverName,
        item,
        evidence: {
          ...baseEvidence(destination, startedAt, completedAt),
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          httpStatus: error instanceof RemoteFetchError ? error.httpStatus : null,
          notModified: false,
          fromCache: true,
          stale: true,
          freshness: "STALE",
          etag: cached.etag,
          lastModified: cached.lastModified,
          error: `Provider failure; serving last-good cached version detail. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          destination,
          purpose: "Explicit MCP version-detail read failed at the provider; last-good cached detail served as STALE.",
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
