import { z } from "zod";

/**
 * KForge GitHub Releases adapter: read-only update discovery (Slice 5, P0).
 *
 * Source: https://api.github.com/repos/daynightae-cmyk/KForge
 * Docs: https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10
 * New code pins X-GitHub-Api-Version: 2026-03-10. Published public releases
 * are readable anonymously; drafts require authorized access and are
 * excluded from anonymous discovery.
 *
 * A release record is UPDATE-CATALOG evidence only, never
 * trusted-installer evidence. UPDATE_AVAILABLE does NOT mean
 * TRUSTED_UPDATE: a trusted update additionally requires tag/commit
 * evidence, the expected Windows x64 NSIS artifact, an expected SHA-256
 * sidecar, download verification, and signature evidence under the existing
 * Windows release trust gates. Per docs/SIGNING.md the current artifacts
 * are explicitly UNSIGNED, so trusted install stays BLOCKED with stated
 * reasons. No silent auto-update or auto-install exists in this slice.
 */

export const KFORGE_UPDATES_SOURCE_ID = "github-releases-kforge" as const;
export const KFORGE_UPDATES_API_BASE = "https://api.github.com/repos/daynightae-cmyk/KForge";
export const KFORGE_GITHUB_API_VERSION = "2026-03-10";

const releaseAssetSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().nullable().optional(),
    size: z.number().optional(),
    browser_download_url: z.string().optional(),
    digest: z.string().nullable().optional(),
    content_type: z.string().optional(),
  })
  .passthrough();

const releaseSchema = z
  .object({
    tag_name: z.string().min(1),
    name: z.string().nullable().optional(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
    created_at: z.string().optional(),
    published_at: z.string().nullable().optional(),
    target_commitish: z.string().optional(),
    body: z.string().nullable().optional(),
    assets: z.array(releaseAssetSchema).optional(),
  })
  .passthrough();

const releaseListSchema = z.array(releaseSchema);

export type KforgeReleaseRecord = z.infer<typeof releaseSchema>;

function errorMessage(context: string): string {
  return `KForge Updates: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

/** Validate a release-list response. */
export function parseKforgeReleasesResponse(rawText: string): KforgeReleaseRecord[] {
  const validation = releaseListSchema.safeParse(parseJson(rawText, "release list"));
  if (!validation.success) throw new Error(errorMessage("release list"));
  return validation.data;
}

/** Validate a single-release response (by tag). */
export function parseKforgeReleaseResponse(rawText: string): KforgeReleaseRecord {
  const validation = releaseSchema.safeParse(parseJson(rawText, "release detail"));
  if (!validation.success) throw new Error(errorMessage("release detail"));
  return validation.data;
}

export function buildKforgeReleasesUrl(base: string, params: { perPage?: number; page?: number }): string {
  const url = new URL("/repos/daynightae-cmyk/KForge/releases", base);
  if (params.perPage !== undefined) url.searchParams.set("per_page", String(params.perPage));
  if (params.page !== undefined) url.searchParams.set("page", String(params.page));
  return url.toString();
}

export function buildKforgeReleaseTagUrl(base: string, tag: string): string {
  return new URL(`/repos/daynightae-cmyk/KForge/releases/tags/${encodeURIComponent(validatedReleaseTag(tag))}`, base).toString();
}

export const RELEASE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-+/]{0,127}$/;

export function validatedReleaseTag(tag: string): string {
  if (!RELEASE_TAG_PATTERN.test(tag) || tag.includes("..")) {
    throw new Error("KForge Updates: release tag contains unsupported characters.");
  }
  return tag;
}

export interface ParsedReleaseVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
  unparsed: boolean;
}

/** Parse a release tag into semver. Non-semver tags stay listed but unparsed (excluded from comparisons). */
export function parseReleaseVersion(tag: string): ParsedReleaseVersion {
  const stripped = tag.replace(/^[vV]/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)([-+].*)?$/.exec(stripped);
  if (!match) return { raw: tag, major: 0, minor: 0, patch: 0, prerelease: false, unparsed: true };
  return {
    raw: tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: typeof match[4] === "string" && match[4].length > 0,
    unparsed: false,
  };
}

/** Compare parsed versions. Prerelease ranks below the same stable triple. Returns negative/zero/positive. */
export function compareReleaseVersions(left: ParsedReleaseVersion, right: ParsedReleaseVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease ? -1 : 1;
}

export type ReleaseChannel = "stable" | "prerelease" | "draft";

export function releaseChannelOf(record: KforgeReleaseRecord): ReleaseChannel {
  if (record.draft === true) return "draft";
  if (record.prerelease === true) return "prerelease";
  return "stable";
}

export type ReleaseAssetKind = "nsis-installer" | "checksum" | "signature" | "sbom" | "other";

export interface NormalizedReleaseAsset {
  name: string;
  kind: ReleaseAssetKind;
  size?: number;
  downloadUrl?: string;
  expectedSha256?: string;
}

/** Classify a release asset by filename. Presence is discovery, not verification. */
export function classifyReleaseAsset(name: string): ReleaseAssetKind {
  const lower = name.toLowerCase();
  if (/setup.*windows.*x64.*\.exe$/.test(lower) || /knoux-forge-setup-.*\.exe$/.test(lower)) return "nsis-installer";
  if (/\.sha256$/.test(lower) || /sha256sums/.test(lower) || /(^|[\W_])checksums?([\W_]|$)/.test(lower) || /checksum/.test(lower)) return "checksum";
  if (/\.sig$/.test(lower) || /\.asc$/.test(lower) || /\.pem$/.test(lower)) return "signature";
  if (/\.sbom\./.test(lower) || /(^|[\W_])sbom([\W_]|$)/.test(lower)) return "sbom";
  return "other";
}

function sha256FromDigest(digest: string | null | undefined): string | undefined {
  if (!digest) return undefined;
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest.trim());
  return match ? match[1].toLowerCase() : undefined;
}

export interface NormalizedKforgeRelease {
  kind: "kforge-release";
  sourceId: typeof KFORGE_UPDATES_SOURCE_ID;
  tag: string;
  name?: string;
  channel: ReleaseChannel;
  version: ParsedReleaseVersion;
  publishedAt?: string;
  targetCommit?: string;
  notes?: string;
  assets: NormalizedReleaseAsset[];
  nsisAsset?: NormalizedReleaseAsset;
  checksumAssets: NormalizedReleaseAsset[];
  signatureAssets: NormalizedReleaseAsset[];
  retrievedAt: string;
  origin: "LIVE" | "CACHE";
  freshness: "CURRENT" | "CACHED" | "STALE";
}

/** Normalize one release record. Catalog facts only — never install authorization. */
export function normalizeKforgeRelease(
  record: KforgeReleaseRecord,
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
  freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT",
): NormalizedKforgeRelease {
  const assets: NormalizedReleaseAsset[] = (record.assets ?? []).map((asset) => ({
    name: asset.name,
    kind: classifyReleaseAsset(asset.name),
    ...(typeof asset.size === "number" ? { size: asset.size } : {}),
    ...(asset.browser_download_url ? { downloadUrl: asset.browser_download_url.slice(0, 2000) } : {}),
    ...(sha256FromDigest(asset.digest) ? { expectedSha256: sha256FromDigest(asset.digest) } : {}),
  }));
  const nsisAsset = assets.find((asset) => asset.kind === "nsis-installer" && /x64/i.test(asset.name));
  return {
    kind: "kforge-release",
    sourceId: KFORGE_UPDATES_SOURCE_ID,
    tag: record.tag_name,
    name: typeof record.name === "string" && record.name.length > 0 ? record.name.slice(0, 200) : undefined,
    channel: releaseChannelOf(record),
    version: parseReleaseVersion(record.tag_name),
    publishedAt: record.published_at || undefined,
    targetCommit: record.target_commitish,
    notes: typeof record.body === "string" && record.body.length > 0 ? record.body.slice(0, 8000) : undefined,
    assets,
    ...(nsisAsset ? { nsisAsset } : {}),
    checksumAssets: assets.filter((asset) => asset.kind === "checksum"),
    signatureAssets: assets.filter((asset) => asset.kind === "signature"),
    retrievedAt,
    origin,
    freshness,
  };
}

export type UpdateAvailabilityState = "UPDATE_AVAILABLE" | "UP_TO_DATE" | "UNKNOWN";

export interface TrustedUpdateBlocker {
  id: "checksum-unverified" | "signature-unavailable" | "workflow-unimplemented";
  detail: string;
}

export interface KforgeUpdateDecision {
  currentVersion: string;
  latestStable?: NormalizedKforgeRelease;
  latestPrerelease?: NormalizedKforgeRelease;
  availability: UpdateAvailabilityState;
  availabilityDetail: string;
  /** UPDATE_AVAILABLE is a catalog fact. Trusted install stays BLOCKED with stated reasons. */
  trustedUpdate: "BLOCKED";
  trustedBlockers: TrustedUpdateBlocker[];
}

/**
 * Decide update availability from normalized releases. Drafts never count;
 * unparsed tags never count; prereleases never satisfy the stable channel.
 */
export function decideKforgeUpdate(releases: NormalizedKforgeRelease[], currentVersion: string): KforgeUpdateDecision {
  const current = parseReleaseVersion(currentVersion);
  const comparables = releases.filter((release) => release.channel !== "draft" && !release.version.unparsed);
  const stables = comparables.filter((release) => release.channel === "stable");
  const prereleases = comparables.filter((release) => release.channel === "prerelease");
  const latest = (rows: NormalizedKforgeRelease[]): NormalizedKforgeRelease | undefined =>
    rows.reduce<NormalizedKforgeRelease | undefined>((best, row) => (!best || compareReleaseVersions(row.version, best.version) > 0 ? row : best), undefined);
  const latestStable = latest(stables);
  const latestPrerelease = latest(prereleases);
  const availability: UpdateAvailabilityState =
    current.unparsed || !latestStable ? "UNKNOWN" : compareReleaseVersions(latestStable.version, current) > 0 ? "UPDATE_AVAILABLE" : "UP_TO_DATE";
  const trustedBlockers: TrustedUpdateBlocker[] = [
    {
      id: "checksum-unverified",
      detail: latestStable?.nsisAsset
        ? `No expected SHA-256 sidecar has been verified for ${latestStable.nsisAsset.name}; download verification cannot pass.`
        : "No expected Windows x64 NSIS artifact with a verified SHA-256 sidecar is established for the latest stable release.",
    },
    {
      id: "signature-unavailable",
      detail: "Windows Authenticode trust evidence is absent per docs/SIGNING.md (current artifacts are explicitly UNSIGNED); TRUSTED_RELEASE cannot pass.",
    },
    {
      id: "workflow-unimplemented",
      detail: "Explicit download + verify + user-controlled install is not implemented in read-only discovery; no silent auto-update or auto-install exists.",
    },
  ];
  return {
    currentVersion,
    ...(latestStable ? { latestStable } : {}),
    ...(latestPrerelease ? { latestPrerelease } : {}),
    availability,
    availabilityDetail:
      availability === "UPDATE_AVAILABLE"
        ? `Latest stable ${latestStable!.tag} is newer than installed ${currentVersion} (catalog fact; not trusted-install authorization).`
        : availability === "UP_TO_DATE"
          ? `Installed ${currentVersion} matches or exceeds latest stable ${latestStable!.tag}.`
          : "No comparable stable release or installed version; availability NOT evaluated.",
    trustedUpdate: "BLOCKED",
    trustedBlockers,
  };
}
