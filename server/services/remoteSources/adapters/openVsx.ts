import { z } from "zod";
import type { MarketplaceItem, MarketplacePermission } from "../../marketplaceCore";
import type {
  IntegrityEvidence,
  LicenseEvidence,
  NormalizedRemoteItem,
  ProvenanceEvidence,
  SignatureEvidence,
} from "../contracts";
import { missingIntegrity, unknownLicense, unverifiedSignature } from "../contracts";

/**
 * Open VSX Registry adapter: read-only discovery (Slice 2, P0).
 *
 * Source: https://open-vsx.org
 * OpenAPI: https://open-vsx.org/v3/api-docs/registry
 * Terms: https://www.eclipse.org/legal/termsofuse.php
 * Operations: search/query, extension detail (latest), version detail,
 * version references. No install, no download-activation: catalog results
 * are CATALOG_ONLY / REMOTE_REGISTRY and become installable only through
 * the EXISTING Marketplace lifecycle (immutable VSIX + expected integrity
 * + compatibility + confirmation), which is a later slice.
 *
 * Schemas are intentionally tolerant: only publisher-namespace + extension
 * identity is required and every provider field is optional passthrough.
 * Malformed identity fails closed; unknown extra fields never become
 * trusted claims.
 */

export const OPEN_VSX_SOURCE_ID = "open-vsx" as const;
export const OPEN_VSX_BASE_URL = "https://open-vsx.org";

const ovsxFilesSchema = z.record(z.unknown()).optional();

const ovsxExtensionSchema = z
  .object({
    namespace: z.string().min(1),
    name: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    versions: z.unknown().optional(),
    allVersions: z.unknown().optional(),
    versionAlias: z.unknown().optional(),
    verified: z.boolean().optional(),
    publishedBy: z.unknown().optional(),
    license: z.string().optional(),
    repository: z.string().optional(),
    homepage: z.string().optional(),
    downloadUrl: z.string().optional(),
    download: z.string().optional(),
    files: ovsxFilesSchema,
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    targetPlatform: z.string().optional(),
    targetPlatforms: z.array(z.string()).optional(),
    timestamp: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

const ovsxSearchResponseSchema = z
  .object({
    extensions: z.array(ovsxExtensionSchema),
    offset: z.number().optional(),
    totalSize: z.number().optional(),
  })
  .passthrough();

export type OvsxExtensionRecord = z.infer<typeof ovsxExtensionSchema>;

export interface OvsxSearchResult {
  extensions: OvsxExtensionRecord[];
  offset?: number;
  totalSize?: number;
}

function errorMessage(context: string): string {
  return `Open VSX Registry: ${context} does not match the documented response shape; the provider response was refused.`;
}

/** Validate a search/query response. Throws on malformed JSON or schema mismatch. */
export function parseOvsxSearchResponse(rawText: string): OvsxSearchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(errorMessage("malformed JSON in extension search"));
  }
  if (Array.isArray(parsed)) parsed = { extensions: parsed };
  const validation = ovsxSearchResponseSchema.safeParse(parsed);
  if (!validation.success) throw new Error(errorMessage("extension search"));
  return { extensions: validation.data.extensions, offset: validation.data.offset, totalSize: validation.data.totalSize };
}

/** Validate an extension-detail response (latest version). Throws on mismatch. */
export function parseOvsxExtensionResponse(rawText: string): OvsxExtensionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(errorMessage("malformed JSON in extension detail"));
  }
  const candidate = (parsed as Record<string, unknown>)?.extension ?? parsed;
  const validation = ovsxExtensionSchema.safeParse(candidate);
  if (!validation.success) throw new Error(errorMessage("extension detail"));
  return validation.data;
}

/** Validate a version-detail response. Throws on mismatch or missing immutable version. */
export function parseOvsxVersionResponse(rawText: string): OvsxExtensionRecord {
  const record = parseOvsxExtensionResponse(rawText);
  if (!record.version) throw new Error(errorMessage("version detail without an immutable version"));
  return record;
}

/**
 * Validate a version-references response. Accepts the documented shapes:
 * a bare array, { versions: [...] }, or { allVersions: [...] }, where each
 * entry is a version string or an object carrying one.
 */
export function parseOvsxVersionsResponse(rawText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(errorMessage("malformed JSON in version references"));
  }
  const container = Array.isArray(parsed)
    ? parsed
    : ((parsed as Record<string, unknown>)?.versions ?? (parsed as Record<string, unknown>)?.allVersions ?? null);
  if (!Array.isArray(container)) throw new Error(errorMessage("version references"));
  const versions = container.flatMap((entry): string[] => {
    if (typeof entry === "string" && entry.length > 0) return [entry.slice(0, 100)];
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).version === "string") {
      return [((entry as Record<string, unknown>).version as string).slice(0, 100)];
    }
    return [];
  });
  if (versions.length === 0) throw new Error(errorMessage("version references without versions"));
  return versions;
}

export interface OvsxSearchParams {
  query?: string;
  category?: string;
  size?: number;
  offset?: number;
}

export function buildOvsxSearchUrl(base: string, params: OvsxSearchParams): string {
  const url = new URL("/api/-/search", base);
  if (params.query) url.searchParams.set("query", params.query);
  if (params.category) url.searchParams.set("category", params.category);
  if (params.size !== undefined) url.searchParams.set("size", String(params.size));
  if (params.offset !== undefined) url.searchParams.set("offset", String(params.offset));
  return url.toString();
}

export function buildOvsxExtensionUrl(base: string, namespace: string, extension: string): string {
  return new URL(`/api/${encodeURIComponent(namespace)}/${encodeURIComponent(extension)}`, base).toString();
}

export function buildOvsxVersionUrl(base: string, namespace: string, extension: string, version: string): string {
  return new URL(
    `/api/${encodeURIComponent(namespace)}/${encodeURIComponent(extension)}/${encodeURIComponent(version)}`,
    base,
  ).toString();
}

export function buildOvsxVersionsUrl(base: string, namespace: string, extension: string): string {
  return new URL(`/api/${encodeURIComponent(namespace)}/${encodeURIComponent(extension)}/versions`, base).toString();
}

function publisherOf(record: OvsxExtensionRecord): string | undefined {
  const publishedBy = record.publishedBy as { login?: unknown; name?: unknown } | string | undefined;
  if (typeof publishedBy === "string" && publishedBy.length > 0) return publishedBy.slice(0, 200);
  if (publishedBy && typeof publishedBy === "object") {
    const login = typeof publishedBy.login === "string" ? publishedBy.login : undefined;
    const name = typeof publishedBy.name === "string" ? publishedBy.name : undefined;
    return (login || name || undefined)?.slice(0, 200);
  }
  return undefined;
}

function fileEntries(files: OvsxExtensionRecord["files"]): Array<[string, unknown]> {
  if (!files || typeof files !== "object") return [];
  return Object.entries(files);
}

function fileUrl(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value.slice(0, 2000);
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string") {
    return ((value as Record<string, unknown>).url as string).slice(0, 2000);
  }
  return undefined;
}

function licenseFrom(record: OvsxExtensionRecord): LicenseEvidence {
  if (record.license && record.license.trim().length > 0) {
    return { state: "CLASSIFIED", license: record.license.slice(0, 200), source: "Open VSX Registry record" };
  }
  return unknownLicense("The Open VSX record carries no license field; UNKNOWN is not open source.");
}

function integrityFrom(record: OvsxExtensionRecord): IntegrityEvidence {
  for (const [, value] of fileEntries(record.files)) {
    const candidates = [
      (value as Record<string, unknown> | null)?.sha256,
      (value as Record<string, unknown> | null)?.checksum,
      (value as Record<string, unknown> | null)?.digest,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && /^[a-f0-9]{64}$/i.test(candidate)) {
        return { state: "EXPECTED", algorithm: "sha256", expectedHash: candidate.toLowerCase(), source: "Open VSX Registry file metadata" };
      }
    }
  }
  return missingIntegrity("No integrity field was supplied by the Open VSX response.");
}

function signatureFrom(record: OvsxExtensionRecord): SignatureEvidence {
  const kinds = fileEntries(record.files).map(([kind]) => kind.toLowerCase());
  const declares = kinds.some((kind) => kind.includes("signature") || kind.includes("publickey") || kind.includes("public-key"));
  // Asset presence is not verification: a listed signature file is noted, never trusted.
  return declares
    ? { state: "NOT_AVAILABLE", source: "Open VSX lists signature/public-key assets; presence is not verification." }
    : unverifiedSignature("The Open VSX response carries no signature evidence for this record.");
}

export interface NormalizedOvsxExtension extends NormalizedRemoteItem {
  kind: "openvsx-extension";
  namespace: string;
  extension: string;
  displayName: string;
  description: string;
  version?: string;
  versions: string[];
  verified: boolean;
  publisher?: string;
  repositoryUrl?: string;
  homepageUrl?: string;
  downloadUrl?: string;
  files: Record<string, string>;
  categories: string[];
  tags: string[];
  targetPlatforms: string[];
  updatedAt?: string;
}

/** Normalize one registry extension record. Registry metadata is discovery only, never runtime proof. */
export function normalizeOvsxExtension(
  record: OvsxExtensionRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  versions: string[] = [],
): NormalizedOvsxExtension {
  const files: Record<string, string> = {};
  for (const [kind, value] of fileEntries(record.files)) {
    const url = fileUrl(value);
    if (url) files[kind] = url;
  }
  const downloadUrl = record.downloadUrl || record.download || files.download || files.vsix || files.VSIX;
  const repositoryUrl = record.repository;
  const targetPlatforms = [
    ...(record.targetPlatform ? [record.targetPlatform] : []),
    ...(record.targetPlatforms ?? []),
  ].slice(0, 8);
  return {
    kind: "openvsx-extension",
    sourceId: OPEN_VSX_SOURCE_ID,
    namespace: record.namespace,
    extension: record.name,
    displayName: (record.displayName || record.name).slice(0, 200),
    description: (record.description || "No description was supplied by the Open VSX Registry.").slice(0, 2000),
    version: record.version,
    versions,
    verified: record.verified === true,
    publisher: publisherOf(record),
    repositoryUrl,
    homepageUrl: record.homepage,
    downloadUrl,
    files,
    categories: (record.categories ?? []).slice(0, 12),
    tags: (record.tags ?? []).slice(0, 24),
    targetPlatforms,
    updatedAt: record.timestamp || record.updatedAt,
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: {
      state: "NOT_AVAILABLE",
      sources: ["Registry catalog metadata only; no extension host verification was attempted."],
    },
    freshness: { state: origin === "CACHE" ? "CACHED" : "CURRENT", at: retrievedAt },
    license: licenseFrom(record),
    integrity: integrityFrom(record),
    signature: signatureFrom(record),
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: OPEN_VSX_SOURCE_ID,
      canonicalUrl: `https://open-vsx.org/extension/${encodeURIComponent(record.namespace)}/${encodeURIComponent(record.name)}${record.version ? `/${encodeURIComponent(record.version)}` : ""}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "Open VSX Registry",
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
 * Project a normalized Open VSX extension onto the EXISTING MarketplaceItem
 * contract so the current Workbench cards and canonical Inspector render
 * real remote evidence without any new UI truth model. Install stays
 * NOT_AVAILABLE: read-only discovery cannot stage a VSIX; installation
 * requires the existing lifecycle (immutable artifact + expected integrity
 * + compatibility + confirmation), which is a later slice.
 */
export function ovsxExtensionToMarketplaceItem(normalized: NormalizedOvsxExtension, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote registry metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "Open VSX Registry";
  const changelogUrl = normalized.files.changelog || normalized.files.CHANGELOG;
  return {
    id: `openvsx:${normalized.namespace}/${normalized.extension}`,
    category: "plugins",
    taxonomy: ["extensions"],
    name: `${normalized.namespace}.${normalized.extension}`,
    description: normalized.description,
    overview: normalized.description,
    features: [
      "openvsx-extension",
      "remote-catalog",
      normalized.verified ? "namespace-verified" : "namespace-unverified",
      ...normalized.targetPlatforms.slice(0, 2),
      ...normalized.categories.slice(0, 4),
    ],
    source: "Open VSX Registry",
    sourceUrl: normalized.provenance.canonicalUrl,
    ...(normalized.version ? { version: normalized.version } : {}),
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["openvsx-extension", ...Object.keys(normalized.files).slice(0, 8)],
    requirements: [
      "Explicit user confirmation plus immutable VSIX, expected integrity, and compatibility evidence before any install (existing Marketplace lifecycle; not implemented in read-only discovery).",
    ],
    compatibility: normalized.targetPlatforms.length > 0 ? normalized.targetPlatforms.join(", ") : "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the Open VSX catalog response." },
    publisher: normalized.publisher
      ? { state: normalized.verified ? "UNKNOWN" : "UNKNOWN", source: `${evidenceSource}; namespace verified: ${normalized.verified}`, value: normalized.publisher }
      : { state: "UNKNOWN", source: "No publisher evidence was supplied by the Open VSX response." },
    repository: normalized.repositoryUrl
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.repositoryUrl }
      : { state: "UNKNOWN", source: "No repository evidence was supplied by the Open VSX response." },
    releaseHistory:
      normalized.versions.length > 0
        ? { state: "UNKNOWN", source: `${evidenceSource} version metadata (catalog list, not verification).`, items: normalized.versions }
        : { state: "NOT_AVAILABLE", source: "Version history requires the explicit versions endpoint.", items: [] },
    changelog: changelogUrl
      ? { state: "UNKNOWN", source: evidenceSource, value: changelogUrl }
      : { state: "NOT_AVAILABLE", source: "No changelog asset is supplied by the Open VSX catalog response." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote Open VSX catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is supplied by the Open VSX catalog response.", items: [] },
    provenance: {
      state: "UNKNOWN",
      source: `${evidenceSource}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.provenance.canonicalUrl,
    },
    integrity:
      normalized.integrity.state === "EXPECTED" && normalized.integrity.expectedHash
        ? { state: "UNKNOWN", source: "Open VSX Registry file metadata", value: `sha256:${normalized.integrity.expectedHash}` }
        : { state: "NOT_AVAILABLE", source: "No integrity field was supplied by the Open VSX response." },
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
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: no verified Open VSX install adapter exists yet." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
  };
}
