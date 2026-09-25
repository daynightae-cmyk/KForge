import { z } from "zod";
import type { MarketplaceItem, MarketplacePermission } from "../../marketplaceCore";
import type { IntegrityEvidence, LicenseEvidence, NormalizedRemoteItem, SignatureEvidence } from "../contracts";
import { missingIntegrity, unknownLicense, unverifiedSignature } from "../contracts";

/**
 * PyPI adapter: read-only metadata (P1-2).
 *
 * Source: https://pypi.org
 * Docs: https://docs.pypi.org/api/
 * Endpoints: GET /pypi/{project}/json, GET /simple/{project}/
 *
 * Public read APIs anonymous. Catalog presence is not installation.
 * Integrity from package file digests (sha256) is discovery, not verification.
 */

export const PYPI_SOURCE_ID = "pypi" as const;
export const PYPI_BASE_URL = "https://pypi.org";

const pypiFileSchema = z
  .object({
    filename: z.string().optional(),
    url: z.string().optional(),
    digests: z.object({ sha256: z.string().optional(), md5: z.string().optional(), blake2b_256: z.string().optional() }).passthrough().optional(),
    size: z.number().optional(),
    requires_python: z.string().nullable().optional(),
    upload_time_iso_8601: z.string().optional(),
    yanked: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough();

const pypiInfoSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    author_email: z.string().optional(),
    license: z.string().optional(),
    home_page: z.string().optional(),
    project_urls: z.record(z.string()).nullable().optional(),
    requires_dist: z.array(z.string()).nullable().optional(),
    classifiers: z.array(z.string()).optional(),
    keywords: z.string().nullable().optional(),
  })
  .passthrough();

const pypiPackageSchema = z
  .object({
    info: pypiInfoSchema,
    releases: z.record(z.array(pypiFileSchema)).optional(),
    urls: z.array(pypiFileSchema).optional(),
    last_serial: z.number().optional(),
  })
  .passthrough();

export type PypiPackageRecord = z.infer<typeof pypiPackageSchema>;

function errorMessage(context: string): string {
  return `PyPI: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

export function parsePypiPackageResponse(rawText: string): PypiPackageRecord {
  const validation = pypiPackageSchema.safeParse(parseJson(rawText, "package detail"));
  if (!validation.success) throw new Error(errorMessage("package detail"));
  return validation.data;
}

export function buildPypiPackageUrl(base: string, name: string): string {
  return new URL(`/pypi/${encodeURIComponent(validatedPypiPackageName(name))}/json`, base).toString();
}

export function buildPypiSimpleUrl(base: string, name: string): string {
  return new URL(`/simple/${encodeURIComponent(validatedPypiPackageName(name))}/`, base).toString();
}

export const PYPI_NAME_MAX = 214;
export const PYPI_VERSION_MAX = 100;

export function validatedPypiPackageName(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > PYPI_NAME_MAX) throw new Error("PyPI: package name must be 1-214 characters.");
  // PyPI normalized name: [A-Za-z0-9._-]+, but allow case preservation
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("PyPI: package name contains unsupported characters.");
  if (name.includes("..")) throw new Error("PyPI: package name contains unsupported characters.");
  return name;
}

export function validatedPypiVersion(version: string): string {
  if (typeof version !== "string" || version.length === 0 || version.length > PYPI_VERSION_MAX) throw new Error("PyPI: version must be 1-100 characters.");
  if (!/^[A-Za-z0-9._\-+!]+$/.test(version)) throw new Error("PyPI: version contains unsupported characters.");
  return version;
}

export interface NormalizedPypiPackage extends NormalizedRemoteItem {
  kind: "pypi-package";
  sourceId: typeof PYPI_SOURCE_ID;
  name: string;
  description: string;
  version?: string;
  latestVersion?: string;
  versions: string[];
  keywords: string[];
  author?: string;
  license: LicenseEvidence;
  repositoryUrl?: string;
  homepageUrl?: string;
  fileUrl?: string;
  integrity: IntegrityEvidence;
  signature: SignatureEvidence;
}

function licenseFrom(info: PypiPackageRecord["info"]): LicenseEvidence {
  const lic = (info.license || "") as string;
  if (lic && lic.trim().length > 0 && lic.trim().toLowerCase() !== "unknown") return { state: "CLASSIFIED", license: lic.slice(0, 200), source: "PyPI package metadata" };
  // Try classifiers for License :: OSI Approved
  const licenseClassifier = info.classifiers?.find((c) => c.startsWith("License :: OSI Approved"));
  if (licenseClassifier) return { state: "CLASSIFIED", license: licenseClassifier.split("::").pop()?.trim().slice(0, 200) || licenseClassifier.slice(0, 200), source: "PyPI classifiers" };
  return unknownLicense("The PyPI record carries no license field; UNKNOWN is not open source.");
}

function integrityFrom(files?: { digests?: { sha256?: string } }[]): IntegrityEvidence {
  const file = files?.[0];
  const sha256 = file?.digests?.sha256;
  if (sha256 && /^[a-f0-9]{64}$/i.test(sha256)) {
    return { state: "EXPECTED", algorithm: "sha256", expectedHash: sha256.toLowerCase(), source: "PyPI file digests sha256" };
  }
  return missingIntegrity("No sha256 digest was supplied by the PyPI response.");
}

function repositoryUrlFrom(info: PypiPackageRecord["info"]): string | undefined {
  const urls = info.project_urls;
  if (urls && typeof urls === "object") {
    const candidates = ["Repository", "Source", "Homepage", "Home-page", "Code", "GitHub"];
    for (const key of candidates) {
      if (typeof urls[key] === "string" && urls[key].length > 0) return urls[key].slice(0, 2000);
      // case-insensitive fallback
      const foundKey = Object.keys(urls).find((k) => k.toLowerCase() === key.toLowerCase());
      if (foundKey && typeof urls[foundKey] === "string") return urls[foundKey].slice(0, 2000);
    }
    const first = Object.values(urls).find((v) => typeof v === "string" && v.startsWith("http"));
    if (first) return (first as string).slice(0, 2000);
  }
  if (info.home_page && info.home_page.length > 0) return info.home_page.slice(0, 2000);
  return undefined;
}

export function normalizePypiPackage(
  record: PypiPackageRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
  selectedVersion?: string,
): NormalizedPypiPackage {
  const latest = record.info.version;
  const versionKey = selectedVersion || latest;
  const versions = Object.keys(record.releases || {}).slice(0, 200);
  const files = versionKey && record.releases?.[versionKey] ? record.releases[versionKey] : record.urls || [];
  const file = files?.[0];
  const repoUrl = repositoryUrlFrom(record.info);
  const keywords = (record.info.keywords ? record.info.keywords.split(/[,\s]+/).filter(Boolean) : []).slice(0, 24);
  return {
    kind: "pypi-package",
    sourceId: PYPI_SOURCE_ID,
    name: record.info.name,
    description: (record.info.summary || record.info.description?.slice(0, 2000) || "No description was supplied by the PyPI registry.").slice(0, 2000),
    version: versionKey,
    latestVersion: latest,
    versions,
    keywords,
    author: record.info.author?.slice(0, 200),
    repositoryUrl: repoUrl,
    homepageUrl: record.info.home_page?.slice(0, 2000),
    fileUrl: file?.url?.slice(0, 2000),
    license: licenseFrom(record.info),
    integrity: integrityFrom(files),
    signature: unverifiedSignature("The PyPI JSON response carries no signature evidence; use Integrity API for Trusted Publisher attestations."),
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Registry catalog metadata only; no install was attempted."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: PYPI_SOURCE_ID,
      canonicalUrl: `https://pypi.org/project/${encodeURIComponent(record.info.name)}/${versionKey ? `${encodeURIComponent(versionKey)}/` : ""}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "Python Package Index",
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

export function pypiPackageToMarketplaceItem(normalized: NormalizedPypiPackage, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote catalog metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "Python Package Index";
  return {
    id: `pypi:${normalized.name}`,
    category: "plugins",
    taxonomy: ["integrations"],
    name: normalized.name,
    description: normalized.description,
    overview: normalized.description,
    features: ["pypi-package", "remote-catalog", ...(normalized.keywords.slice(0, 4))],
    source: "Python Package Index",
    sourceUrl: normalized.provenance.canonicalUrl,
    ...(normalized.version ? { version: normalized.version } : {}),
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["pypi-package", ...normalized.versions.slice(0, 5)],
    requirements: ["Explicit user confirmation plus verified artifact before any install (existing lifecycle, not in read-only discovery)."],
    compatibility: "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the PyPI response." },
    publisher: normalized.author
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.author }
      : { state: "UNKNOWN", source: "No author evidence was supplied by the PyPI response." },
    repository: normalized.repositoryUrl
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.repositoryUrl }
      : { state: "UNKNOWN", source: "No repository evidence was supplied by the PyPI response." },
    releaseHistory:
      normalized.versions.length > 0
        ? { state: "UNKNOWN", source: `${evidenceSource} releases map (catalog list, not verification).`, items: normalized.versions }
        : { state: "NOT_AVAILABLE", source: "Version history requires package detail.", items: [] },
    changelog: { state: "NOT_AVAILABLE", source: "No changelog is supplied by the PyPI response." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote PyPI catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is normalized from PyPI catalog response.", items: [] },
    provenance: {
      state: "UNKNOWN",
      source: `${evidenceSource}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.provenance.canonicalUrl,
    },
    integrity:
      normalized.integrity.state === "EXPECTED" && normalized.integrity.expectedHash
        ? { state: "UNKNOWN", source: normalized.integrity.source, value: `sha256:${normalized.integrity.expectedHash.slice(0, 64)}` }
        : { state: "NOT_AVAILABLE", source: "No sha256 digest was supplied by the PyPI response." },
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
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: no verified PyPI install adapter exists yet." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Install requires a future verified adapter plus explicit confirmation.",
  };
}
