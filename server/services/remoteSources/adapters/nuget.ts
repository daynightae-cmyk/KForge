import { z } from "zod";
import type { MarketplaceItem, MarketplacePermission } from "../../marketplaceCore";
import type { IntegrityEvidence, LicenseEvidence, NormalizedRemoteItem, SignatureEvidence } from "../contracts";
import { missingIntegrity, unknownLicense, unverifiedSignature } from "../contracts";

/**
 * NuGet V3 adapter: read-only metadata (P1-3).
 *
 * Source: https://api.nuget.org/v3/index.json (Service Index)
 * Docs: https://learn.microsoft.com/en-us/nuget/api/overview
 * Search: https://azuresearch-usnc.nuget.org/query (via service index)
 * Registrations: https://api.nuget.org/v3/registration5-gz-semver2/{id}/index.json
 *
 * Public nuget.org reads. Catalog presence is not installation.
 * Tolerant schemas: only id is required.
 */

export const NUGET_SOURCE_ID = "nuget-v3" as const;
export const NUGET_BASE_URL = "https://api.nuget.org/v3/index.json";
export const NUGET_SEARCH_BASE_URL = "https://azuresearch-usnc.nuget.org/query";
export const NUGET_REGISTRATION_BASE_URL = "https://api.nuget.org/v3/registration5-gz-semver2";

const nugetSearchDataSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    authors: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    totalDownloads: z.number().optional(),
    verified: z.boolean().optional(),
    projectUrl: z.string().optional(),
    licenseUrl: z.string().optional(),
  })
  .passthrough();

const nugetSearchResponseSchema = z
  .object({
    totalHits: z.number().optional(),
    data: z.array(nugetSearchDataSchema),
  })
  .passthrough();

const nugetCatalogEntrySchema = z
  .object({
    id: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    authors: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    licenseUrl: z.string().optional(),
    projectUrl: z.string().optional(),
    listed: z.boolean().optional(),
  })
  .passthrough();

const nugetRegistrationItemSchema = z
  .object({
    catalogEntry: nugetCatalogEntrySchema.optional(),
    packageContent: z.string().optional(),
  })
  .passthrough();

const nugetRegistrationPageSchema = z
  .object({
    items: z.array(nugetRegistrationItemSchema).optional(),
  })
  .passthrough();

const nugetRegistrationResponseSchema = z
  .object({
    count: z.number().optional(),
    items: z.array(nugetRegistrationPageSchema).optional(),
  })
  .passthrough();

export type NugetSearchRecord = z.infer<typeof nugetSearchDataSchema>;
export type NugetCatalogEntry = z.infer<typeof nugetCatalogEntrySchema>;

function errorMessage(context: string): string {
  return `NuGet Registry: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

export function parseNugetSearchResponse(rawText: string): { packages: NugetSearchRecord[]; totalHits?: number } {
  const validation = nugetSearchResponseSchema.safeParse(parseJson(rawText, "search"));
  if (!validation.success) throw new Error(errorMessage("search"));
  return { packages: validation.data.data, totalHits: validation.data.totalHits };
}

export function parseNugetRegistrationResponse(rawText: string): NugetCatalogEntry[] {
  const parsed = parseJson(rawText, "registration");
  const validation = nugetRegistrationResponseSchema.safeParse(parsed);
  if (!validation.success) throw new Error(errorMessage("registration"));
  // Flatten pages -> items -> catalogEntry
  const entries: NugetCatalogEntry[] = [];
  for (const page of validation.data.items || []) {
    for (const item of page.items || []) {
      if (item.catalogEntry) entries.push(item.catalogEntry);
    }
  }
  // If no entries but top-level is single version (rare), handle fallback
  if (entries.length === 0 && (parsed as { catalogEntry?: unknown })?.catalogEntry) {
    const single = nugetCatalogEntrySchema.safeParse((parsed as { catalogEntry: unknown }).catalogEntry);
    if (single.success) entries.push(single.data);
  }
  return entries;
}

export function buildNugetSearchUrl(base: string, params: { q: string; skip?: number; take?: number }): string {
  const url = new URL(base);
  url.searchParams.set("q", params.q);
  if (params.skip !== undefined) url.searchParams.set("skip", String(params.skip));
  if (params.take !== undefined) url.searchParams.set("take", String(params.take));
  return url.toString();
}

export function buildNugetRegistrationUrl(base: string, id: string): string {
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(validatedNugetPackageId(id).toLowerCase())}/index.json`;
}

export const NUGET_ID_MAX = 128;
export const NUGET_SEARCH_MAX = 200;

export function validatedNugetPackageId(id: string): string {
  if (typeof id !== "string" || id.length === 0 || id.length > NUGET_ID_MAX) throw new Error("NuGet Registry: package id must be 1-128 characters.");
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("NuGet Registry: package id contains unsupported characters.");
  if (id.includes("..")) throw new Error("NuGet Registry: package id contains unsupported characters.");
  return id;
}

export function validatedNugetSearch(q: string, skip?: number, take?: number): { q: string; skip: number; take: number } {
  if (typeof q !== "string" || q.trim().length === 0 || q.length > NUGET_SEARCH_MAX) throw new Error("NuGet Registry: search query must be 1-200 characters.");
  const resolvedSkip = skip ?? 0;
  const resolvedTake = take ?? 20;
  if (!Number.isInteger(resolvedSkip) || resolvedSkip < 0 || resolvedSkip > 100000) throw new Error("NuGet Registry: skip must be 0-100000.");
  if (!Number.isInteger(resolvedTake) || resolvedTake < 1 || resolvedTake > 50) throw new Error("NuGet Registry: take must be 1-50.");
  return { q: q.trim(), skip: resolvedSkip, take: resolvedTake };
}

export interface NormalizedNugetPackage extends NormalizedRemoteItem {
  kind: "nuget-package";
  sourceId: typeof NUGET_SOURCE_ID;
  id: string;
  description: string;
  version?: string;
  versions: string[];
  tags: string[];
  authors: string[];
  licenseUrl?: string;
  projectUrl?: string;
  verified: boolean;
}

function tagsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").slice(0, 24);
  if (typeof value === "string") return value.split(/[\s,;]+/).filter(Boolean).slice(0, 24);
  return [];
}

function authorsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").slice(0, 8);
  if (typeof value === "string") return value.split(/,\s*/).filter(Boolean).slice(0, 8);
  return [];
}

function licenseFrom(entry: NugetCatalogEntry | NugetSearchRecord): LicenseEvidence {
  // NuGet catalog often has licenseUrl but not SPDX; treat as classified if URL present
  const url = (entry as { licenseUrl?: string }).licenseUrl;
  if (url && url.length > 0) return { state: "CLASSIFIED", license: url.slice(0, 200), source: "NuGet package metadata (licenseUrl)" };
  return unknownLicense("The NuGet record carries no licenseUrl; UNKNOWN is not open source.");
}

export function normalizeNugetSearchRecord(
  pkg: NugetSearchRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
): NormalizedNugetPackage {
  return {
    kind: "nuget-package",
    sourceId: NUGET_SOURCE_ID,
    id: pkg.id,
    description: (pkg.description || "No description was supplied by the NuGet registry.").slice(0, 2000),
    version: pkg.version,
    versions: pkg.version ? [pkg.version] : [],
    tags: tagsFrom(pkg.tags),
    authors: authorsFrom(pkg.authors),
    licenseUrl: pkg.licenseUrl?.slice(0, 2000),
    projectUrl: pkg.projectUrl?.slice(0, 2000),
    verified: pkg.verified === true,
    license: licenseFrom(pkg),
    integrity: missingIntegrity("Search response carries no dist integrity; use registration/file metadata when available."),
    signature: unverifiedSignature("Search response carries no signature evidence."),
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Registry catalog metadata only; no install was attempted."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: NUGET_SOURCE_ID,
      canonicalUrl: `https://www.nuget.org/packages/${encodeURIComponent(pkg.id)}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "nuget.org",
    },
    trustStage: "CATALOG_DISCOVERED",
  };
}

export function normalizeNugetCatalogEntry(
  entry: NugetCatalogEntry,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
  allVersions?: string[],
): NormalizedNugetPackage {
  const id = entry.id || "unknown";
  return {
    kind: "nuget-package",
    sourceId: NUGET_SOURCE_ID,
    id,
    description: (entry.description || "No description was supplied by the NuGet registry.").slice(0, 2000),
    version: entry.version,
    versions: allVersions || (entry.version ? [entry.version] : []),
    tags: tagsFrom(entry.tags),
    authors: authorsFrom(entry.authors),
    licenseUrl: entry.licenseUrl?.slice(0, 2000),
    projectUrl: entry.projectUrl?.slice(0, 2000),
    verified: false,
    license: licenseFrom(entry),
    integrity: missingIntegrity("No dist integrity in catalog entry; use PackageBaseAddress for artifact hashes when available."),
    signature: unverifiedSignature("Catalog entry carries no signature evidence."),
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Registry catalog metadata only; no install was attempted."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: NUGET_SOURCE_ID,
      canonicalUrl: `https://www.nuget.org/packages/${encodeURIComponent(id)}${entry.version ? `/${encodeURIComponent(entry.version)}` : ""}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "nuget.org",
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

export function nugetPackageToMarketplaceItem(normalized: NormalizedNugetPackage, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote catalog metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "nuget.org";
  return {
    id: `nuget:${normalized.id}`,
    category: "plugins",
    taxonomy: ["integrations"],
    name: normalized.id,
    description: normalized.description,
    overview: normalized.description,
    features: ["nuget-package", "remote-catalog", ...(normalized.tags.slice(0, 4))],
    source: "nuget.org",
    sourceUrl: normalized.provenance.canonicalUrl,
    ...(normalized.version ? { version: normalized.version } : {}),
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["nuget-package", ...normalized.versions.slice(0, 5)],
    requirements: ["Explicit user confirmation plus verified artifact before any install (existing lifecycle, not in read-only discovery)."],
    compatibility: "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the NuGet response." },
    publisher: normalized.authors[0]
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.authors[0] }
      : { state: "UNKNOWN", source: "No author evidence was supplied by the NuGet response." },
    repository: normalized.projectUrl
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.projectUrl }
      : { state: "UNKNOWN", source: "No repository evidence was supplied by the NuGet response." },
    releaseHistory:
      normalized.versions.length > 0
        ? { state: "UNKNOWN", source: `${evidenceSource} versions (catalog list, not verification).`, items: normalized.versions }
        : { state: "NOT_AVAILABLE", source: "Version history requires registration detail.", items: [] },
    changelog: { state: "NOT_AVAILABLE", source: "No changelog is supplied by the NuGet response." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote nuget catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is normalized from NuGet catalog response.", items: [] },
    provenance: {
      state: "UNKNOWN",
      source: `${evidenceSource}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.provenance.canonicalUrl,
    },
    integrity: { state: "NOT_AVAILABLE", source: "No dist integrity was supplied by the NuGet response." },
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
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: no verified NuGet install adapter exists yet." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
  };
}
