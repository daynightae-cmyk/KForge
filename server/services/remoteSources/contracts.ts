import type {
  OnlineAuthorityEvidence,
  OnlineAvailabilityState,
  OnlineEvidenceFreshness,
  OnlineRuntimeEvidence,
} from "../../../shared/workspace";

/**
 * Canonical Remote Source foundation contracts (Slice 1).
 *
 * These contracts map the research-pack normalization concepts onto the
 * EXISTING KForge evidence model instead of duplicating it:
 * - authority/freshness/availability reuse `shared/workspace` truth states,
 * - install/runtime separation from `marketplaceCore` is preserved,
 * - every remote record keeps provenance + freshness + trust-stage evidence.
 *
 * Remote catalog presence MUST NOT mean INSTALLED. Downloaded bytes MUST NOT
 * mean VERIFIED. Hash verification MUST NOT mean PUBLISHER_VERIFIED.
 */

export const REMOTE_SOURCE_IDS = ["mcp-official-registry", "open-vsx", "osv", "hugging-face-hub", "github-releases-kforge", "remote-doc-openapi", "npm-registry"] as const;
export type RemoteSourceId = (typeof REMOTE_SOURCE_IDS)[number];

export type RemoteSourcePriority = "P0" | "P1" | "P2" | "P3";
export type RemoteSourceAuthority =
  | "OFFICIAL"
  | "OFFICIAL_PROJECT_RELEASE_CHANNEL"
  | "OFFICIAL_PER_PROVIDER"
  | "FIRST_PARTY_PROVIDER"
  | "OFFICIAL_PROJECT"
  | "MICROSOFT_COMMUNITY_REPOSITORY"
  | "MICROSOFT_REFERENCE"
  | "OFFICIAL_GOVERNMENT"
  | "COMMUNITY";
export type RemoteSourceRisk = "LOW" | "MEDIUM" | "HIGH";
export type RemoteSourceLegalStatus =
  | "APPROVED_READ_DISCOVERY"
  | "APPROVED_METADATA_ONLY"
  | "APPROVED_LOCAL"
  | "APPROVED_PROVIDER_METADATA"
  | "APPROVED_AUTHENTICATED_READ"
  | "APPROVED_FRAMEWORK"
  | "OPTIONAL_PROVIDER"
  | "SECONDARY_DISCOVERY_ONLY"
  | "SECONDARY_OFFICIAL_DISCOVERY"
  | "VERIFY_AT_IMPLEMENTATION"
  | "OWNER_LEGAL_REVIEW_REQUIRED"
  | "BLOCK_AUTO_INSTALL_UNTIL_SIGNING_CLOSED";

export type RemoteSourceCapability =
  | "SEARCH"
  | "LIST"
  | "DETAIL"
  | "VERSIONS"
  | "ARTIFACTS"
  | "CHANGELOG"
  | "DOCUMENTATION"
  | "INSTALL_METADATA"
  | "UPDATE_METADATA"
  | "SECURITY";

/** Approved remote source definition. The registry allowlist is the SSRF boundary. */
export interface RemoteSourceDefinition {
  id: RemoteSourceId;
  name: string;
  category: string;
  priority: RemoteSourcePriority;
  official: boolean;
  authority: RemoteSourceAuthority;
  /** Canonical base URL, e.g. https://registry.modelcontextprotocol.io */
  baseUrl: string;
  /** Exact HTTPS origins this source may be contacted at. Redirects outside this list are rejected. */
  allowedOrigins: string[];
  readEndpoints: string[];
  auth: string;
  pagination: string;
  rateLimitPolicy: string;
  caching: string;
  licenseTerms: string;
  capabilities: RemoteSourceCapability[];
  targetCapabilities: string[];
  risk: RemoteSourceRisk;
  legalStatus: RemoteSourceLegalStatus;
  notes: string;
}

/**
 * Trust ladder (mission section 12). Remote discovery climbs this ladder one
 * verified rung at a time; it MUST NOT be reduced to a single boolean.
 */
export const TRUST_LADDER = [
  "CATALOG_DISCOVERED",
  "SOURCE_IDENTIFIED",
  "LICENSE_CLASSIFIED",
  "ARTIFACT_IDENTIFIED",
  "INTEGRITY_EXPECTED",
  "ARTIFACT_VERIFIED",
  "SIGNATURE_VERIFIED",
  "PROVENANCE_VERIFIED",
  "COMPATIBILITY_VERIFIED",
  "USER_CONFIRMED",
  "INSTALLED",
  "RUNTIME_VERIFIED",
] as const;
export type TrustStage = (typeof TRUST_LADDER)[number];

/** License evidence. UNKNOWN stays UNKNOWN; a missing license is never "open source". */
export interface LicenseEvidence {
  state: "CLASSIFIED" | "UNKNOWN" | "LEGAL_REVIEW_REQUIRED";
  /** SPDX id or provider license string when the source actually supplies one. */
  license?: string;
  termsUrl?: string;
  redistribution?: "ALLOWED" | "RESTRICTED" | "UNKNOWN";
  commercialUse?: "ALLOWED" | "RESTRICTED" | "UNKNOWN";
  attributionRequired?: boolean;
  source: string;
}

/** Integrity evidence. Expected hash is independent of downloaded bytes. */
export interface IntegrityEvidence {
  state: "EXPECTED" | "VERIFIED" | "MISMATCH" | "MISSING" | "UNKNOWN";
  algorithm?: "sha256";
  expectedHash?: string;
  source: string;
}

/** Signature / publisher-identity evidence. A checksum is not publisher identity. */
export interface SignatureEvidence {
  state: "VERIFIED" | "NOT_AVAILABLE" | "MISMATCH" | "UNKNOWN";
  signer?: string;
  keyId?: string;
  source: string;
}

/** Provenance evidence: where the record came from and when it was seen. */
export interface ProvenanceEvidence {
  state: "VERIFIED" | "REMOTE_REGISTRY" | "CACHED" | "UNKNOWN";
  sourceId: RemoteSourceId;
  canonicalUrl: string;
  retrievedAt: string;
  origin: "LIVE" | "CACHE";
  source: string;
}

export interface RateLimitEvidence {
  limit?: string;
  remaining?: string;
  reset?: string;
  retryAfterSeconds?: number;
  observed429: boolean;
  source: string;
}

/** Per-request remote-contact evidence, recorded for the Online Control Center. */
export interface RemoteRequestEvidence {
  sourceId: RemoteSourceId;
  /** Redacted destination origin (no credentials, query, or fragment). */
  destination: string;
  method: "GET" | "POST";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  httpStatus: number | null;
  notModified: boolean;
  fromCache: boolean;
  stale: boolean;
  etag?: string;
  lastModified?: string;
  rateLimit: RateLimitEvidence;
  error?: string;
}

export interface CacheEvidence {
  sourceId: RemoteSourceId;
  cachedAt: string | null;
  freshness: OnlineEvidenceFreshness;
  fromCache: boolean;
  stale: boolean;
  etag?: string;
  lastModified?: string;
}

/** Normalized remote catalog item envelope shared by every adapter. */
export interface NormalizedRemoteItem {
  sourceId: RemoteSourceId;
  authority: OnlineAuthorityEvidence;
  availability: OnlineAvailabilityState;
  runtimeEvidence: OnlineRuntimeEvidence;
  freshness: { state: "CURRENT" | "CACHED" | "STALE" | "UNKNOWN"; at: string | null };
  license: LicenseEvidence;
  integrity: IntegrityEvidence;
  signature: SignatureEvidence;
  provenance: ProvenanceEvidence;
  trustStage: TrustStage;
}

export function unknownLicense(source: string): LicenseEvidence {
  return { state: "UNKNOWN", source };
}

export function missingIntegrity(source: string): IntegrityEvidence {
  return { state: "MISSING", source };
}

export function unverifiedSignature(source: string): SignatureEvidence {
  return { state: "NOT_AVAILABLE", source };
}
