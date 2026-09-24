import { describe, expect, it } from "vitest";
import {
  buildHfModelUrl,
  buildHfModelsUrl,
  hfModelToMarketplaceItem,
  matchHfLocal,
  normalizeHfModel,
  parseHfModelResponse,
  parseHfModelsResponse,
  validatedHfModelId,
} from "./huggingFace";
import { HF_DETAIL_FIXTURE, HF_PRIVATE_FIXTURE, HF_SEARCH_FIXTURE } from "./fixtures/huggingFaceFixtures";

describe("Hugging Face response validation", () => {
  it("parses a model list", () => {
    const models = parseHfModelsResponse(JSON.stringify(HF_SEARCH_FIXTURE));
    expect(models.map((entry) => entry.id)).toEqual(["Qwen/Qwen2.5-Coder-1.5B", "acme/minimal-gated"]);
  });

  it("parses an empty list without fabricating entries", () => {
    expect(parseHfModelsResponse(JSON.stringify([]))).toEqual([]);
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parseHfModelsResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parseHfModelsResponse(JSON.stringify([{ author: "no id" }]))).toThrow(/response shape/);
    expect(() => parseHfModelsResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });

  it("parses model detail", () => {
    expect(parseHfModelResponse(JSON.stringify(HF_DETAIL_FIXTURE)).sha).toContain("a1b2c3");
  });

  it("validates model ids", () => {
    expect(validatedHfModelId("Qwen/Qwen2.5-Coder-1.5B")).toBe("Qwen/Qwen2.5-Coder-1.5B");
    expect(() => validatedHfModelId("no-slash")).toThrow();
    expect(() => validatedHfModelId("../../etc/passwd")).toThrow();
    expect(() => validatedHfModelId("a/b/c")).toThrow();
  });
});

describe("Hugging Face URL builders", () => {
  it("encodes search, author, filter, sort, direction, limit, and cursor", () => {
    const url = buildHfModelsUrl("https://huggingface.co", {
      search: "coder",
      author: "Qwen",
      filter: "text-generation",
      sort: "likes",
      direction: -1,
      limit: 10,
      cursor: "opaque",
    });
    expect(url).toContain("search=coder");
    expect(url).toContain("sort=likes");
    expect(url).toContain("direction=-1");
    expect(url).toContain("limit=10");
  });

  it("encodes model ids segment-wise", () => {
    expect(buildHfModelUrl("https://huggingface.co", "Qwen/Qwen2.5-Coder-1.5B")).toBe(
      "https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-1.5B",
    );
  });
});

describe("Hugging Face normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes live catalog records with revision, license, files, and counts", () => {
    const normalized = normalizeHfModel(HF_SEARCH_FIXTURE[0], retrievedAt, "LIVE");
    expect(normalized.sourceId).toBe("hugging-face-hub");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.trustStage).toBe("CATALOG_DISCOVERED");
    expect(normalized.revision).toContain("a1b2c3");
    expect(normalized.license).toMatchObject({ state: "CLASSIFIED", license: "apache-2.0" });
    expect(normalized.access.state).toBe("OPEN");
    expect(normalized.files).toHaveLength(2);
    expect(normalized.files[0].sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(normalized.likes).toBe(1234);
    expect(normalized.localEvidence.state).toBe("NOT_CHECKED");
  });

  it("classifies gated and private records distinctly from open ones", () => {
    expect(normalizeHfModel(HF_SEARCH_FIXTURE[1], retrievedAt, "LIVE").access.state).toBe("GATED");
    expect(normalizeHfModel(HF_PRIVATE_FIXTURE, retrievedAt, "LIVE").access.state).toBe("PRIVATE");
  });

  it("keeps missing license as UNKNOWN, never open source", () => {
    const normalized = normalizeHfModel({ ...HF_SEARCH_FIXTURE[1], tags: [] }, retrievedAt, "LIVE");
    expect(normalized.license.state).toBe("UNKNOWN");
    expect(normalized.license.license).toBeUndefined();
  });

  it("attaches separate LOCAL evidence on token-overlap matches only", () => {
    const matched = normalizeHfModel(HF_SEARCH_FIXTURE[0], retrievedAt, "LIVE", "CURRENT", ["qwen2.5-coder:1.5b", "mistral:7b"]);
    expect(matched.localEvidence.state).toBe("INSTALLED");
    expect(matched.localEvidence.matchedName).toBe("qwen2.5-coder:1.5b");
    const missed = normalizeHfModel(HF_SEARCH_FIXTURE[0], retrievedAt, "LIVE", "CURRENT", ["mistral:7b"]);
    expect(missed.localEvidence.state).toBe("NOT_DETECTED");
  });

  it("matches local names heuristically and honestly", () => {
    expect(matchHfLocal("Qwen/Qwen2.5-Coder-1.5B", ["qwen2.5-coder:1.5b"])?.matchedName).toBe("qwen2.5-coder:1.5b");
    expect(matchHfLocal("meta-llama/Llama-3.1-8B", ["llama3.1:8b"])?.matchedName).toBe("llama3.1:8b");
    expect(matchHfLocal("meta-llama/Llama-3.1-8B", ["mistral:7b"])).toBeNull();
  });

  it("projects onto MarketplaceItem as a model with download disabled", () => {
    const item = hfModelToMarketplaceItem(normalizeHfModel(HF_SEARCH_FIXTURE[0], retrievedAt, "LIVE"), retrievedAt);
    expect(item.id).toBe("huggingface:Qwen/Qwen2.5-Coder-1.5B");
    expect(item.category).toBe("models");
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
    expect(item.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(item.permissions).toHaveLength(9);
  });
});
