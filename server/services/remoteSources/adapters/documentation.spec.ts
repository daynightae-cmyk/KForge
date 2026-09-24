import { describe, expect, it } from "vitest";
import {
  buildDocumentationRecord,
  getDocumentationSource,
  listDocumentationSources,
  searchDocumentationText,
  sha256Hex,
  validatedDocumentationQuery,
  validatedDocumentationSourceId,
} from "./documentation";
import { DOCS_LLMS_FIXTURE, DOCS_OPENAPI_FIXTURE, DOCS_UNKNOWN_SHAPE_FIXTURE } from "./fixtures/documentationFixtures";

describe("Documentation source allowlist", () => {
  it("lists only allowlisted provider documents with exact URLs", () => {
    const sources = listDocumentationSources();
    expect(sources.map((source) => source.id)).toEqual(["hf-openapi", "mcp-registry-openapi", "openvsx-openapi", "ollama-openapi", "openai-llms-full"]);
    for (const source of sources) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.allowedOrigins).toHaveLength(1);
      expect(source.url.startsWith(source.allowedOrigins[0])).toBe(true);
      expect(source.licenseTerms.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown source ids before any request", () => {
    expect(() => validatedDocumentationSourceId("https://evil.example/docs")).toThrow(/unsupported characters|unknown documentation source/);
    expect(() => validatedDocumentationSourceId("not-a-source")).toThrow(/unknown documentation source/);
    expect(getDocumentationSource("hf-openapi")?.provider).toBe("Hugging Face");
  });

  it("validates search queries", () => {
    expect(validatedDocumentationQuery("pagination")).toBe("pagination");
    expect(() => validatedDocumentationQuery("")).toThrow(/1-200/);
    expect(() => validatedDocumentationQuery("x".repeat(201))).toThrow(/1-200/);
  });
});

describe("Documentation record provenance", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("extracts OpenAPI title/version and hashes content", () => {
    const source = getDocumentationSource("hf-openapi")!;
    const record = buildDocumentationRecord({
      source,
      text: DOCS_OPENAPI_FIXTURE,
      contentType: "application/json",
      etag: '"v1"',
      retrievedAt,
      origin: "LIVE",
      freshness: "CURRENT",
    });
    expect(record.title).toBe("Fixture Provider API");
    expect(record.version).toBe("1.4.0");
    expect(record.contentHash).toBe(sha256Hex(DOCS_OPENAPI_FIXTURE));
    expect(record.canonicalUrl).toBe(source.url);
    expect(record.etag).toBe('"v1"');
    expect(record.authority).toBe("OFFICIAL_PER_PROVIDER");
    expect(record.sizeBytes).toBeGreaterThan(0);
  });

  it("extracts markdown headings and falls back honestly", () => {
    const source = getDocumentationSource("openai-llms-full")!;
    const md = buildDocumentationRecord({ source, text: DOCS_LLMS_FIXTURE, retrievedAt, origin: "LIVE", freshness: "CURRENT" });
    expect(md.title).toBe("Fixture Provider Reference");
    expect(md.version).toBe("UNKNOWN");
    const plain = buildDocumentationRecord({ source, text: DOCS_UNKNOWN_SHAPE_FIXTURE, retrievedAt, origin: "CACHE", freshness: "CACHED" });
    expect(plain.title).toBe(source.title);
    expect(plain.freshness).toBe("CACHED");
  });
});

describe("Cached documentation search", () => {
  it("finds case-insensitive matches with bounded snippets", () => {
    const result = searchDocumentationText(DOCS_LLMS_FIXTURE, "pagination");
    expect(result.matchCount).toBe(3);
    expect(result.snippets).toHaveLength(3);
    expect(result.snippets[0].toLowerCase()).toContain("pagination");
    expect(result.truncated).toBe(false);
  });

  it("returns empty matches without error", () => {
    expect(searchDocumentationText(DOCS_LLMS_FIXTURE, "absent-term")).toEqual({ matchCount: 0, truncated: false, snippets: [] });
  });

  it("bounds snippets on repetitive content", () => {
    const repetitive = "token ".repeat(1000);
    const result = searchDocumentationText(repetitive, "token");
    expect(result.matchCount).toBe(1000);
    expect(result.snippets).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });
});
