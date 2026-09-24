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
const OPEN_VSX_BASE_URL = "https://open-vsx.org";
const OSV_BASE_URL = "https://api.osv.dev";
const HF_BASE_URL = "https://huggingface.co";
const GITHUB_API_BASE_URL = "https://api.github.com";

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
  {
    id: "open-vsx",
    name: "Open VSX Registry",
    category: "IDE Extensions",
    priority: "P0",
    official: true,
    authority: "OFFICIAL",
    baseUrl: OPEN_VSX_BASE_URL,
    allowedOrigins: [OPEN_VSX_BASE_URL],
    readEndpoints: [
      "GET /api/-/query",
      "GET /api/-/search",
      "GET /api/{namespace}/{extension}",
      "GET /api/{namespace}/{extension}/{version}",
      "GET /api/{namespace}/{extension}/versions",
    ],
    auth: "Public metadata reads do not require publisher authentication; publishing requires authentication.",
    pagination: "Query/search endpoints expose bounded result/pagination parameters; exact OpenAPI shapes are validated tolerantly at implementation time.",
    rateLimitPolicy: "OpenAPI declares X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset and Retry-After/429. No numeric quota is hardcoded.",
    caching: "Official server implementation uses cache-control on metadata paths; Cache-Control/ETag are preserved when returned.",
    licenseTerms: "OpenAPI termsOfService: https://www.eclipse.org/legal/termsofuse.php ; API project license Eclipse Public License 2.0.",
    capabilities: ["SEARCH", "LIST", "DETAIL", "VERSIONS", "ARTIFACTS", "CHANGELOG", "DOCUMENTATION", "INSTALL_METADATA"],
    targetCapabilities: ["Online Hub", "Extensions", "Marketplace"],
    risk: "MEDIUM",
    legalStatus: "APPROVED_READ_DISCOVERY",
    notes:
      "Official API exposes VSIX/file assets (VSIX, manifest, license, changelog, signature, public key). " +
      "Catalog presence is not execution compatibility; install stays with the existing Marketplace lifecycle.",
  },
  {
    id: "osv",
    name: "OSV.dev API",
    category: "Security Intelligence",
    priority: "P0",
    official: true,
    authority: "OFFICIAL",
    baseUrl: OSV_BASE_URL,
    allowedOrigins: [OSV_BASE_URL],
    readEndpoints: [
      "POST /v1/query",
      "POST /v1/querybatch",
      "GET /v1/vulns/{id}",
    ],
    auth: "Public read API.",
    pagination: "Query can return page_token for large result sets; the token is replayed exactly.",
    rateLimitPolicy: "Official docs currently state no API rate limits; the adapter still observes 429/Retry-After and provider headers.",
    caching: "Package-version results use a short security TTL with explicit refresh; malformed refreshes never replace last-good evidence.",
    licenseTerms: "OSV/OpenSSF project data licensing varies by upstream source; source attribution and references are preserved per record.",
    capabilities: ["SECURITY", "DETAIL"],
    targetCapabilities: ["Quality", "Security", "Dependency intelligence"],
    risk: "LOW",
    legalStatus: "APPROVED_READ_DISCOVERY",
    notes:
      "HTTP/1.1 responses are capped at 32 MiB; KForge bounds reads well below that. Package-native " +
      "ranges and fixed versions make OSV the preferred P0 vulnerability source. Observational only: " +
      "advisories never modify dependency manifests by themselves.",
  },
  {
    id: "hugging-face-hub",
    name: "Hugging Face Hub API",
    category: "Model Registry",
    priority: "P0",
    official: true,
    authority: "OFFICIAL",
    baseUrl: HF_BASE_URL,
    allowedOrigins: [HF_BASE_URL],
    readEndpoints: [
      "GET /api/models",
      "model detail/file/tree endpoints exposed by OpenAPI",
    ],
    auth: "Open endpoints exist for public Hub information; bearer auth is needed for private/gated/user-specific actions and must remain server-side.",
    pagination: "Endpoint-specific cursor/limit parameters are described by OpenAPI; KForge implements bounded per-endpoint pagination.",
    rateLimitPolicy: "No numeric public Hub quota verified; the adapter observes 429/Retry-After and returned headers.",
    caching: "ETag/Cache-Control are respected where returned; revision/SHA is retained as provenance.",
    licenseTerms: "Hugging Face Terms of Service apply; every model/repository carries its own license/gating terms evaluated individually.",
    capabilities: ["SEARCH", "LIST", "DETAIL", "VERSIONS", "ARTIFACTS", "DOCUMENTATION"],
    targetCapabilities: ["AI", "Model Hub", "Marketplace"],
    risk: "MEDIUM",
    legalStatus: "APPROVED_READ_DISCOVERY",
    notes:
      "Catalog metadata never implies local installation. Gated/private models remain " +
      "NOT_CONFIGURED/BLOCKED until valid auth and terms are satisfied; bearer credentials stay server-side.",
  },
  {
    id: "github-releases-kforge",
    name: "GitHub Releases for KForge Update Discovery",
    category: "Product Updates",
    priority: "P0",
    official: true,
    authority: "OFFICIAL_PROJECT_RELEASE_CHANNEL",
    baseUrl: "https://api.github.com/repos/daynightae-cmyk/KForge",
    allowedOrigins: [GITHUB_API_BASE_URL],
    readEndpoints: [
      "GET /repos/daynightae-cmyk/KForge/releases",
      "GET /repos/daynightae-cmyk/KForge/releases/tags/{tag}",
      "GET release/assets endpoints",
    ],
    auth: "Published public releases readable anonymously; auth raises rate budget. Drafts require authorized access.",
    pagination: "per_page max 100; page. Conditional GET/ETag supported.",
    rateLimitPolicy: "GitHub REST limits apply (60/hour anonymous, 5000/hour authenticated). New code pins X-GitHub-Api-Version: 2026-03-10.",
    caching: "Strong candidate for conditional GET/ETag. Update checks are explicit refreshes, never page-open network calls.",
    licenseTerms: "GitHub terms plus KForge release license.",
    capabilities: ["LIST", "DETAIL", "ARTIFACTS", "CHANGELOG", "UPDATE_METADATA"],
    targetCapabilities: ["System / Updates", "Release & Distribution"],
    risk: "MEDIUM",
    legalStatus: "APPROVED_READ_DISCOVERY",
    notes:
      "A release record is update-catalog evidence only, never trusted-installer evidence. " +
      "TRUSTED_RELEASE stays blocked until checksum sidecars verify and Authenticode/trust policy " +
      "passes per docs/SIGNING.md (current artifacts are explicitly unsigned).",
  },
  {
    id: "remote-doc-openapi",
    name: "Official OpenAPI Documentation Sources",
    category: "Remote Documentation",
    priority: "P0",
    official: true,
    authority: "OFFICIAL_PER_PROVIDER",
    baseUrl: "allowlisted provider URLs",
    allowedOrigins: [
      "https://huggingface.co",
      "https://open-vsx.org",
      "https://developers.openai.com",
      "https://raw.githubusercontent.com",
    ],
    readEndpoints: [
      "GET official OpenAPI JSON/YAML and same-provider llms.txt only from the configured per-document allowlist",
    ],
    auth: "Public docs preferred. Never send project source to fetch docs.",
    pagination: "N/A; response-size limits mandatory.",
    rateLimitPolicy: "Provider-specific; the adapter observes 429/Retry-After and provider headers.",
    caching: "ETag/Last-Modified/Cache-Control when present; content hashed; canonical URL/version/retrievedAt preserved.",
    licenseTerms: "Provider documentation/API terms stored per source.",
    capabilities: ["DOCUMENTATION", "DETAIL"],
    targetCapabilities: ["Online / Documentation", "Global Search"],
    risk: "LOW",
    legalStatus: "APPROVED_FRAMEWORK",
    notes:
      "Highest-priority ingestion is provider-owned OpenAPI/JSON Schema, then same-provider llms.txt. " +
      "No general crawler, no user-supplied arbitrary URL fetcher, no open proxy: every document has " +
      "an exact allowlisted URL. llms.txt is an emerging convention, not a trust certificate.",
  },
  {
    id: "npm-registry",
    name: "npm Public Registry",
    category: "Package Registry",
    priority: "P1",
    official: true,
    authority: "OFFICIAL",
    baseUrl: "https://registry.npmjs.org",
    allowedOrigins: ["https://registry.npmjs.org"],
    readEndpoints: [
      "GET /-/v1/search",
      "GET /{package}",
      "GET /{package}/{version}",
      "GET /-/npm/v1/keys",
    ],
    auth: "Public package metadata/search readable without auth; authenticated management uses scoped/bearer tokens.",
    pagination: "Search uses size/from; detail uses per-package version map.",
    rateLimitPolicy: "No single numeric quota verified; respect provider headers/backoff and do not crawl npmjs.com.",
    caching: "Registry metadata supports HTTP caching; use ETag/Cache-Control when present plus bounded KForge cache.",
    licenseTerms: "npm Open Source Terms govern registry; each package carries its own license.",
    capabilities: ["SEARCH", "DETAIL", "VERSIONS", "ARTIFACTS", "INSTALL_METADATA"],
    targetCapabilities: ["Online Hub", "Packages", "Marketplace"],
    risk: "MEDIUM",
    legalStatus: "APPROVED_METADATA_ONLY",
    notes: "Version dist metadata includes tarball, shasum, integrity and may include registry signatures. Catalog presence is not installation.",
  },
  {
    id: "pypi",
    name: "Python Package Index (PyPI)",
    category: "Package Registry",
    priority: "P1",
    official: true,
    authority: "OFFICIAL",
    baseUrl: "https://pypi.org",
    allowedOrigins: ["https://pypi.org", "https://files.pythonhosted.org"],
    readEndpoints: [
      "GET /pypi/{project}/json",
      "GET /simple/{project}/",
      "GET /integrity/{project}/{version}/{filename}/provenance",
    ],
    auth: "Public read APIs are anonymous; upload/management requires auth.",
    pagination: "Project detail returns releases map; simple index is per-project.",
    rateLimitPolicy: "PyPI states no current edge rate limiting for JSON APIs, but irresponsible use can be blocked.",
    caching: "JSON responses are CDN cached and expose ETag; use If-None-Match plus bounded KForge cache.",
    licenseTerms: "PyPI Terms of Service and API Terms apply; each package carries its own license.",
    capabilities: ["DETAIL", "VERSIONS", "ARTIFACTS", "INSTALL_METADATA"],
    targetCapabilities: ["Online Hub", "Packages", "Marketplace"],
    risk: "LOW",
    legalStatus: "APPROVED_METADATA_ONLY",
    notes: "Artifact links can carry hashes; Integrity API exposes PEP 740 provenance via Trusted Publisher attestations.",
  },
  {
    id: "nuget-v3",
    name: "NuGet V3 / nuget.org",
    category: "Package Registry",
    priority: "P1",
    official: true,
    authority: "OFFICIAL",
    baseUrl: "https://api.nuget.org/v3/index.json",
    allowedOrigins: ["https://api.nuget.org", "https://azuresearch-usnc.nuget.org", "https://azuresearch-ussc.nuget.org"],
    readEndpoints: [
      "GET /v3/index.json (Service Index)",
      "GET SearchQueryService?q=&skip=&take=",
      "GET RegistrationsBaseUrl/{id}/index.json",
    ],
    auth: "Public nuget.org read endpoints are public; private sources can require provider-specific auth.",
    pagination: "Search uses skip/take; registrations use page structure.",
    rateLimitPolicy: "No numeric quota verified; respect provider headers and bounded concurrency.",
    caching: "Use provider cache headers; resource URLs discovered from service index when possible plus bounded KForge cache.",
    licenseTerms: "NuGet/Microsoft service terms apply; individual package licenses vary.",
    capabilities: ["SEARCH", "DETAIL", "VERSIONS", "ARTIFACTS", "INSTALL_METADATA"],
    targetCapabilities: ["Online Hub", "Packages", "Marketplace"],
    risk: "LOW",
    legalStatus: "APPROVED_METADATA_ONLY",
    notes: "RepositorySignatures resource identifies signing certificates. Catalog presence is not installation.",
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
