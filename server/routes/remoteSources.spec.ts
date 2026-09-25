import express from "express";
import { once } from "events";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import remoteSourcesRouter from "./remoteSources";
import { MCP_LIST_FIXTURE } from "../services/remoteSources/adapters/fixtures/mcpRegistryFixtures";
import { OVSX_EXTENSION_FIXTURE, OVSX_SEARCH_FIXTURE, OVSX_VERSIONS_FIXTURE } from "../services/remoteSources/adapters/fixtures/openVsxFixtures";
import { OSV_BATCH_FIXTURE, OSV_QUERY_FIXTURE, OSV_VULN_FIXTURE } from "../services/remoteSources/adapters/fixtures/osvFixtures";
import { HF_DETAIL_FIXTURE, HF_SEARCH_FIXTURE } from "../services/remoteSources/adapters/fixtures/huggingFaceFixtures";
import { KFORGE_RELEASES_FIXTURE, KFORGE_RELEASE_DETAIL_FIXTURE } from "../services/remoteSources/adapters/fixtures/githubReleasesFixtures";
import { DOCS_OPENAPI_FIXTURE } from "../services/remoteSources/adapters/fixtures/documentationFixtures";
import { NPM_PACKAGE_FIXTURE, NPM_SEARCH_FIXTURE, NPM_VERSION_FIXTURE } from "../services/remoteSources/adapters/fixtures/npmFixtures";
import { PYPI_PACKAGE_FIXTURE } from "../services/remoteSources/adapters/fixtures/pypiFixtures";
import { NUGET_REGISTRATION_FIXTURE, NUGET_SEARCH_FIXTURE } from "../services/remoteSources/adapters/fixtures/nugetFixtures";
import { WINGET_MANIFEST_FIXTURE, WINGET_SEARCH_FIXTURE } from "../services/remoteSources/adapters/fixtures/wingetFixtures";

vi.mock("dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

// The provider fetch is stubbed per-test; the spec's own HTTP calls to the
// local test server must keep using the real fetch implementation.
const realFetch = globalThis.fetch.bind(globalThis);

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-KForge-Client", "workbench-v1");
  return realFetch(input, { ...init, headers });
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function textResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "Content-Type": "text/plain", ...(init.headers ?? {}) },
  });
}

/** Exact-host test routing: substring host checks would also match lookalike origins. */
function isOvsxTestUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "open-vsx.org";
  } catch {
    return false;
  }
}

function osvTestFixture(url: string): unknown {
  if (url.endsWith("/v1/querybatch")) return OSV_BATCH_FIXTURE;
  if (url.includes("/v1/vulns/")) return OSV_VULN_FIXTURE;
  return OSV_QUERY_FIXTURE;
}

function isOsvTestUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.osv.dev";
  } catch {
    return false;
  }
}

function isHfTestUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "huggingface.co";
  } catch {
    return false;
  }
}

function isKforgeUpdatesTestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.github.com" && parsed.pathname.startsWith("/repos/daynightae-cmyk/KForge/releases");
  } catch {
    return false;
  }
}

function isDocsTestUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "huggingface.co" || hostname === "open-vsx.org" || hostname === "developers.openai.com" || hostname === "raw.githubusercontent.com";
  } catch {
    return false;
  }
}

function isNpmTestUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "registry.npmjs.org";
  } catch {
    return false;
  }
}

function npmTestFixture(url: string): unknown {
  if (url.includes("/-/v1/search")) return NPM_SEARCH_FIXTURE;
  if (url.match(/\/[^/]+\/[^/]+$/)) return NPM_VERSION_FIXTURE;
  return NPM_PACKAGE_FIXTURE;
}

function isPypiTestUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "pypi.org";
  } catch {
    return false;
  }
}

function isNugetTestUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "api.nuget.org" || hostname === "azuresearch-usnc.nuget.org" || hostname === "azuresearch-ussc.nuget.org";
  } catch {
    return false;
  }
}

function nugetTestFixture(url: string): unknown {
  if (url.includes("/query")) return NUGET_SEARCH_FIXTURE;
  return NUGET_REGISTRATION_FIXTURE;
}

function isWingetTestUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === "api.github.com" && u.pathname.startsWith("/repos/microsoft/winget-pkgs/contents/manifests/")) return true;
    if (u.hostname === "raw.githubusercontent.com" && u.pathname.includes("winget-pkgs")) return true;
    return false;
  } catch {
    return false;
  }
}

function wingetTestFixture(url: string): unknown {
  if (new URL(url).hostname === "api.github.com") return WINGET_SEARCH_FIXTURE;
  return WINGET_MANIFEST_FIXTURE;
}

function isWingetManifestUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "raw.githubusercontent.com" && new URL(url).pathname.includes("winget-pkgs");
  } catch {
    return false;
  }
}

function hfTestFixture(url: string): unknown {
  if (url.includes("/api/models/")) return HF_DETAIL_FIXTURE;
  return HF_SEARCH_FIXTURE;
}

function kforgeUpdatesTestFixture(url: string): unknown {
  if (url.includes("/releases/tags/")) return KFORGE_RELEASE_DETAIL_FIXTURE;
  return KFORGE_RELEASES_FIXTURE;
}

/** Provider-destined stub calls only: local loopback probes are not external requests. */
function hfCallCount(stub: { mock: { calls: unknown[][] } }): number {
  return stub.mock.calls.filter((call) => {
    try {
      return new URL(String(call[0])).hostname === "huggingface.co";
    } catch {
      return false;
    }
  }).length;
}

describe("Remote sources API", () => {
  let workspaceRoot = "";
  let server: Server | null = null;
  let baseUrl = "";
  let previousRoot: string | undefined;
  let fetchStub = vi.fn(async (url: string) => {
    if (url === "https://huggingface.co/.well-known/openapi.json") return textResponse(DOCS_OPENAPI_FIXTURE, { headers: { etag: '"docs-1"' } });
    if (isOsvTestUrl(url)) return jsonResponse(osvTestFixture(url));
    if (isHfTestUrl(url)) return jsonResponse(hfTestFixture(url));
    if (isKforgeUpdatesTestUrl(url)) return jsonResponse(kforgeUpdatesTestFixture(url));
    if (isNpmTestUrl(url)) return jsonResponse(npmTestFixture(url));
    if (isPypiTestUrl(url)) return jsonResponse(PYPI_PACKAGE_FIXTURE);
    if (isNugetTestUrl(url)) return jsonResponse(nugetTestFixture(url));
    if (isWingetTestUrl(url)) return isWingetManifestUrl(url) ? textResponse(String(wingetTestFixture(url))) : jsonResponse(wingetTestFixture(url));
    return isOvsxTestUrl(url) ? jsonResponse(OVSX_SEARCH_FIXTURE) : jsonResponse(MCP_LIST_FIXTURE);
  });

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-remote-api-"));
    previousRoot = process.env.KFORGE_WORKSPACE_ROOT;
    process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
    fetchStub = vi.fn(async (url: string) => {
      if (url === "https://huggingface.co/.well-known/openapi.json") return textResponse(DOCS_OPENAPI_FIXTURE, { headers: { etag: '"docs-1"' } });
      if (isOsvTestUrl(url)) return jsonResponse(osvTestFixture(url));
      if (isHfTestUrl(url)) return jsonResponse(hfTestFixture(url));
      if (isKforgeUpdatesTestUrl(url)) return jsonResponse(kforgeUpdatesTestFixture(url));
      if (isNpmTestUrl(url)) return jsonResponse(npmTestFixture(url));
      if (isPypiTestUrl(url)) return jsonResponse(PYPI_PACKAGE_FIXTURE);
      if (isNugetTestUrl(url)) return jsonResponse(nugetTestFixture(url));
      if (isWingetTestUrl(url)) return isWingetManifestUrl(url) ? textResponse(String(wingetTestFixture(url))) : jsonResponse(wingetTestFixture(url));
      return isOvsxTestUrl(url) ? jsonResponse(OVSX_SEARCH_FIXTURE) : jsonResponse(MCP_LIST_FIXTURE);
    });
    vi.stubGlobal("fetch", fetchStub);

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/workspace", remoteSourcesRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Remote sources test server did not expose a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (server) {
      server.close();
      await once(server, "close");
      server = null;
    }
    if (previousRoot === undefined) delete process.env.KFORGE_WORKSPACE_ROOT;
    else process.env.KFORGE_WORKSPACE_ROOT = previousRoot;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function setMode(mode: string) {
    await fs.mkdir(path.join(workspaceRoot, ".kforge"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".kforge", "local-platform.json"), JSON.stringify({ mode }), "utf8");
  }

  it("rejects unmarked and cross-site callers before any remote contact", async () => {
    await setMode("online-optional");
    const before = fetchStub.mock.calls.length;

    const unmarked = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?search=fs`);
    expect(unmarked.status).toBe(403);
    await expect(unmarked.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_CALLER_REQUIRED" });

    const crossSite = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?search=fs`, {
      headers: {
        "X-KForge-Client": "workbench-v1",
        "Origin": "https://malicious.example",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(crossSite.status).toBe(403);
    await expect(crossSite.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_CALLER_REJECTED" });
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("lists approved sources locally without contacting any provider", async () => {
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: Array<{ id: string }> };
    expect(body.sources.map((source) => source.id)).toEqual(["mcp-official-registry", "open-vsx", "osv", "hugging-face-hub", "github-releases-kforge", "remote-doc-openapi", "npm-registry", "pypi", "nuget-v3", "winget-community"]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses explicit search in OFFLINE mode with zero external requests", async () => {
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?search=fs`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("searches the MCP Registry explicitly in online-optional mode", async () => {
    await setMode("online-optional");
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?search=fs&limit=10`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ id: string; availability: string }>; evidence: { freshness: string } };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe("mcp:io.github.owner/filesystem");
    expect(body.items[0].availability).toBe("CATALOG");
    expect(body.evidence.freshness).toBe("CURRENT");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const contacts = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kforge", "network-contacts.json"), "utf8")) as Record<string, unknown>;
    expect(contacts).toHaveProperty("contacts.marketplace-registry");
  });

  it("validates query bounds before any request", async () => {
    await setMode("online-optional");
    const badLimit = await apiFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?limit=500`);
    expect(badLimit.status).toBe(400);
    const missingServer = await apiFetch(`${baseUrl}/api/workspace/remote-sources/mcp/versions`);
    expect(missingServer.status).toBe(400);
    const unsafeServer = await apiFetch(`${baseUrl}/api/workspace/remote-sources/mcp/versions?server=../../etc`);
    expect(unsafeServer.status).toBe(400);
    const badSize = await apiFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/search?size=500`);
    expect(badSize.status).toBe(400);
    const missingNamespace = await apiFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/extension?extension=only`);
    expect(missingNamespace.status).toBe(400);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses Open VSX search in OFFLINE mode with zero external requests", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/search?query=yaml`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("searches Open VSX explicitly in online-optional mode", async () => {
    await setMode("online-optional");
    const before = fetchStub.mock.calls.length;
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/search?query=yaml&size=10`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ id: string; availability: string }>; evidence: { freshness: string } };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe("openvsx:redhat/vscode-yaml");
    expect(body.items[0].availability).toBe("CATALOG");
    expect(body.evidence.freshness).toBe("CURRENT");
    expect(fetchStub.mock.calls.length).toBeGreaterThan(before);
  });

  it("reads Open VSX extension detail and version references explicitly", async () => {
    await setMode("online-optional");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/versions")) return jsonResponse(OVSX_VERSIONS_FIXTURE);
        if (String(url).includes("/api/redhat/")) return jsonResponse(OVSX_EXTENSION_FIXTURE);
        return jsonResponse(OVSX_SEARCH_FIXTURE);
      }),
    );
    const detail = await apiFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/extension?namespace=redhat&extension=vscode-yaml`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { item: { version: string; availability: string } };
    expect(detailBody.item.version).toBe("1.18.0");
    expect(detailBody.item.availability).toBe("CATALOG");
    const versions = await apiFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/versions?namespace=redhat&extension=vscode-yaml`);
    expect(versions.status).toBe(200);
    await expect(versions.json()).resolves.toMatchObject({ versions: ["1.18.0", "1.17.0", "1.16.0"] });
  });

  it("refuses OSV queries in OFFLINE mode with zero external requests", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { ecosystem: "npm", name: "test-package", version: "1.0.0" } }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("queries OSV explicitly in online-optional mode without modifying manifests", async () => {
    await setMode("online-optional");
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { ecosystem: "npm", name: "test-package", version: "1.0.0" } }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      advisories: Array<{ id: string; fixedVersions: string[] }>;
      evidence: { freshness: string };
      transparency: { purpose: string };
    };
    expect(body.advisories.map((advisory) => advisory.id)).toEqual(["GHSA-test-0001", "PYSEC-test-0002"]);
    expect(body.advisories[0].fixedVersions).toEqual(["1.2.3"]);
    expect(body.evidence.freshness).toBe("CURRENT");
    expect(body.transparency.purpose).toMatch(/no manifest was modified/i);
  });

  it("validates OSV request shapes before any request", async () => {
    await setMode("online-optional");
    const before = fetchStub.mock.calls.length;
    const missingSelector = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { version: "1.0.0" } }),
    });
    expect(missingSelector.status).toBe(400);
    const emptyBatch = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [] }),
    });
    expect(emptyBatch.status).toBe(400);
    const unsafeId = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/vuln?id=../../etc`);
    expect(unsafeId.status).toBe(400);
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("reads OSV batch and vulnerability detail explicitly", async () => {
    await setMode("online-optional");
    const batch = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ ecosystem: "npm", name: "test-package", version: "1.0.0" }] }),
    });
    expect(batch.status).toBe(200);
    await expect(batch.json()).resolves.toMatchObject({ results: [{ advisories: [{ id: "GHSA-test-0001" }] }] });
    const vuln = await apiFetch(`${baseUrl}/api/workspace/remote-sources/osv/vuln?id=GHSA-test-0001`);
    expect(vuln.status).toBe(200);
    await expect(vuln.json()).resolves.toMatchObject({ advisory: { id: "GHSA-test-0001" } });
  });

  it("refuses Hugging Face search in OFFLINE mode with zero external requests", async () => {
    const before = hfCallCount(fetchStub);
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/huggingface/models?search=coder`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(hfCallCount(fetchStub)).toBe(before);
  });

  it("searches Hugging Face explicitly in online-optional mode as catalog only", async () => {
    await setMode("online-optional");
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/huggingface/models?search=coder&limit=10`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      models: Array<{ modelId: string; revision?: string }>;
      items: Array<{ id: string; availability: string; installed: boolean }>;
      localRuntimeChecked: boolean;
      evidence: { freshness: string };
    };
    expect(body.models.map((model) => model.modelId)).toEqual(["Qwen/Qwen2.5-Coder-1.5B", "acme/minimal-gated"]);
    expect(body.items[0].id).toBe("huggingface:Qwen/Qwen2.5-Coder-1.5B");
    expect(body.items[0].availability).toBe("CATALOG");
    expect(body.items[0].installed).toBe(false);
    expect(typeof body.localRuntimeChecked).toBe("boolean");
    expect(body.evidence.freshness).toBe("CURRENT");
  });

  it("validates Hugging Face request shapes before any request", async () => {
    await setMode("online-optional");
    const before = hfCallCount(fetchStub);
    const badLimit = await apiFetch(`${baseUrl}/api/workspace/remote-sources/huggingface/models?limit=500`);
    expect(badLimit.status).toBe(400);
    const badSort = await apiFetch(`${baseUrl}/api/workspace/remote-sources/huggingface/models?sort=nope`);
    expect(badSort.status).toBe(400);
    const badId = await apiFetch(`${baseUrl}/api/workspace/remote-sources/huggingface/model?id=../../etc`);
    expect(badId.status).toBe(400);
    expect(hfCallCount(fetchStub)).toBe(before);
  });

  it("reads Hugging Face model detail explicitly", async () => {
    await setMode("online-optional");
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/huggingface/model?id=Qwen/Qwen2.5-Coder-1.5B`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ model: { modelId: "Qwen/Qwen2.5-Coder-1.5B" } });
  });

  it("refuses KForge update discovery in OFFLINE mode with zero external requests", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/kforge-updates/status`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("discovers KForge releases explicitly in online-optional mode", async () => {
    await setMode("online-optional");
    const releases = await apiFetch(`${baseUrl}/api/workspace/remote-sources/kforge-updates/releases?channel=stable`);
    expect(releases.status).toBe(200);
    const releasesBody = (await releases.json()) as { releases: Array<{ tag: string; channel: string }> };
    expect(releasesBody.releases.map((release) => release.tag)).toEqual(["v0.1.0", "v0.2.0"]);

    // Installed version is package.json 0.1.0; fixture latest stable is v0.2.0.
    const status = await apiFetch(`${baseUrl}/api/workspace/remote-sources/kforge-updates/status`);
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as {
      decision: { availability: string; trustedUpdate: string; trustedBlockers: Array<{ id: string }> };
    };
    expect(statusBody.decision.availability).toBe("UPDATE_AVAILABLE");
    expect(statusBody.decision.trustedUpdate).toBe("BLOCKED");
    expect(statusBody.decision.trustedBlockers.map((blocker) => blocker.id)).toEqual([
      "checksum-unverified",
      "signature-unavailable",
      "workflow-unimplemented",
    ]);
  });

  it("validates KForge update request shapes before any request", async () => {
    await setMode("online-optional");
    const before = fetchStub.mock.calls.length;
    const badPage = await apiFetch(`${baseUrl}/api/workspace/remote-sources/kforge-updates/releases?per_page=500`);
    expect(badPage.status).toBe(400);
    const badChannel = await apiFetch(`${baseUrl}/api/workspace/remote-sources/kforge-updates/releases?channel=nightly`);
    expect(badChannel.status).toBe(400);
    const unsafeTag = await apiFetch(`${baseUrl}/api/workspace/remote-sources/kforge-updates/release?tag=../../etc`);
    expect(unsafeTag.status).toBe(400);
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("lists documentation sources locally without contacting any provider", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/documentation/sources`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: Array<{ id: string; url: string }> };
    expect(body.sources.map((source) => source.id)).toEqual([
      "hf-openapi",
      "mcp-registry-openapi",
      "openvsx-openapi",
      "ollama-openapi",
      "openai-llms-full",
    ]);
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("refuses documentation refresh in OFFLINE mode with zero external requests", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await apiFetch(`${baseUrl}/api/workspace/remote-sources/documentation/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "hf-openapi" }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("refreshes an allowlisted document explicitly and searches cache locally", async () => {
    await setMode("online-optional");
    const refresh = await apiFetch(`${baseUrl}/api/workspace/remote-sources/documentation/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "hf-openapi" }),
    });
    expect(refresh.status).toBe(200);
    const refreshBody = (await refresh.json()) as {
      record: { title: string; version: string; canonicalUrl: string; contentHash: string };
      evidence: { freshness: string };
    };
    expect(refreshBody.record.title).toBe("Fixture Provider API");
    expect(refreshBody.record.contentHash).toHaveLength(64);
    expect(refreshBody.evidence.freshness).toBe("CURRENT");

    const callsAfterRefresh = fetchStub.mock.calls.length;
    const search = await apiFetch(`${baseUrl}/api/workspace/remote-sources/documentation/search?q=${encodeURIComponent("pagination")}`);
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { hits: Array<{ sourceId: string }>; searchedSources: number };
    expect(searchBody.hits.map((hit) => hit.sourceId)).toEqual(["hf-openapi"]);
    expect(searchBody.searchedSources).toBe(1);
    expect(fetchStub.mock.calls.length).toBe(callsAfterRefresh);
  });

  it("looks up WinGet versions and manifest through the guarded exact-ID routes", async () => {
    await setMode("online-optional");

    const search = await apiFetch(`${baseUrl}/api/workspace/remote-sources/winget/search?q=Git.Git`);
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { items: Array<{ id: string }> };
    expect(searchBody.items.map((item) => item.id)).toEqual([
      "winget:Git.Git@2.44.0",
      "winget:Git.Git@2.43.0",
    ]);

    const manifest = await apiFetch(`${baseUrl}/api/workspace/remote-sources/winget/manifest?packageId=Git.Git&version=2.44.0`);
    expect(manifest.status).toBe(200);
    await expect(manifest.json()).resolves.toMatchObject({
      item: { id: "winget:Git.Git@2.44.0" },
      manifest: { packageIdentifier: "Git.Git", packageVersion: "2.44.0" },
    });
  });

  it("validates documentation request shapes before any request", async () => {
    await setMode("online-optional");
    const before = fetchStub.mock.calls.length;
    const unknownSource = await apiFetch(`${baseUrl}/api/workspace/remote-sources/documentation/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "not-a-source" }),
    });
    expect(unknownSource.status).toBe(400);
    const missingQuery = await apiFetch(`${baseUrl}/api/workspace/remote-sources/documentation/search`);
    expect(missingQuery.status).toBe(400);
    expect(fetchStub.mock.calls.length).toBe(before);
  });
});
