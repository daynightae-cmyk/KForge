import { z } from "zod";
import type { MarketplaceItem, MarketplacePermission } from "../../marketplaceCore";
import type {
  IntegrityEvidence,
  LicenseEvidence,
  NormalizedRemoteItem,
  SignatureEvidence,
} from "../contracts";
import { missingIntegrity, unknownLicense, unverifiedSignature } from "../contracts";

/**
 * Hugging Face Hub adapter: public model catalog reads (Slice 4, P0).
 *
 * Source: https://huggingface.co
 * OpenAPI: https://huggingface.co/.well-known/openapi.json
 * Terms: https://huggingface.co/terms-of-service
 * Operations: model search/list, model detail (with file siblings).
 * Only fields actually supplied by the current endpoints are captured.
 *
 * CATALOG ITEM != INSTALLED MODEL. A Hub record is CATALOG_ONLY with
 * runtime NOT_AVAILABLE; when the local Ollama/LM Studio inventory reports
 * a matching model, separate LOCAL evidence is attached alongside — never
 * merged into install truth. Gated/private records stay
 * NOT_CONFIGURED/BLOCKED; bearer credentials are never accepted by this
 * read path and stay server-side.
 *
 * Schemas are intentionally tolerant: only the model id is required and
 * every provider field is optional passthrough.
 */

export const HF_SOURCE_ID = "hugging-face-hub" as const;
export const HF_BASE_URL = "https://huggingface.co";

const hfSiblingSchema = z
  .object({
    rfilename: z.string().optional(),
    size: z.number().optional(),
    lfs: z.object({ sha256: z.string().optional(), oid: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const hfCardDataSchema = z.object({ license: z.string().optional() }).passthrough();

const hfModelSchema = z
  .object({
    id: z.string().min(1),
    author: z.string().optional(),
    sha: z.string().optional(),
    lastModified: z.string().optional(),
    private: z.boolean().optional(),
    disabled: z.boolean().optional(),
    gated: z.union([z.boolean(), z.string()]).optional(),
    likes: z.number().optional(),
    downloads: z.number().optional(),
    tags: z.array(z.string()).optional(),
    pipeline_tag: z.string().optional(),
    library_name: z.string().optional(),
    license: z.string().optional(),
    cardData: hfCardDataSchema.optional(),
    siblings: z.array(hfSiblingSchema).optional(),
  })
  .passthrough();

const hfListResponseSchema = z.union([z.array(hfModelSchema), z.object({ models: z.array(hfModelSchema) }).passthrough()]);

export type HfModelRecord = z.infer<typeof hfModelSchema>;

function errorMessage(context: string): string {
  return `Hugging Face Hub: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

/** Validate a model search/list response. */
export function parseHfModelsResponse(rawText: string): HfModelRecord[] {
  const validation = hfListResponseSchema.safeParse(parseJson(rawText, "model search"));
  if (!validation.success) throw new Error(errorMessage("model search"));
  return Array.isArray(validation.data) ? validation.data : validation.data.models;
}

/** Validate a model-detail response. */
export function parseHfModelResponse(rawText: string): HfModelRecord {
  const validation = hfModelSchema.safeParse(parseJson(rawText, "model detail"));
  if (!validation.success) throw new Error(errorMessage("model detail"));
  return validation.data;
}

export type HfSort = "lastModified" | "likes" | "downloads";

export interface HfSearchParams {
  search?: string;
  author?: string;
  filter?: string;
  sort?: HfSort;
  direction?: -1 | 1;
  limit?: number;
  cursor?: string;
}

export function buildHfModelsUrl(base: string, params: HfSearchParams): string {
  const url = new URL("/api/models", base);
  if (params.search) url.searchParams.set("search", params.search);
  if (params.author) url.searchParams.set("author", params.author);
  if (params.filter) url.searchParams.set("filter", params.filter);
  if (params.sort) url.searchParams.set("sort", params.sort);
  if (params.direction !== undefined) url.searchParams.set("direction", String(params.direction));
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  return url.toString();
}

const HF_ID_SEGMENT = "[A-Za-z0-9._-]{1,200}";
export const HF_MODEL_ID_PATTERN = new RegExp(`^${HF_ID_SEGMENT}/${HF_ID_SEGMENT}$`);

export function validatedHfModelId(id: string): string {
  if (!HF_MODEL_ID_PATTERN.test(id)) throw new Error("Hugging Face Hub: model id must be namespace/name with supported characters.");
  return id;
}

export function buildHfModelUrl(base: string, id: string): string {
  const [namespace, name] = validatedHfModelId(id).split("/");
  return new URL(`/api/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, base).toString();
}

export type HfAccessState = "OPEN" | "GATED" | "PRIVATE" | "DISABLED" | "UNKNOWN";

export interface HfModelFile {
  name: string;
  size?: number;
  sha256?: string;
}

export type HfLocalMatchState = "INSTALLED" | "NOT_DETECTED" | "NOT_CHECKED";

export interface HfLocalEvidence {
  state: HfLocalMatchState;
  matchedName?: string;
  method?: string;
  source: string;
}

export interface NormalizedHfModel extends NormalizedRemoteItem {
  kind: "huggingface-model";
  sourceId: typeof HF_SOURCE_ID;
  modelId: string;
  publisher?: string;
  revision?: string;
  tags: string[];
  task?: string;
  library?: string;
  access: { state: HfAccessState; detail: string };
  files: HfModelFile[];
  totalBytes?: number;
  likes?: number;
  downloads?: number;
  updatedAt?: string;
  modelCardUrl: string;
  localEvidence: HfLocalEvidence;
}

function licenseFrom(record: HfModelRecord): LicenseEvidence {
  const license = record.license || record.cardData?.license;
  if (license && license.trim().length > 0) {
    return { state: "CLASSIFIED", license: license.slice(0, 200), source: "Hugging Face Hub record" };
  }
  return unknownLicense("The Hub record carries no license field; UNKNOWN is not open source.");
}

function accessFrom(record: HfModelRecord): NormalizedHfModel["access"] {
  if (record.disabled === true) return { state: "DISABLED", detail: "The Hub marks this model disabled." };
  if (record.private === true) return { state: "PRIVATE", detail: "Private model: bearer auth and terms required (NOT_CONFIGURED in read-only discovery)." };
  if (record.gated === true || record.gated === "manual" || record.gated === "auto") {
    return { state: "GATED", detail: `Gated model (${String(record.gated)}): repository terms must be accepted before access.` };
  }
  if (record.gated === false || record.gated === undefined) {
    return record.private === false || record.gated === false
      ? { state: "OPEN", detail: "Public model record." }
      : { state: "UNKNOWN", detail: "No gating field was supplied by the Hub record." };
  }
  return { state: "UNKNOWN", detail: "No gating field was supplied by the Hub record." };
}

function filesFrom(record: HfModelRecord): { files: HfModelFile[]; integrity: IntegrityEvidence; totalBytes?: number } {
  const files: HfModelFile[] = [];
  const hashes: string[] = [];
  let total = 0;
  let sized = false;
  for (const sibling of record.siblings ?? []) {
    if (!sibling.rfilename) continue;
    const sha256 = typeof sibling.lfs?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(sibling.lfs.sha256) ? sibling.lfs.sha256.toLowerCase() : undefined;
    if (sha256) hashes.push(sha256);
    if (typeof sibling.size === "number" && sibling.size >= 0) {
      total += sibling.size;
      sized = true;
    }
    files.push({ name: sibling.rfilename.slice(0, 500), ...(typeof sibling.size === "number" ? { size: sibling.size } : {}), ...(sha256 ? { sha256 } : {}) });
    if (files.length >= 200) break;
  }
  return {
    files,
    integrity: hashes.length > 0
      ? { state: "EXPECTED", algorithm: "sha256", expectedHash: hashes[0], source: "Hugging Face Hub file metadata (first artifact hash; full list retained)" }
      : missingIntegrity("No artifact hash was supplied by the Hub record."),
    ...(sized ? { totalBytes: total } : {}),
  };
}

/**
 * Match a Hub model id against local runtime inventory names by token
 * overlap. Heuristic only: the method is always reported and a match is
 * separate LOCAL evidence, never install proof. Tokens are alpha/numeric
 * runs (version numbers survive as numeric tokens); threshold is >= 2
 * shared tokens.
 */
export function matchHfLocal(modelId: string, localNames: string[]): { matchedName: string; sharedTokens: string[] } | null {
  const tokenize = (value: string): Set<string> => {
    const runs = value.toLowerCase().match(/[a-z]+|[0-9]+/g) || [];
    return new Set(runs.filter((token) => token.length >= 2 || /^\d+$/.test(token)));
  };
  const wanted = tokenize(modelId);
  if (wanted.size === 0) return null;
  let best: { matchedName: string; sharedTokens: string[] } | null = null;
  for (const name of localNames) {
    if (name.length < 3) continue;
    const have = tokenize(name);
    const shared = [...wanted].filter((token) => have.has(token));
    if (shared.length >= 2 && (!best || shared.length > best.sharedTokens.length)) {
      best = { matchedName: name, sharedTokens: shared };
    }
  }
  return best;
}

/** Normalize one Hub model record. Catalog metadata only — never install/runtime truth. */
export function normalizeHfModel(
  record: HfModelRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
  localNames?: string[],
): NormalizedHfModel {
  const { files, integrity, totalBytes } = filesFrom(record);
  const access = accessFrom(record);
  const match = localNames ? matchHfLocal(record.id, localNames) : null;
  return {
    kind: "huggingface-model",
    sourceId: HF_SOURCE_ID,
    modelId: record.id,
    publisher: record.author,
    revision: record.sha,
    tags: (record.tags ?? []).slice(0, 48),
    task: record.pipeline_tag,
    library: record.library_name,
    access,
    files,
    totalBytes,
    likes: typeof record.likes === "number" ? record.likes : undefined,
    downloads: typeof record.downloads === "number" ? record.downloads : undefined,
    updatedAt: record.lastModified,
    modelCardUrl: `https://huggingface.co/${record.id}`,
    localEvidence: localNames === undefined
      ? { state: "NOT_CHECKED", source: "Local runtime inventory was not consulted for this catalog read." }
      : match
        ? { state: "INSTALLED", matchedName: match.matchedName, method: `token-overlap on ${match.sharedTokens.length} shared tokens (verify before use)`, source: "Local model runtime inventory (separate LOCAL evidence)" }
        : { state: "NOT_DETECTED", source: "Local model runtime inventory reports no matching installed model." },
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: {
      state: "NOT_AVAILABLE",
      sources: ["Hub catalog metadata only; no local inference verification was attempted."],
    },
    freshness: { state: freshness, at: retrievedAt },
    license: licenseFrom(record),
    integrity,
    signature: unverifiedSignature("The Hub record carries no signature evidence for this model."),
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: HF_SOURCE_ID,
      canonicalUrl: `https://huggingface.co/${record.id}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "Hugging Face Hub",
    },
    trustStage: "CATALOG_DISCOVERED",
  };
}

const PERMISSION_IDS = [
  "filesystem-read",
  "filesystem-write",
  "network",
  "process-execution",
  "git",
  "project-read",
  "project-write",
  "ai-access",
  "external-apis",
] as const;

/**
 * Project a normalized Hub model onto the EXISTING MarketplaceItem contract
 * so the current Workbench cards and canonical Inspector render real remote
 * evidence without any new UI truth model. Install stays NOT_AVAILABLE:
 * read-only discovery cannot download weights; model installation remains
 * a future verified workflow with explicit confirmation.
 */
export function hfModelToMarketplaceItem(normalized: NormalizedHfModel, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote catalog metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "Hugging Face Hub";
  return {
    id: `huggingface:${normalized.modelId}`,
    category: "models",
    taxonomy: ["models"],
    name: normalized.modelId,
    description: `Hugging Face model${normalized.publisher ? ` by ${normalized.publisher}` : ""}${normalized.task ? ` · ${normalized.task}` : ""}. Revision ${normalized.revision ? normalized.revision.slice(0, 12) : "unknown"} · access ${normalized.access.state}.`,
    overview: `Hugging Face model${normalized.publisher ? ` by ${normalized.publisher}` : ""}${normalized.task ? ` · ${normalized.task}` : ""}. Revision ${normalized.revision ? normalized.revision.slice(0, 12) : "unknown"} · access ${normalized.access.state}.`,
    features: [
      "huggingface-model",
      "remote-catalog",
      ...(normalized.task ? [normalized.task] : []),
      ...(normalized.library ? [normalized.library] : []),
      `access-${normalized.access.state.toLowerCase()}`,
      ...(normalized.localEvidence.state === "INSTALLED" ? ["local-runtime-match"] : []),
    ],
    source: "Hugging Face Hub",
    sourceUrl: normalized.modelCardUrl,
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["huggingface-model", ...(normalized.tags.slice(0, 8))],
    requirements: [
      normalized.localEvidence.state === "INSTALLED"
        ? `Local runtime reports an installed match (${normalized.localEvidence.matchedName}); separate LOCAL evidence, not install proof.`
        : "Explicit user confirmation plus a verified model-install workflow before any download (not implemented in read-only discovery).",
    ],
    compatibility: "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the Hub catalog record." },
    publisher: normalized.publisher
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.publisher }
      : { state: "UNKNOWN", source: "No publisher evidence was supplied by the Hub record." },
    repository: { state: "UNKNOWN", source: evidenceSource, value: normalized.modelCardUrl },
    releaseHistory: { state: "NOT_AVAILABLE", source: "Hub revisions are commits, not a version feed; use the explicit detail endpoint.", items: [] },
    changelog: { state: "NOT_AVAILABLE", source: "No changelog is supplied by the Hub catalog record." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not local installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote Hub catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is supplied by the Hub catalog record.", items: [] },
    provenance: {
      state: "UNKNOWN",
      source: `${evidenceSource}; revision ${normalized.revision || "unknown"}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.modelCardUrl,
    },
    integrity:
      normalized.integrity.state === "EXPECTED" && normalized.integrity.expectedHash
        ? { state: "UNKNOWN", source: "Hugging Face Hub file metadata", value: `sha256:${normalized.integrity.expectedHash}` }
        : { state: "NOT_AVAILABLE", source: "No artifact hash was supplied by the Hub record." },
    trust: "UNTRUSTED",
    installed: false,
    enabled: false,
    local: false,
    installAction: "NOT_AVAILABLE",
    dataState: "AVAILABLE",
    ...(normalized.updatedAt ? { updatedAt: normalized.updatedAt } : {}),
    authority: normalized.authority,
    availability: "CATALOG",
    checkedAt,
    freshness: normalized.freshness,
    runtimeEvidence: normalized.runtimeEvidence,
    healthState: "UNAVAILABLE",
    actionEligibility: {
      state: "DISABLED",
      actions: [
        { id: "inspect", enabled: true, requiresConfirmation: false },
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: no verified model install adapter exists yet." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Download requires a future verified adapter plus explicit confirmation.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Download requires a future verified adapter plus explicit confirmation.",
  };
}
