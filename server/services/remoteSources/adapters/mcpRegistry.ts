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
 * Official MCP Registry adapter: read-only discovery (Slice 1, P0).
 *
 * Source: https://registry.modelcontextprotocol.io
 * Reference: official registry API (see research pack section 5.1).
 * Operations: list/search, version history, version detail. No install, no
 * run, no connect, no environment-secret grants: catalog results are
 * CATALOG_ONLY / REMOTE_REGISTRY and runtime stays UNKNOWN / NOT_AVAILABLE
 * until a real runtime adapter proves it.
 *
 * Schemas are intentionally tolerant: only server identity is required and
 * every provider field is optional passthrough. Malformed identity fails
 * closed; unknown extra fields never become trusted claims.
 */

export const MCP_SOURCE_ID = "mcp-official-registry" as const;
export const MCP_BASE_URL = "https://registry.modelcontextprotocol.io";

const mcpIntegritySchema = z.object({ sha256: z.string().optional() }).passthrough();

const mcpPackageSchema = z
  .object({
    registry_type: z.string().optional(),
    registry_base_url: z.string().optional(),
    identifier: z.string().optional(),
    version: z.string().optional(),
    transport: z.unknown().optional(),
    runtime_hint: z.string().optional(),
    runtime_arguments: z.unknown().optional(),
    package_arguments: z.unknown().optional(),
    environment_variables: z.unknown().optional(),
    integrity: mcpIntegritySchema.optional(),
    file_sha256: z.string().optional(),
    sha256: z.string().optional(),
  })
  .passthrough();

const mcpRepositorySchema = z.object({ url: z.string().optional(), source: z.string().optional() }).passthrough();

const mcpVersionDetailSchema = z
  .object({
    version: z.string().optional(),
    release_date: z.string().optional(),
    updated_at: z.string().optional(),
    description: z.string().optional(),
    repository: mcpRepositorySchema.optional(),
    license: z.string().optional(),
    packages: z.array(mcpPackageSchema).optional(),
    remotes: z.unknown().optional(),
    transports: z.unknown().optional(),
  })
  .passthrough();

const mcpServerSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    repository: mcpRepositorySchema.optional(),
    version_detail: mcpVersionDetailSchema.optional(),
    version: z.string().optional(),
    license: z.string().optional(),
    publisher: z.string().optional(),
    namespace: z.string().optional(),
    updated_at: z.string().optional(),
    updatedAt: z.string().optional(),
    packages: z.array(mcpPackageSchema).optional(),
  })
  .passthrough();

const mcpListResponseSchema = z
  .object({
    servers: z.array(mcpServerSchema),
    metadata: z.object({ nextCursor: z.string().optional(), next_cursor: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const mcpVersionsResponseSchema = z
  .object({
    versions: z.array(mcpVersionDetailSchema),
    metadata: z.object({ nextCursor: z.string().optional(), next_cursor: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export type McpServerRecord = z.infer<typeof mcpServerSchema>;
/** A version record always carries an immutable version string; entries without one are refused. */
export type McpVersionRecord = z.infer<typeof mcpVersionDetailSchema> & { version: string };

function requireVersion(entry: z.infer<typeof mcpVersionDetailSchema>, context: string): McpVersionRecord {
  if (!entry.version) throw new Error(errorMessage(context));
  return { ...entry, version: entry.version };
}

export interface McpListResult {
  servers: McpServerRecord[];
  nextCursor?: string;
}

export interface McpVersionsResult {
  versions: McpVersionRecord[];
  nextCursor?: string;
}

function errorMessage(context: string): string {
  return `MCP Registry: ${context} does not match the documented response shape; the provider response was refused.`;
}

/** Validate a list/search response. Throws on malformed JSON or schema mismatch. */
export function parseMcpListResponse(rawText: string): McpListResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(errorMessage("malformed JSON in server list"));
  }
  // The list endpoint may return either an enveloped object or a bare array.
  if (Array.isArray(parsed)) parsed = { servers: parsed };
  const validation = mcpListResponseSchema.safeParse(parsed);
  if (!validation.success) throw new Error(errorMessage("server list"));
  const metadata = validation.data.metadata as { nextCursor?: string; next_cursor?: string } | undefined;
  return { servers: validation.data.servers, nextCursor: metadata?.nextCursor ?? metadata?.next_cursor };
}

/** Validate a version-history response. Throws on malformed JSON or schema mismatch. */
export function parseMcpVersionsResponse(rawText: string): McpVersionsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(errorMessage("malformed JSON in version history"));
  }
  if (Array.isArray(parsed)) parsed = { versions: parsed };
  const validation = mcpVersionsResponseSchema.safeParse(parsed);
  if (!validation.success) throw new Error(errorMessage("version history"));
  const metadata = validation.data.metadata as { nextCursor?: string; next_cursor?: string } | undefined;
  return { versions: validation.data.versions.map((entry) => requireVersion(entry, "version history")), nextCursor: metadata?.nextCursor ?? metadata?.next_cursor };
}

/** Validate a single version-detail response. Throws on malformed JSON or schema mismatch. */
export function parseMcpVersionDetailResponse(rawText: string): McpVersionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(errorMessage("malformed JSON in version detail"));
  }
  const candidate = (parsed as Record<string, unknown>)?.version_detail ?? parsed;
  const validation = mcpVersionDetailSchema.safeParse(candidate);
  if (!validation.success) throw new Error(errorMessage("version detail"));
  return requireVersion(validation.data, "version detail");
}

export interface McpSearchParams {
  search?: string;
  cursor?: string;
  limit?: number;
  updatedSince?: string;
  version?: string;
  includeDeleted?: boolean;
}

export function buildMcpServersUrl(base: string, params: McpSearchParams): string {
  const url = new URL("/v0.1/servers", base);
  if (params.search) url.searchParams.set("search", params.search);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.updatedSince) url.searchParams.set("updated_since", params.updatedSince);
  if (params.version) url.searchParams.set("version", params.version);
  if (params.includeDeleted === true) url.searchParams.set("include_deleted", "true");
  return url.toString();
}

export function buildMcpVersionsUrl(base: string, serverName: string): string {
  return new URL(`/v0.1/servers/${encodeURIComponent(serverName)}/versions`, base).toString();
}

export function buildMcpVersionDetailUrl(base: string, serverName: string, version: string): string {
  return new URL(`/v0.1/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(version)}`, base).toString();
}

function describeValue(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value.slice(0, 200)];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").slice(0, 12);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string") return [record.type.slice(0, 120)];
    return Object.keys(record).slice(0, 12);
  }
  return [];
}

function packageSummaries(packages: McpServerRecord["packages"]): { distributions: string[]; transports: string[]; integrity: IntegrityEvidence } {
  const distributions: string[] = [];
  const transports: string[] = [];
  let integrity: IntegrityEvidence = missingIntegrity("No package integrity field was supplied by the MCP Registry response.");
  for (const pkg of packages ?? []) {
    if (pkg.registry_type || pkg.identifier) {
      distributions.push([pkg.registry_type, pkg.identifier, pkg.version].filter(Boolean).join(":").slice(0, 200));
    }
    transports.push(...describeValue(pkg.transport));
    const hash = pkg.integrity?.sha256 || pkg.file_sha256 || pkg.sha256;
    if (typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)) {
      integrity = { state: "EXPECTED", algorithm: "sha256", expectedHash: hash.toLowerCase(), source: "MCP Registry package metadata" };
    }
  }
  return { distributions, transports, integrity };
}

function licenseFrom(record: { license?: string }): LicenseEvidence {
  if (record.license && record.license.trim().length > 0) {
    return { state: "CLASSIFIED", license: record.license.slice(0, 200), source: "MCP Registry record" };
  }
  return unknownLicense("The MCP Registry record carries no license field; UNKNOWN is not open source.");
}

export interface NormalizedMcpServer extends NormalizedRemoteItem {
  kind: "mcp-server";
  serverName: string;
  description: string;
  repositoryUrl?: string;
  version?: string;
  publisher?: string;
  distributions: string[];
  transports: string[];
  updatedAt?: string;
}

/** Normalize one registry server record. Registry metadata is discovery only, never runtime proof. */
export function normalizeMcpServer(server: McpServerRecord, retrievedAt: string, origin: "LIVE" | "CACHE"): NormalizedMcpServer {
  const detail = server.version_detail ?? {};
  const packages = server.packages ?? detail.packages ?? [];
  const { distributions, transports, integrity } = packageSummaries(packages);
  const repositoryUrl = server.repository?.url || detail.repository?.url;
  const version = server.version_detail?.version ?? server.version;
  const publisher = server.publisher ?? server.namespace;
  return {
    kind: "mcp-server",
    sourceId: MCP_SOURCE_ID,
    serverName: server.name,
    description: (server.description || detail.description || "No description was supplied by the MCP Registry.").slice(0, 2000),
    repositoryUrl,
    version,
    publisher,
    distributions,
    transports,
    updatedAt: server.updated_at || server.updatedAt || detail.updated_at || detail.release_date,
    authority: origin === "CACHE" ? { kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" } : { kind: "REMOTE_REGISTRY" },
    availability: "CATALOG",
    runtimeEvidence: {
      state: "NOT_AVAILABLE",
      sources: ["Registry catalog metadata only; no MCP runtime connection was attempted."],
    },
    freshness: { state: origin === "CACHE" ? "CACHED" : "CURRENT", at: retrievedAt },
    license: licenseFrom({ license: server.license ?? detail.license }),
    integrity,
    signature: unverifiedSignature("The MCP Registry response carries no signature evidence for this record."),
    provenance: {
      state: origin === "CACHE" ? "CACHED" : "REMOTE_REGISTRY",
      sourceId: MCP_SOURCE_ID,
      canonicalUrl: `${MCP_BASE_URL}/v0.1/servers/${encodeURIComponent(server.name)}`,
      retrievedAt,
      origin,
      source: origin === "CACHE" ? "Bounded KForge remote-source cache" : "Official MCP Registry",
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
 * Project a normalized MCP server onto the EXISTING MarketplaceItem contract
 * so the current Workbench cards and canonical Inspector render real remote
 * evidence (source, authority, freshness, license, integrity, provenance)
 * without any new UI truth model. Install stays NOT_AVAILABLE: read-only
 * discovery cannot install, run, or connect.
 */
export function mcpServerToMarketplaceItem(normalized: NormalizedMcpServer, checkedAt: string): MarketplaceItem {
  const permissions: MarketplacePermission[] = PERMISSION_IDS.map((id) => ({
    id,
    required: false,
    detail: "Remote registry metadata declares no local permission requirements.",
  }));
  const evidenceSource = normalized.provenance.origin === "CACHE" ? "Bounded KForge remote-source cache" : "Official MCP Registry";
  return {
    id: `mcp:${normalized.serverName}`,
    category: "tools",
    taxonomy: ["tools", "integrations"],
    name: normalized.serverName,
    description: normalized.description,
    overview: normalized.description,
    features: ["mcp-server", "remote-catalog", ...normalized.transports.slice(0, 4)],
    source: "Official MCP Registry",
    sourceUrl: normalized.provenance.canonicalUrl,
    ...(normalized.version ? { version: normalized.version } : {}),
    ...(normalized.license.license ? { license: normalized.license.license } : {}),
    capabilities: ["mcp-server", ...normalized.distributions.slice(0, 6)],
    requirements: ["Explicit user confirmation before any install, run, or connection workflow (not implemented in read-only discovery)."],
    compatibility: "UNKNOWN",
    permissions,
    security: { state: "UNKNOWN", source: "No security verdict is supplied by the MCP Registry catalog response." },
    publisher: normalized.publisher
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.publisher }
      : { state: "UNKNOWN", source: "No publisher evidence was supplied by the MCP Registry response." },
    repository: normalized.repositoryUrl
      ? { state: "UNKNOWN", source: evidenceSource, value: normalized.repositoryUrl }
      : { state: "UNKNOWN", source: "No repository evidence was supplied by the MCP Registry response." },
    releaseHistory: { state: "NOT_AVAILABLE", source: "Version history requires the explicit versions endpoint.", items: [] },
    changelog: { state: "NOT_AVAILABLE", source: "No changelog is supplied by the MCP Registry catalog response." },
    installationState: { state: "NOT_AVAILABLE", source: "Catalog presence is not installation; no install adapter ran." },
    updateState: { state: "NOT_CONFIGURED", source: "No update adapter exists for remote MCP catalog items." },
    dependencies: { state: "UNKNOWN", source: "No dependency graph is supplied by the MCP Registry catalog response.", items: [] },
    provenance: {
      state: normalized.provenance.origin === "CACHE" ? "UNKNOWN" : "UNKNOWN",
      source: `${evidenceSource}; retrieved ${normalized.provenance.retrievedAt}`,
      value: normalized.provenance.canonicalUrl,
    },
    integrity:
      normalized.integrity.state === "EXPECTED" && normalized.integrity.expectedHash
        ? { state: "UNKNOWN", source: "MCP Registry package metadata", value: `sha256:${normalized.integrity.expectedHash}` }
        : { state: "NOT_AVAILABLE", source: "No integrity field was supplied by the MCP Registry response." },
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
        { id: "install", enabled: false, requiresConfirmation: true, reason: "Read-only discovery: no verified MCP install adapter exists yet." },
        { id: "manage", enabled: false, requiresConfirmation: false, reason: "The item is not installed." },
      ],
      unavailableReason: "Remote catalog result: inspect evidence only. Install, run, and connect require a future verified adapter plus explicit confirmation.",
    },
    unavailableReason: "Remote catalog result: inspect evidence only. Install, run, and connect require a future verified adapter plus explicit confirmation.",
  };
}

export function normalizeMcpVersions(
  serverName: string,
  versions: McpVersionRecord[],
  retrievedAt: string,
  origin: "LIVE" | "CACHE",
): Array<NormalizedMcpServer & { versionDetail: McpVersionRecord }> {
  return versions.map((detail) => ({
    ...normalizeMcpServer(
      { name: serverName, version_detail: detail, description: detail.description, repository: detail.repository ?? undefined },
      retrievedAt,
      origin,
    ),
    version: detail.version,
    versionDetail: detail,
  }));
}
