import type { RemoteSourceDefinition, RemoteSourceId } from "./contracts";

/**
 * Approved remote-source registry (Slice 1).
 *
 * This allowlist is the SSRF boundary: adapters may only contact the exact
 * origins listed here, and every redirect hop is re-validated against it.
 * Sources are added one verified slice at a time; P0 starts with the
 * Official MCP Registry only.
 */

const MCP_BASE_URL = "https://registry.modelcontextprotocol.io";

export const APPROVED_REMOTE_SOURCES: RemoteSourceDefinition[] = [
  {
    id: "mcp-official-registry",
    name: "Official MCP Registry",
    category: "MCP Registry",
    priority: "P0",
    official: true,
    authority: "OFFICIAL",
    baseUrl: MCP_BASE_URL,
    allowedOrigins: [MCP_BASE_URL],
    readEndpoints: [
      "GET /v0.1/servers",
      "GET /v0.1/servers/{serverName}/versions",
      "GET /v0.1/servers/{serverName}/versions/{version}",
    ],
    auth: "Read discovery is suitable for unauthenticated public consumption; publishing uses namespace authentication.",
    pagination: "Opaque cursor returned as metadata.nextCursor; list endpoint supports cursor and limit.",
    rateLimitPolicy: "No numeric public read limit verified; the adapter observes 429/Retry-After and provider headers.",
    caching: "No universal cache contract verified; conditional/provider headers are used when present plus a bounded KForge cache.",
    licenseTerms: "OpenAPI declares MIT. Registry service usage still follows project/service policies.",
    capabilities: ["SEARCH", "LIST", "DETAIL", "VERSIONS", "INSTALL_METADATA"],
    targetCapabilities: ["Online Hub", "Marketplace", "Agents", "Tools", "MCP Server detail"],
    risk: "MEDIUM",
    legalStatus: "APPROVED_READ_DISCOVERY",
    notes:
      "Search supports search, updated_since, version=latest/exact, include_deleted. Registry metadata is not proof " +
      "that a server's tools/resources/prompts are executable at runtime.",
  },
];

export function listRemoteSources(): RemoteSourceDefinition[] {
  return [...APPROVED_REMOTE_SOURCES];
}

export function getRemoteSource(id: string): RemoteSourceDefinition | null {
  return APPROVED_REMOTE_SOURCES.find((source) => source.id === id) ?? null;
}

export function isAllowedOrigin(sourceId: RemoteSourceId, url: string): boolean {
  const source = getRemoteSource(sourceId);
  if (!source) return false;
  try {
    const parsed = new URL(url);
    return source.allowedOrigins.includes(`${parsed.protocol}//${parsed.host}`);
  } catch {
    return false;
  }
}
