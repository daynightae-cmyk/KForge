import { z } from "zod";
import type { MarketplaceItem, MarketplacePermission } from "../../marketplaceCore";
import type { IntegrityEvidence, LicenseEvidence, NormalizedRemoteItem, SignatureEvidence } from "../contracts";
import { missingIntegrity, unknownLicense, unverifiedSignature } from "../contracts";

/**
 * npm Public Registry adapter: read-only metadata (Slice P1-1).
 *
 * Source: https://registry.npmjs.org
 * Docs: https://github.com/npm/registry/blob/master/docs/REGISTRY_API.md
 * OpenAPI: https://api-docs.npmjs.com (downloadable)
 * Endpoints: GET /-/v1/search, GET /{package}, GET /{package}/{version}
 *
 * Public metadata/search readable without auth. Catalog presence is not
 * installation. Integrity from dist.integrity/shasum is discovery, not
 * verification. Registry signatures (if returned) are separate from publisher
 * identity. Tolerant schemas: only package name is required.
 */

export const NPM_SOURCE_ID = "npm-registry" as const;
export const NPM_BASE_URL = "https://registry.npmjs.org";

// Search response: { objects: [{ package: { name, scope, version, description, keywords, date, links, publisher, maintainers, author } }], total, time }
const npmSearchPackageSchema = z
  .object({
    name: z.string().min(1),
    scope: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    date: z.string().optional(),
    links: z.object({ npm: z.string().optional(), homepage: z.string().optional(), repository: z.string().optional(), bugs: z.string().optional() }).passthrough().optional(),
    publisher: z.object({ username: z.string().optional(), email: z.string().optional() }).passthrough().optional(),
    maintainers: z.array(z.object({ username: z.string().optional(), email: z.string().optional() }).passthrough()).optional(),
    author: z.unknown().optional(),
  })
  .passthrough();

const npmSearchObjectSchema = z
  .object({
    package: npmSearchPackageSchema,
    score: z.unknown().optional(),
    searchScore: z.number().optional(),
  })
  .passthrough();

const npmSearchResponseSchema = z
  .object({
    objects: z.array(npmSearchObjectSchema),
    total: z.number().optional(),
    time: z.string().optional(),
  })
  .passthrough();

// Package detail: { name, description, "dist-tags": {latest}, versions: { "1.0.0": { dist: { tarball, shasum, integrity } } }, time, maintainers, author, license, repository, homepage, readme }
const npmDistSchema = z
  .object({
    tarball: z.string().optional(),
    shasum: z.string().optional(),
    integrity: z.string().optional(),
    fileCount: z.number().optional(),
    unpackedSize: z.number().optional(),
    signatures: z.unknown().optional(),
  })
  .passthrough();

const npmVersionSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    license: z.string().optional(),
    dist: npmDistSchema.optional(),
    dependencies: z.record(z.string()).optional(),
    peerDependencies: z.record(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    author: z.unknown().optional(),
    maintainers: z.unknown().optional(),
  })
  .passthrough();

const npmPackageResponseSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    "dist-tags": z.record(z.string()).optional(),
    versions: z.record(npmVersionSchema).optional(),
    time: z.record(z.string()).optional(),
    maintainers: z.array(z.unknown()).optional(),
    author: z.unknown().optional(),
    license: z.string().optional(),
    repository: z.union([z.string(), z.object({ url: z.string().optional(), type: z.string().optional() }).passthrough()]).optional(),
    homepage: z.string().optional(),
    readme: z.string().optional(),
  })
  .passthrough();

export type NpmSearchRecord = z.infer<typeof npmSearchPackageSchema>;
export type NpmPackageRecord = z.infer<typeof npmPackageResponseSchema>;
export type NpmVersionRecord = z.infer<typeof npmVersionSchema>;

function errorMessage(context: string): string {
  return `npm Registry: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

export function parseNpmSearchResponse(rawText: string): { packages: NpmSearchRecord[]; total?: number } {
  const validation = npmSearchResponseSchema.safeParse(parseJson(rawText, "search"));
  if (!validation.success) throw new Error(errorMessage("search"));
  return { packages: validation.data.objects.map((o) => o.package), total: validation.data.total };
}

export function parseNpmPackageResponse(rawText: string): NpmPackageRecord {
  const validation = npmPackageResponseSchema.safeParse(parseJson(rawText, "package detail"));
  if (!validation.success) throw new Error(errorMessage("package detail"));
  return validation.data;
}

export function parseNpmVersionResponse(rawText: string): NpmVersionRecord {
  const validation = npmVersionSchema.safeParse(parseJson(rawText, "version detail"));
  if (!validation.success) throw new Error(errorMessage("version detail"));
  // version detail must have at least version or dist
  if (!validation.data.version && !validation.data.dist) throw new Error(errorMessage("version detail without version"));
  return validation.data;
}

// URL builders
export function buildNpmSearchUrl(base: string, params: { text: string; size?: number; from?: number }): string {
  const url = new URL("/-/v1/search", base);
  url.searchParams.set("text", params.text);
  if (params.size !== undefined) url.searchParams.set("size", String(params.size));
  if (params.from !== undefined) url.searchParams.set("from", String(params.from));
  return url.toString();
}

export function buildNpmPackageUrl(base: string, name: string): string {
  return new URL(`/${encodeURIComponent(name).replace(/%40/g, "@").replace(/%2F/g, "/")}`, base).toString();
  // npm scoped packages keep slash unencoded: @scope/name
}

export function buildNpmVersionUrl(base: string, name: string, version: string): string {
  const encodedName = encodeURIComponent(name).replace(/%40/g, "@").replace(/%2F/g, "/");
  return new URL(`/${encodedName}/${encodeURIComponent(version)}`, base).toString();
}

// Validation
export const NPM_PACKAGE_MAX = 214;
export const NPM_SEARCH_MAX = 200;
export const NPM_VERSION_MAX = 100;

export function validatedNpmPackageName(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > NPM_PACKAGE_MAX) throw new Error("npm Registry: package name must be 1-214 characters.");
  // allow @scope/name, plus . _ - ~ chars, per npm naming (simplified, no leading dot/_)
  if (!/^(?:@[^/]+\/)?[^/]+$/.test(name) || /[~*'!()]/.test(name)) {
    // be tolerant but reject traversal / control chars
    if (name.includes("..") || name.includes("//") || /[\0\r\n]/.test(name)) throw new Error("npm Registry: package name contains unsupported characters.");
  }
  if (name.includes("..")) throw new Error("npm Registry: package name contains unsupported characters.");
  return name;
}

export function validatedNpmVersion(version: string): string {
  if (typeof version !== "string" || version.length === 0 || version.length > NPM_VERSION_MAX) throw new Error("npm Registry: version must be 1-100 characters.");
  if (!/^[A-Za-z0-9._\-+]+$/.test(version)) throw new Error("npm Registry: version contains unsupported characters.");
  return version;
}

export function validatedNpmSearch(text: string, size?: number, from?: number): { text: string; size: number; from: number } {
  if (typeof text !== "string" || text.trim().length === 0 || text.length > NPM_SEARCH_MAX) throw new Error("npm Registry: search text must be 1-200 characters.");
  const resolvedSize = size ?? 20;
  const resolvedFrom = from ?? 0;
  if (!Number.isInteger(resolvedSize) || resolvedSize < 1 || resolvedSize > 50) throw new Error("npm Registry: size must be 1-50.");
  if (!Number.isInteger(resolvedFrom) || resolvedFrom < 0 || resolvedFrom > 100000) throw new Error("npm Registry: from must be 0-100000.");
  return { text: text.trim(), size: resolvedSize, from: resolvedFrom };
}

// Normalization
export interface NormalizedNpmPackage extends NormalizedRemoteItem {
  kind: "npm-package";
  sourceId: typeof NPM_SOURCE_ID;
  name: string;
  description: string;
  version?: string;
  latestVersion?: string;
  versions: string[];
  keywords: string[];
  publisher?: string;
  license: LicenseEvidence;
  repositoryUrl?: string;
  homepageUrl?: string;
  tarballUrl?: string;
  integrity: IntegrityEvidence;
  signature: SignatureEvidence;
}

function licenseFrom(record: NpmPackageRecord, versionRecord?: NpmVersionRecord): LicenseEvidence {
  const lic = (versionRecord?.license || record.license || "") as string;
  if (lic && lic.trim().length > 0) return { state: "CLASSIFIED", license: lic.slice(0, 200), source: "npm package metadata" };
  return unknownLicense("The npm record carries no license field; UNKNOWN is not open source.");
}

function integrityFrom(dist?: { shasum?: string; integrity?: string }): IntegrityEvidence {
  if (dist?.integrity && dist.integrity.trim().length > 0) {
    // npm integrity is often sha512-... base64; treat as EXPECTED
    return { state: "EXPECTED", expectedHash: dist.integrity.slice(0, 300), source: "npm dist integrity" };
  }
  if (dist?.shasum && /^[a-f0-9]{40}$/i.test(dist.shasum)) {
    return { state: "EXPECTED", expectedHash: dist.shasum.toLowerCase(), source: "npm dist shasum (sha1)" };
  }
  return missingIntegrity("No integrity field was supplied by the npm registry response.");
}

function signatureFrom(dist?: { signatures?: unknown }): SignatureEvidence {
  if (dist?.signatures && Array.isArray(dist.signatures) && dist.signatures.length > 0) {
    return { state: "NOT_AVAILABLE", source: "npm lists registry signatures; presence is not publisher verification." };
  }
  return unverifiedSignature("The npm response carries no signature evidence for this package.");
}

function repositoryUrlFrom(record: NpmPackageRecord): string | undefined {
  if (typeof record.repository === "string" && record.repository.length > 0) return record.repository.slice(0, 2000);
  if (record.repository && typeof record.repository === "object" && typeof (record.repository as { url?: unknown }).url === "string") {
    return ((record.repository as { url: string }).url || "").slice(0, 2000);
  }
  if (record.homepage && record.homepage.length > 0) return record.homepage.slice(0, 2000);
  return undefined;
}

export function normalizeNpmSearchRecord(
  pkg: NpmSearchRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
): NormalizedNpmPackage {
  const publisher = pkg.publisher?.username || (Array.isArray(pkg.maintainers) && pkg.maintainers[0]?.username) || undefined;
  const repoUrl = pkg.links?.repository || pkg.links?.homepage;
  return {
    kind: "npm-package",
    sourceId: NPM_SOURCE_ID,
    name: pkg.name,
    description: (pkg.description || "No description was supplied by the npm registry.").slice(0, 2000),
    version: pkg.version,
    latestVersion: pkg.version,
    versions: pkg.version ? [pkg.version] : [],
    keywords: (pkg.keywords ?? []).slice(0, 24),
    publisher: publisher?.slice(0, 200),
    repositoryUrl: repoUrl?.slice(0, 2000),
    homepageUrl: pkg.links?.homepage?.slice(0, 2000),
    license: unknownLicense("Search result carries no license; detail endpoint required."),
    integrity: missingIntegrity("Search response carries no dist integrity; detail endpoint required."),
    signature: unverifiedSignature("Search response carries no signature evidence."),
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Registry catalog metadata only; no install was attempted."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: NPM_SOURCE_ID,
      canonicalUrl: `https://www.npmjs.com/package/${encodeURIComponent(pkg.name)}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "npm Public Registry",
    },
    trustStage: "CATALOG_DISCOVERED",
  };
}

export function normalizeNpmPackage(
  record: NpmPackageRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
  selectedVersion?: string,
): NormalizedNpmPackage {
  const latest = record["dist-tags"]?.latest;
  const versionKey = selectedVersion || latest;
  const versionRecord = versionKey && record.versions?.[versionKey] ? record.versions[versionKey] : undefined;
  const versions = Object.keys(record.versions || {}).slice(0, 200);
  const dist = versionRecord?.dist;
  const repoUrl = repositoryUrlFrom(record);
  const publisher =
    (Array.isArray(record.maintainers) && typeof (record.maintainers[0] as { name?: unknown })?.name === "string" ? (record.maintainers[0] as { name: string }).name : undefined) ||
    undefined;
  return {
    kind: "npm-package",
    sourceId: NPM_SOURCE_ID,
    name: record.name,
    description: (versionRecord?.description || record.description || "No description was supplied by the npm registry.").slice(0, 2000),
    version: versionKey,
    latestVersion: latest,
    versions,
    keywords: (versionRecord?.keywords ?? []).slice(0, 24),
    publisher: publisher?.slice(0, 200),
    repositoryUrl: repoUrl,
    homepageUrl: record.homepage?.slice(0, 2000),
    tarballUrl: dist?.tarball?.slice(0, 2000),
    license: licenseFrom(record, versionRecord),
    integrity: integrityFrom(dist),
    signature: signatureFrom(dist as { signatures?: unknown }),
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Registry catalog metadata only; no install was attempted."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: NPM_SOURCE_ID,
      canonicalUrl: `https://www.npmjs.com/package/${encodeURIComponent(record.name)}${versionKey ? `/v/${encodeURIComponent(versionKey)}` : ""}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "npm Public Registry",
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

export function npmPackageToMarketplaceItem(normalized: NormalizedNpmPackage, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote catalog metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "npm Public Registry";
  return {
    id: `npm:${normalized.name}`,
    category: "plugins",
    taxonomy: ["integrations"],
    name: normalized.name,
    description: normalized.description,
    overview: normalized.description,
    features: ["npm-package", "remote-catalog", ...(normalized.keywords.slice(0, 4))],
    source: "npm Public Registry",
    sourceUrl: normalized.provenance.canonicalUrl,
    ...(normalized.version ? { version: normalized.version } : {}),
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["npm-package", ...normalized.versions.slice(0, 5)],
    requirements: ["Explicit user confirmation plus verified artifact before any install (existing lifecycle, not in read-only discovery)."],
    compatibility: "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the npm registry response." },
    publisher: normalized.publisher
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.publisher }
      : { state: "UNKNOWN", source: "No publisher evidence was supplied by the npm response." },
    repository: normalized.repositoryUrl
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.repositoryUrl }
      : { state: "UNKNOWN", source: "No repository evidence was supplied by the npm response." },
    releaseHistory:
      normalized.versions.length > 0
        ? { state: "UNKNOWN", source: `${evidenceSource} version map (catalog list, not verification).`, items: normalized.versions }
        : { state: "NOT_AVAILABLE", source: "Version history requires package detail.", items: [] },
    changelog: { state: "NOT_AVAILABLE", source: "No changelog is supplied by the npm registry response." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote npm catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is supplied by the search response; detail may include dependencies.", items: [] },
    provenance: {
      state: "UNKNOWN",
      source: `${evidenceSource}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.provenance.canonicalUrl,
    },
    integrity:
      normalized.integrity.state === "EXPECTED" && normalized.integrity.expectedHash
        ? { state: "UNKNOWN", source: normalized.integrity.source, value: `sha512:${normalized.integrity.expectedHash.slice(0, 100)}` }
        : { state: "NOT_AVAILABLE", source: "No integrity field was supplied by the npm response." },
    trust: "UNTRUSTED",
    installed: false,
    enabled: false,
    local: false,
    installAction: "NOT_AVAILABLE",
    dataState: "AVAILABLE",
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
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: no verified npm install adapter exists yet." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
  };
}
