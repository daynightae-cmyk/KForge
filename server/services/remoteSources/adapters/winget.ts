import { z } from "zod";
import type { MarketplaceItem, MarketplacePermission } from "../../marketplaceCore";
import type { IntegrityEvidence, LicenseEvidence, NormalizedRemoteItem, SignatureEvidence } from "../contracts";
import { missingIntegrity, unknownLicense, unverifiedSignature } from "../contracts";

/**
 * Windows Package Manager Community Repository adapter (P1-4).
 *
 * Source: https://github.com/microsoft/winget-pkgs
 * Docs: https://github.com/microsoft/winget-pkgs/blob/master/doc/manifest/schema/1.12.0/README.md
 * Search via the unauthenticated GitHub Contents API, detail via the raw installer manifest YAML.
 * Tolerant schemas: only PackageIdentifier is required.
 */

export const WINGET_SOURCE_ID = "winget-community" as const;
export const WINGET_GITHUB_SEARCH_BASE = "https://api.github.com/repos/microsoft/winget-pkgs/contents";
export const WINGET_RAW_BASE = "https://raw.githubusercontent.com/microsoft/winget-pkgs/master";

const wingetSearchItemSchema = z
  .object({
    name: z.string().optional(),
    path: z.string().optional(),
    sha: z.string().optional(),
    type: z.string().optional(),
    repository: z.object({ full_name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const wingetLegacySearchResponseSchema = z
  .object({
    total_count: z.number().optional(),
    items: z.array(wingetSearchItemSchema),
  })
  .passthrough();

const wingetContentsResponseSchema = z.array(wingetSearchItemSchema);

export type WingetSearchRecord = z.infer<typeof wingetSearchItemSchema>;

function errorMessage(context: string): string {
  return `WinGet: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

export function parseWingetSearchResponse(rawText: string): { packages: WingetSearchRecord[]; totalCount?: number } {
  const parsed = parseJson(rawText, "search");
  const contents = wingetContentsResponseSchema.safeParse(parsed);
  if (contents.success) {
    const packages = contents.data.filter(\n      (item) => item.type === "dir" && /^\\d+(?:\\.\\d+)+/.test(item.name ?? ""),\n    );
    return { packages, totalCount: packages.length };
  }
  const legacy = wingetLegacySearchResponseSchema.safeParse(parsed);
  if (!legacy.success) throw new Error(errorMessage("search"));
  return { packages: legacy.data.items, totalCount: legacy.data.total_count };
}

// Minimal YAML field extraction for manifest (no yaml library)
export interface WingetManifestFields {
  packageIdentifier: string;
  packageVersion?: string;
  publisher?: string;
  packageName?: string;
  shortDescription?: string;
  license?: string;
  homepage?: string;
  installers: Array<{ architecture?: string; installerType?: string; installerUrl?: string; installerSha256?: string; scope?: string }>;
}

export function parseWingetManifestYaml(text: string): WingetManifestFields {
  const lines = text.split(/\r?\n/);
  let packageIdentifier = "";
  let packageVersion: string | undefined;
  let publisher: string | undefined;
  let packageName: string | undefined;
  let shortDescription: string | undefined;
  let license: string | undefined;
  let homepage: string | undefined;
  const installers: WingetManifestFields["installers"] = [];
  let currentInstaller: Record<string, string> | null = null;
  let inInstallers = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("PackageIdentifier:")) packageIdentifier = trimmed.slice("PackageIdentifier:".length).trim();
    else if (trimmed.startsWith("PackageVersion:")) packageVersion = trimmed.slice("PackageVersion:".length).trim();
    else if (trimmed.startsWith("Publisher:")) publisher = trimmed.slice("Publisher:".length).trim();
    else if (trimmed.startsWith("PackageName:")) packageName = trimmed.slice("PackageName:".length).trim();
    else if (trimmed.startsWith("ShortDescription:")) shortDescription = trimmed.slice("ShortDescription:".length).trim();
    else if (trimmed.startsWith("License:")) license = trimmed.slice("License:".length).trim();
    else if (trimmed.startsWith("PackageUrl:") || trimmed.startsWith("Homepage:")) homepage = trimmed.split(":").slice(1).join(":").trim();
    else if (trimmed === "Installers:") inInstallers = true;
    else if (inInstallers && trimmed.startsWith("- ")) {
      if (currentInstaller) installers.push(currentInstaller as WingetManifestFields["installers"][number]);
      currentInstaller = {};
      const rest = trimmed.slice(2).trim();
      if (rest.includes(":")) {
        const [k, ...v] = rest.split(":");
        if (k && v.length) {
          const key = k.trim().toLowerCase();
          const normalizedKey =
            key === "architectures" ? "architecture" : key === "installertype" ? "installerType" : key === "installerurl" ? "installerUrl" : key === "installersha256" ? "installerSha256" : key === "scope" ? "scope" : key;
          currentInstaller[normalizedKey] = v.join(":").trim();
        }
      }
    } else if (inInstallers && currentInstaller && trimmed.includes(":")) {
      const [k, ...v] = trimmed.split(":");
      if (k && v.length) {
        const key = k.trim().toLowerCase();
        const normalizedKey =
          key === "architecture" ? "architecture" : key === "installertype" ? "installerType" : key === "installerurl" ? "installerUrl" : key === "installersha256" ? "installerSha256" : key === "scope" ? "scope" : key;
        currentInstaller[normalizedKey] = v.join(":").trim();
      }
    } else if (trimmed === "" && inInstallers) {
      // keep
    }
  }
  if (currentInstaller) installers.push(currentInstaller as WingetManifestFields["installers"][number]);
  if (!packageIdentifier) throw new Error(errorMessage("manifest without PackageIdentifier"));
  return {
    packageIdentifier,
    ...(packageVersion ? { packageVersion } : {}),
    ...(publisher ? { publisher } : {}),
    ...(packageName ? { packageName } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    ...(license ? { license } : {}),
    ...(homepage ? { homepage } : {}),
    installers: installers.slice(0, 10),
  };
}

function wingetPackagePath(packageId: string): string {
  const validated = validatedWingetPackageId(packageId);
  const segments = validated.split(".").map((segment) => encodeURIComponent(segment));
  return `manifests/${validated[0].toLowerCase()}/${segments.join("/")}`;
}

export function buildWingetSearchUrl(base: string, q: string): string {
  return `${base.replace(/\/$/, "")}/${wingetPackagePath(q)}`;
}

export function buildWingetManifestUrl(packageId: string, version: string): string {
  const validated = validatedWingetPackageId(packageId);
  return `${WINGET_RAW_BASE}/${wingetPackagePath(validated)}/${encodeURIComponent(version)}/${encodeURIComponent(validated)}.installer.yaml`;
}

export function buildWingetManifestListingUrl(packageId: string, version: string): string {
  return `${WINGET_GITHUB_SEARCH_BASE}/${wingetPackagePath(packageId)}/${encodeURIComponent(version)}`;
}

export const WINGET_PACKAGE_MAX = 128;
export const WINGET_SEARCH_MAX = 100;

export function validatedWingetPackageId(id: string): string {
  if (typeof id !== "string" || id.length === 0 || id.length > WINGET_PACKAGE_MAX) throw new Error("WinGet: package id must be 1-128 characters.");
  const parts = id.split(".");
  if (parts.length < 2) throw new Error("WinGet: package id must be a dotted identifier (e.g., Git.Git).");
  for (const part of parts) {
    if (part.length === 0 || part.length > 64) throw new Error("WinGet: package id contains unsupported characters.");
    if (!/^[A-Za-z0-9._-]+$/.test(part)) throw new Error("WinGet: package id contains unsupported characters.");
    if (part.startsWith("-") || part.endsWith("-") || part.startsWith("_") || part.endsWith("_")) {
      // allow but not strict
    }
  }
  if (id.includes("..")) throw new Error("WinGet: package id contains unsupported characters.");
  return id;
}

export function validatedWingetSearch(q: string): string {
  if (typeof q !== "string" || q.trim().length === 0 || q.length > WINGET_SEARCH_MAX) throw new Error("WinGet: search query must be 1-100 characters.");
  const trimmed = q.trim();
  validatedWingetPackageId(trimmed);
  return trimmed;
}

export interface NormalizedWingetPackage extends NormalizedRemoteItem {
  kind: "winget-package";
  sourceId: typeof WINGET_SOURCE_ID;
  packageId: string;
  packageVersion?: string;
  description: string;
  publisher?: string;
  homepage?: string;
  license: LicenseEvidence;
  integrity: IntegrityEvidence;
  signature: SignatureEvidence;
  installers: WingetManifestFields["installers"];
}

function licenseFrom(manifest: WingetManifestFields): LicenseEvidence {
  if (manifest.license && manifest.license.trim().length > 0) return { state: "CLASSIFIED", license: manifest.license.slice(0, 200), source: "WinGet manifest License field" };
  return unknownLicense("The WinGet manifest carries no license field; UNKNOWN is not open source.");
}

function integrityFrom(manifest: WingetManifestFields): IntegrityEvidence {
  const first = manifest.installers[0];
  if (first?.installerSha256 && /^[a-f0-9]{64}$/i.test(first.installerSha256)) {
    return { state: "EXPECTED", algorithm: "sha256", expectedHash: first.installerSha256.toLowerCase(), source: "WinGet manifest InstallerSha256" };
  }
  return missingIntegrity("No InstallerSha256 was supplied by the WinGet manifest.");
}

export function normalizeWingetManifest(
  manifest: WingetManifestFields,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
): NormalizedWingetPackage {
  return {
    kind: "winget-package",
    sourceId: WINGET_SOURCE_ID,
    packageId: manifest.packageIdentifier,
    packageVersion: manifest.packageVersion,
    description: (manifest.shortDescription || manifest.packageName || "No description was supplied by the WinGet manifest.").slice(0, 2000),
    publisher: manifest.publisher,
    homepage: manifest.homepage,
    license: licenseFrom(manifest),
    integrity: integrityFrom(manifest),
    signature: unverifiedSignature("WinGet community manifest presence is not publisher authenticity; use official publisher source."),
    installers: manifest.installers,
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Registry catalog metadata only; no install was attempted."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: WINGET_SOURCE_ID,
      canonicalUrl: `https://github.com/microsoft/winget-pkgs/tree/master/${wingetPackagePath(manifest.packageIdentifier)}/${manifest.packageVersion ? encodeURIComponent(manifest.packageVersion) : ""}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "Windows Package Manager Community Repository",
    },
    trustStage: "CATALOG_DISCOVERED",
  };
}

export function normalizeWingetSearchRecord(
  record: WingetSearchRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
): NormalizedWingetPackage {
  // Contents API search returns version directories below the exact package path.
  // Legacy cached code-search records ending in YAML remain readable.
  const path = record.path || "";
  const parts = path.split("/").filter(Boolean);
  const manifestIndex = parts.indexOf("manifests");
  const relative = manifestIndex >= 0 ? parts.slice(manifestIndex + 2) : [];
  const yamlRecord = relative[relative.length - 1]?.toLowerCase().endsWith(".yaml") ?? false;
  const version = relative.length >= (yamlRecord ? 3 : 2) ? relative[relative.length - (yamlRecord ? 2 : 1)] : undefined;
  const packageSegments = version ? relative.slice(0, -(yamlRecord ? 2 : 1)) : relative;
  const packageId = packageSegments.length >= 2 ? packageSegments.map((segment) => decodeURIComponent(segment)).join(".") : record.name || "unknown";
  return {
    kind: "winget-package",
    sourceId: WINGET_SOURCE_ID,
    packageId,
    packageVersion: version,
    description: "WinGet package discovered via community repository search.",
    license: unknownLicense("Search record carries no license; detail manifest required."),
    integrity: missingIntegrity("Search record carries no InstallerSha256; detail manifest required."),
    signature: unverifiedSignature("Search record carries no signature evidence."),
    installers: [],
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: { state: "NOT_AVAILABLE", sources: ["Search result only; no manifest detail was fetched."] },
    freshness: { state: freshness, at: retrievedAt },
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: WINGET_SOURCE_ID,
      canonicalUrl: `https://github.com/microsoft/winget-pkgs/blob/master/${path}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "Windows Package Manager Community Repository",
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

export function wingetPackageToMarketplaceItem(normalized: NormalizedWingetPackage, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote catalog metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "Windows Package Manager Community Repository";
  return {
    id: `winget:${normalized.packageId}${normalized.packageVersion ? `@${normalized.packageVersion}` : ""}`,
    category: "plugins",
    taxonomy: ["integrations"],
    name: normalized.packageId,
    description: normalized.description,
    overview: normalized.description,
    features: ["winget-package", "remote-catalog", ...(normalized.installers[0]?.architecture ? [normalized.installers[0].architecture] : [])],
    source: "Windows Package Manager Community Repository",
    sourceUrl: normalized.provenance.canonicalUrl,
    ...(normalized.packageVersion ? { version: normalized.packageVersion } : {}),
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["winget-package", ...normalized.installers.map((i) => i.installerType || "installer").slice(0, 3)],
    requirements: ["Community manifest presence is not publisher authenticity; verify official publisher source before install."],
    compatibility: normalized.installers[0]?.architecture || "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the WinGet manifest." },
    publisher: normalized.publisher
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.publisher }
      : { state: "UNKNOWN", source: "No publisher evidence was supplied by the WinGet manifest." },
    repository: normalized.homepage
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.homepage }
      : { state: "UNKNOWN", source: "No repository evidence was supplied by the WinGet manifest." },
    releaseHistory: { state: "NOT_AVAILABLE", source: "WinGet versions require manifest directory listing; use detail endpoint.", items: [] },
    changelog: { state: "NOT_AVAILABLE", source: "No changelog is supplied by the WinGet manifest." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote WinGet catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is supplied by the WinGet manifest.", items: [] },
    provenance: {
      state: "UNKNOWN",
      source: `${evidenceSource}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.provenance.canonicalUrl,
    },
    integrity:
      normalized.integrity.state === "EXPECTED" && normalized.integrity.expectedHash
        ? { state: "UNKNOWN", source: normalized.integrity.source, value: `sha256:${normalized.integrity.expectedHash}` }
        : { state: "NOT_AVAILABLE", source: "No InstallerSha256 was supplied by the WinGet manifest." },
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
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: use official publisher source or WinGet with verified hash; community manifest is not publisher authenticity." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Install requires verified publisher source plus hash verification.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Install requires verified publisher source plus hash verification.",
  };
}
