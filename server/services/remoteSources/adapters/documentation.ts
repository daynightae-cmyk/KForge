import { createHash } from "crypto";

/**
 * Remote Documentation framework: allowlisted official provider documents
 * (Slice 6, P0).
 *
 * Source classes, in order: official OpenAPI / JSON Schema, official
 * versioned documentation Git repository, official sitemap /
 * machine-readable index, same-provider official llms.txt /
 * llms-full.txt, explicit allowlisted official documentation page.
 *
 * There is NO general web crawler, NO user-supplied arbitrary URL fetcher,
 * and NO open proxy: every document has an exact allowlisted URL and an
 * exact allowlisted origin, validated by the shared safe-fetch layer.
 * GitHub blob pages are never fetched as documentation; raw file endpoints
 * are allowlisted explicitly per document (derivation noted per source).
 */

export const REMOTE_DOC_SOURCE_ID = "remote-doc-openapi" as const;

export type DocumentationSourceKind = "openapi-json" | "openapi-yaml" | "llms-txt" | "official-page";

export interface DocumentationSource {
  id: string;
  provider: string;
  kind: DocumentationSourceKind;
  title: string;
  /** Exact allowlisted document URL. */
  url: string;
  /** Exact allowlisted origin for this document. */
  allowedOrigins: string[];
  version?: string;
  licenseTerms: string;
  authority: string;
  notes: string;
}

export const DOCUMENTATION_SOURCES: DocumentationSource[] = [
  {
    id: "hf-openapi",
    provider: "Hugging Face",
    kind: "openapi-json",
    title: "Hugging Face Hub OpenAPI",
    url: "https://huggingface.co/.well-known/openapi.json",
    allowedOrigins: ["https://huggingface.co"],
    licenseTerms: "Hugging Face Terms of Service apply; see https://huggingface.co/terms-of-service.",
    authority: "OFFICIAL_PER_PROVIDER",
    notes: "Machine-readable Hub API contract from the provider's well-known endpoint.",
  },
  {
    id: "mcp-registry-openapi",
    provider: "Model Context Protocol",
    kind: "openapi-yaml",
    title: "Official MCP Registry OpenAPI",
    url: "https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/reference/api/openapi.yaml",
    allowedOrigins: ["https://raw.githubusercontent.com"],
    licenseTerms: "Registry OpenAPI declares MIT; registry service usage follows project/service policies.",
    authority: "OFFICIAL_PER_PROVIDER",
    notes: "Raw file endpoint derived from the official registry-api reference path (blob pages are never fetched).",
  },
  {
    id: "openvsx-openapi",
    provider: "Open VSX",
    kind: "openapi-json",
    title: "Open VSX Registry OpenAPI",
    url: "https://open-vsx.org/v3/api-docs/registry",
    allowedOrigins: ["https://open-vsx.org"],
    licenseTerms: "OpenAPI termsOfService: https://www.eclipse.org/legal/termsofuse.php ; API project license Eclipse Public License 2.0.",
    authority: "OFFICIAL_PER_PROVIDER",
    notes: "Machine-readable registry contract from the provider's api-docs endpoint.",
  },
  {
    id: "ollama-openapi",
    provider: "Ollama",
    kind: "openapi-yaml",
    title: "Ollama Local API OpenAPI",
    url: "https://raw.githubusercontent.com/ollama/ollama/main/docs/openapi.yaml",
    allowedOrigins: ["https://raw.githubusercontent.com"],
    licenseTerms: "Ollama API OpenAPI declares MIT; installed model licenses are model-specific.",
    authority: "OFFICIAL_PER_PROVIDER",
    notes: "Raw file endpoint derived from the official Ollama docs path (blob pages are never fetched). Local loopback use stays origin-restricted.",
  },
  {
    id: "openai-llms-full",
    provider: "OpenAI",
    kind: "llms-txt",
    title: "OpenAI API llms-full.txt",
    url: "https://developers.openai.com/api/reference/llms-full.txt",
    allowedOrigins: ["https://developers.openai.com"],
    licenseTerms: "OpenAI service terms apply; the llms.txt convention grants no redistribution rights.",
    authority: "OFFICIAL_PER_PROVIDER",
    notes: "Same-provider published LLM context file; an emerging convention, not a trust certificate.",
  },
];

export function listDocumentationSources(): DocumentationSource[] {
  return [...DOCUMENTATION_SOURCES];
}

export function getDocumentationSource(id: string): DocumentationSource | null {
  return DOCUMENTATION_SOURCES.find((source) => source.id === id) ?? null;
}

export const DOCUMENTATION_SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validatedDocumentationSourceId(id: string): DocumentationSource {
  if (!DOCUMENTATION_SOURCE_ID_PATTERN.test(id)) {
    throw new Error("Remote Documentation: source id contains unsupported characters.");
  }
  const source = getDocumentationSource(id);
  if (!source) throw new Error("Remote Documentation: unknown documentation source. Only allowlisted provider documents can be refreshed.");
  return source;
}

export interface DocumentationRecord {
  sourceId: string;
  provider: string;
  canonicalUrl: string;
  title: string;
  version: string;
  retrievedAt: string;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  contentType?: string;
  sizeBytes: number;
  authority: string;
  licenseTerms: string;
  origin: "LIVE" | "CACHE";
  freshness: "CURRENT" | "CACHED" | "STALE";
  /** Bounded excerpt retained for search snippets; full text stays in cache. */
  excerpt: string;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function openApiTitleVersion(text: string): { title?: string; version?: string } {
  try {
    const parsed = JSON.parse(text) as { info?: { title?: unknown; version?: unknown } };
    const title = typeof parsed?.info?.title === "string" ? parsed.info.title.slice(0, 200) : undefined;
    const version = typeof parsed?.info?.version === "string" ? parsed.info.version.slice(0, 100) : undefined;
    return { ...(title ? { title } : {}), ...(version ? { version } : {}) };
  } catch {
    return {};
  }
}

function markdownHeading(text: string): string | undefined {
  const match = /^#{1,3}\s+(.+)$/m.exec(text);
  return match ? match[1].trim().slice(0, 200) : undefined;
}

/**
 * Build a documentation record with full provenance. Title/version are
 * best-effort extractions that fall back to the allowlisted source
 * metadata; UNKNOWN is never upgraded to a claim.
 */
export function buildDocumentationRecord(input: {
  source: DocumentationSource;
  text: string;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  retrievedAt: string;
  origin: "LIVE" | "CACHE";
  freshness: "CURRENT" | "CACHED" | "STALE";
}): DocumentationRecord {
  const sizeBytes = Buffer.byteLength(input.text, "utf8");
  const extracted = input.source.kind === "openapi-json" ? openApiTitleVersion(input.text) : { title: markdownHeading(input.text) };
  return {
    sourceId: input.source.id,
    provider: input.source.provider,
    canonicalUrl: input.source.url,
    title: extracted.title ?? input.source.title,
    version: extracted.version ?? input.source.version ?? "UNKNOWN",
    retrievedAt: input.retrievedAt,
    ...(input.etag ? { etag: input.etag } : {}),
    ...(input.lastModified ? { lastModified: input.lastModified } : {}),
    contentHash: sha256Hex(input.text),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    sizeBytes,
    authority: input.source.authority,
    licenseTerms: input.source.licenseTerms,
    origin: input.origin,
    freshness: input.freshness,
    excerpt: input.text.slice(0, 2000),
  };
}

export interface DocumentationSearchHit {
  sourceId: string;
  provider: string;
  title: string;
  canonicalUrl: string;
  version: string;
  freshness: "CURRENT" | "CACHED" | "STALE";
  matchCount: number;
  truncated: boolean;
  snippets: string[];
}

const MAX_QUERY_LENGTH = 200;
const MAX_SNIPPETS_PER_RECORD = 5;
const SNIPPET_RADIUS = 120;

export function validatedDocumentationQuery(query: string): string {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > MAX_QUERY_LENGTH) {
    throw new Error("Remote Documentation: query must be a string of 1-200 characters.");
  }
  return query;
}

/** Case-insensitive substring search over cached record text (local only, never fetches). */
export function searchDocumentationText(text: string, query: string): { matchCount: number; truncated: boolean; snippets: string[] } {
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  const snippets: string[] = [];
  let matchCount = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    matchCount += 1;
    if (snippets.length < MAX_SNIPPETS_PER_RECORD) {
      const start = Math.max(0, at - SNIPPET_RADIUS);
      const end = Math.min(text.length, at + needle.length + SNIPPET_RADIUS);
      snippets.push(`${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`);
    }
    from = at + needle.length;
    if (from >= text.length) break;
  }
  return { matchCount, truncated: matchCount > snippets.length, snippets };
}
