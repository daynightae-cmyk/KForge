import type { MarketplaceItem } from "../marketplaceCore";
import type { RemoteRequestEvidence } from "./contracts";
import { createOperationTransparency, recordRemoteContact } from "../onlineControlCenter";
import type { OperationTransparency } from "../../../shared/workspace";
import { isCacheFresh, readRemoteCache, remoteCacheKey, writeRemoteCache, DEFAULT_CACHE_TTL_MS } from "./cacheStore";
import { RemoteFetchError, safeFetchRemote, type FetchImpl, type SafeFetchPolicy } from "./fetchPolicy";
import { getRemoteSource } from "./registry";
import {
  HF_BASE_URL,
  HF_SOURCE_ID,
  buildHfModelUrl,
  buildHfModelsUrl,
  hfModelToMarketplaceItem,
  normalizeHfModel,
  parseHfModelResponse,
  parseHfModelsResponse,
  validatedHfModelId,
  type HfLocalEvidence,
  type HfSearchParams,
  type HfSort,
  type NormalizedHfModel,
} from "./adapters/huggingFace";

/**
 * Hugging Face Hub read service: explicit action → policy gate → bounded
 * cache → safe fetch → schema validation → normalization → provenance +
 * freshness → existing MarketplaceItem contract (Slice 4, P0).
 *
 * CATALOG ITEM != INSTALLED MODEL. Hub records are CATALOG_ONLY; when the
 * caller supplies local runtime inventory names, separate LOCAL evidence is
 * attached per model without merging into install truth. Gated/private
 * records are reported with their access state; bearer auth is never
 * accepted on this read path.
 *
 * Same offline/cache/stale contract as the catalog services. Every attempt
 * records redacted remote-contact evidence under the model-registry service.
 */

export interface HfServiceEvidence extends RemoteRequestEvidence {
  freshness: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface HfSearchResult {
  models: NormalizedHfModel[];
  items: MarketplaceItem[];
  localMatches: Record<string, HfLocalEvidence>;
  localRuntimeChecked: boolean;
  evidence: HfServiceEvidence;
  transparency: OperationTransparency;
}

export interface HfModelResult {
  model: NormalizedHfModel;
  item: MarketplaceItem;
  localMatches: Record<string, HfLocalEvidence>;
  localRuntimeChecked: boolean;
  evidence: HfServiceEvidence;
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
  /** Local runtime inventory names for separate LOCAL evidence (route-resolved, best-effort). */
  localModelNames?: string[];
}

function policyOverrides(input: ServiceInput): Pick<SafeFetchPolicy, "timeoutMs" | "maxRetries" | "hostResolver"> {
  return {
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
    ...(input.hostResolver ? { hostResolver: input.hostResolver } : {}),
  };
}

const DESTINATION = "https://huggingface.co";
const MAX_SEARCH_LENGTH = 200;
const MAX_FILTER_LENGTH = 200;
const MAX_CURSOR_LENGTH = 2000;
const SORTS: HfSort[] = ["lastModified", "likes", "downloads"];

function validatedSearch(params: HfSearchParams): Required<Pick<HfSearchParams, "limit">> & HfSearchParams {
  const limit = params.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Hugging Face Hub: limit must be an integer between 1 and 100.");
  }
  if (params.search !== undefined && (typeof params.search !== "string" || params.search.length > MAX_SEARCH_LENGTH)) {
    throw new Error("Hugging Face Hub: search must be a string of at most 200 characters.");
  }
  if (params.author !== undefined && (typeof params.author !== "string" || params.author.length === 0 || params.author.length > 100)) {
    throw new Error("Hugging Face Hub: author must be a string of 1-100 characters.");
  }
  if (params.filter !== undefined && (typeof params.filter !== "string" || params.filter.length > MAX_FILTER_LENGTH)) {
    throw new Error("Hugging Face Hub: filter must be a string of at most 200 characters.");
  }
  if (params.sort !== undefined && !SORTS.includes(params.sort)) {
    throw new Error("Hugging Face Hub: sort must be lastModified, likes, or downloads.");
  }
  if (params.direction !== undefined && params.direction !== -1 && params.direction !== 1) {
    throw new Error("Hugging Face Hub: direction must be -1 or 1.");
  }
  if (params.cursor !== undefined && (typeof params.cursor !== "string" || params.cursor.length > MAX_CURSOR_LENGTH)) {
    throw new Error("Hugging Face Hub: cursor must be an opaque string of at most 2000 characters.");
  }
  return { ...params, limit };
}

function sourceOrThrow() {
  const source = getRemoteSource(HF_SOURCE_ID);
  if (!source) throw new Error("Hugging Face Hub: approved source definition is missing.");
  return source;
}

function offlineError(): RemoteFetchError {
  return new RemoteFetchError("OFFLINE_BLOCKED", "Hugging Face Hub: network access is disabled by the current operating mode. No request was made.");
}

function baseEvidence(startedAt: string): Omit<HfServiceEvidence, "httpStatus" | "notModified" | "fromCache" | "stale" | "freshness" | "completedAt" | "durationMs"> {
  return {
    sourceId: HF_SOURCE_ID,
    destination: DESTINATION,
    method: "GET",
    startedAt,
    rateLimit: { observed429: false, source: "Hugging Face Hub" },
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
    provider: "Hugging Face Hub",
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
    await recordRemoteContact(workspaceRoot, "model-registry", { attemptedAt, succeeded, destination: DESTINATION, error });
  } catch {
    // Contact evidence is observational; it must never fail the catalog read.
  }
}

function durationMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function withLocal(models: NormalizedHfModel[]): { items: MarketplaceItem[]; localMatches: Record<string, HfLocalEvidence>; checked: boolean } {
  const completedAt = new Date().toISOString();
  const items = models.map((model) => hfModelToMarketplaceItem(model, completedAt));
  const localMatches: Record<string, HfLocalEvidence> = {};
  let checked = false;
  for (const model of models) {
    if (model.localEvidence.state !== "NOT_CHECKED") checked = true;
    if (model.localEvidence.state === "INSTALLED") localMatches[model.modelId] = model.localEvidence;
  }
  return { items, localMatches, checked };
}

/** Explicit Hub catalog search. OFFLINE refuses before any socket opens. */
export async function searchHfModels(input: ServiceInput & HfSearchParams): Promise<HfSearchResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const params = validatedSearch(input);
  const url = buildHfModelsUrl(HF_BASE_URL, params);
  // Cache identity is the provider request only: mode flags, workspace paths,
  // local inventory, and injected doubles must never fork the cache namespace.
  const cacheKey = remoteCacheKey([
    HF_SOURCE_ID,
    "models",
    params.search ?? "",
    params.author ?? "",
    params.filter ?? "",
    params.sort ?? "",
    String(params.direction ?? ""),
    String(params.limit),
    params.cursor ?? "",
  ]);
  const cached = await readRemoteCache(input.workspaceRoot, HF_SOURCE_ID, cacheKey);
  const localNames = input.localModelNames;

  const fromCache = (rawData: unknown, fetchedAt: string, stale: boolean, note?: string): HfSearchResult => {
    const completedAt = new Date().toISOString();
    const models = parseHfModelsResponse(JSON.stringify(rawData)).map((record) =>
      normalizeHfModel(record, fetchedAt, "CACHE", stale ? "STALE" : "CACHED", localNames),
    );
    const projected = withLocal(models);
    return {
      models,
      items: projected.items,
      localMatches: projected.localMatches,
      localRuntimeChecked: projected.checked,
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
        purpose: note ?? "Explicit Hugging Face search served from bounded cache without provider contact. Catalog only.",
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
    const fetched = await safeFetchRemote(
      url,
      {
        sourceId: HF_SOURCE_ID,
        allowedOrigins: source.allowedOrigins,
        networkAllowed: true,
        ifNoneMatch: cached?.etag,
        ifModifiedSince: cached?.lastModified,
        ...policyOverrides(input),
      },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    if (fetched.notModified && cached) {
      await writeRemoteCache(input.workspaceRoot, { ...cached, fetchedAt: completedAt, etag: fetched.headers.etag ?? cached.etag }).catch(() => undefined);
      const models = parseHfModelsResponse(JSON.stringify(cached.data)).map((record) => normalizeHfModel(record, completedAt, "CACHE", "CURRENT", localNames));
      const projected = withLocal(models);
      return {
        models,
        items: projected.items,
        localMatches: projected.localMatches,
        localRuntimeChecked: projected.checked,
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
          purpose: "Explicit Hugging Face search revalidated with the provider (HTTP 304); cached catalog remains current.",
          startedAt,
          completedAt,
          result: "SUCCEEDED",
          fromCache: true,
        }),
      };
    }
    const models = parseHfModelsResponse(fetched.text).map((record) => normalizeHfModel(record, completedAt, "LIVE", "CURRENT", localNames));
    const projected = withLocal(models);
    await writeRemoteCache(
      input.workspaceRoot,
      {
        sourceId: HF_SOURCE_ID,
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
      models,
      items: projected.items,
      localMatches: projected.localMatches,
      localRuntimeChecked: projected.checked,
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
        purpose: "Explicit Hugging Face search fetched live catalog metadata. Catalog only; not installed.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: false,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Hugging Face Hub request failed.";
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
          error: `Provider failure; serving last-good cached catalog. ${message}`.slice(0, 500),
        },
      };
    }
    throw error;
  }
}

/** Explicit Hub model-detail read. Same offline/cache/stale contract. */
export async function getHfModel(input: ServiceInput & { id: string }): Promise<HfModelResult> {
  const startedAt = input.now ?? new Date().toISOString();
  const source = sourceOrThrow();
  const id = validatedHfModelId(input.id);
  const url = buildHfModelUrl(HF_BASE_URL, id);
  const cacheKey = remoteCacheKey([HF_SOURCE_ID, "model", id]);
  const cached = await readRemoteCache(input.workspaceRoot, HF_SOURCE_ID, cacheKey);
  const localNames = input.localModelNames;

  const build = (record: ReturnType<typeof parseHfModelResponse>, at: string, origin: "LIVE" | "CACHE", freshness: "CURRENT" | "CACHED" | "STALE"): { model: NormalizedHfModel; item: MarketplaceItem } => {
    const completedAt = new Date().toISOString();
    const model = normalizeHfModel(record, at, origin, freshness, localNames);
    return { model, item: hfModelToMarketplaceItem(model, completedAt) };
  };

  if (!input.networkAllowed) {
    if (cached) {
      const completedAt = new Date().toISOString();
      const { model, item } = build(parseHfModelResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED");
      const projected = withLocal([model]);
      return {
        model,
        item,
        localMatches: projected.localMatches,
        localRuntimeChecked: projected.checked,
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
          purpose: "Explicit Hugging Face model read served from bounded cache (offline mode). Catalog only.",
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
    const { model, item } = build(parseHfModelResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "CACHED");
    const projected = withLocal([model]);
    return {
      model,
      item,
      localMatches: projected.localMatches,
      localRuntimeChecked: projected.checked,
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
        purpose: "Explicit Hugging Face model read served from fresh bounded cache. Catalog only.",
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
      { sourceId: HF_SOURCE_ID, allowedOrigins: source.allowedOrigins, networkAllowed: true, ifNoneMatch: cached?.etag, ifModifiedSince: cached?.lastModified, ...policyOverrides(input) },
      input.fetchImpl,
    );
    const completedAt = new Date().toISOString();
    await recordContact(input.workspaceRoot, startedAt, true, null);
    const rawText = fetched.notModified && cached ? JSON.stringify(cached.data) : fetched.text;
    const { model, item } = build(parseHfModelResponse(rawText), fetched.notModified && cached ? cached.fetchedAt : completedAt, fetched.notModified ? "CACHE" : "LIVE", "CURRENT");
    const projected = withLocal([model]);
    if (!fetched.notModified) {
      await writeRemoteCache(
        input.workspaceRoot,
        { sourceId: HF_SOURCE_ID, key: cacheKey, url, fetchedAt: completedAt, etag: fetched.headers.etag, lastModified: fetched.headers.lastModified, cacheControl: fetched.headers.cacheControl, data: JSON.parse(fetched.text) as unknown },
      ).catch(() => undefined);
    }
    return {
      model,
      item,
      localMatches: projected.localMatches,
      localRuntimeChecked: projected.checked,
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
        purpose: "Explicit Hugging Face model read. Catalog only; not installed.",
        startedAt,
        completedAt,
        result: "SUCCEEDED",
        fromCache: fetched.notModified,
      }),
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Hugging Face Hub request failed.";
    await recordContact(input.workspaceRoot, startedAt, false, message);
    if (cached) {
      const { model, item } = build(parseHfModelResponse(JSON.stringify(cached.data)), cached.fetchedAt, "CACHE", "STALE");
      const projected = withLocal([model]);
      return {
        model,
        item,
        localMatches: projected.localMatches,
        localRuntimeChecked: projected.checked,
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
          error: `Provider failure; serving last-good cached model. ${message}`.slice(0, 500),
        },
        transparency: transparencyFor({
          purpose: "Explicit Hugging Face model read failed at the provider; last-good cached model served as STALE.",
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
