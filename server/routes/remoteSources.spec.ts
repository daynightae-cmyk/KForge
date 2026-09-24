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

vi.mock("dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

// The provider fetch is stubbed per-test; the spec's own HTTP calls to the
// local test server must keep using the real fetch implementation.
const realFetch = globalThis.fetch.bind(globalThis);

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
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

describe("Remote sources API", () => {
  let workspaceRoot = "";
  let server: Server | null = null;
  let baseUrl = "";
  let previousRoot: string | undefined;
  let fetchStub = vi.fn(async (url: string) => {
    if (isOsvTestUrl(url)) return jsonResponse(osvTestFixture(url));
    return isOvsxTestUrl(url) ? jsonResponse(OVSX_SEARCH_FIXTURE) : jsonResponse(MCP_LIST_FIXTURE);
  });

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-remote-api-"));
    previousRoot = process.env.KFORGE_WORKSPACE_ROOT;
    process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
    fetchStub = vi.fn(async (url: string) => {
      if (isOsvTestUrl(url)) return jsonResponse(osvTestFixture(url));
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

  it("lists approved sources locally without contacting any provider", async () => {
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sources: Array<{ id: string }> };
    expect(body.sources.map((source) => source.id)).toEqual(["mcp-official-registry", "open-vsx", "osv"]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses explicit search in OFFLINE mode with zero external requests", async () => {
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?search=fs`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("searches the MCP Registry explicitly in online-optional mode", async () => {
    await setMode("online-optional");
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?search=fs&limit=10`);
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
    const badLimit = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/servers?limit=500`);
    expect(badLimit.status).toBe(400);
    const missingServer = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/versions`);
    expect(missingServer.status).toBe(400);
    const unsafeServer = await realFetch(`${baseUrl}/api/workspace/remote-sources/mcp/versions?server=../../etc`);
    expect(unsafeServer.status).toBe(400);
    const badSize = await realFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/search?size=500`);
    expect(badSize.status).toBe(400);
    const missingNamespace = await realFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/extension?extension=only`);
    expect(missingNamespace.status).toBe(400);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses Open VSX search in OFFLINE mode with zero external requests", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/search?query=yaml`);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "REMOTE_SOURCE_OFFLINE_BLOCKED" });
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("searches Open VSX explicitly in online-optional mode", async () => {
    await setMode("online-optional");
    const before = fetchStub.mock.calls.length;
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/search?query=yaml&size=10`);
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
    const detail = await realFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/extension?namespace=redhat&extension=vscode-yaml`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { item: { version: string; availability: string } };
    expect(detailBody.item.version).toBe("1.18.0");
    expect(detailBody.item.availability).toBe("CATALOG");
    const versions = await realFetch(`${baseUrl}/api/workspace/remote-sources/open-vsx/versions?namespace=redhat&extension=vscode-yaml`);
    expect(versions.status).toBe(200);
    await expect(versions.json()).resolves.toMatchObject({ versions: ["1.18.0", "1.17.0", "1.16.0"] });
  });

  it("refuses OSV queries in OFFLINE mode with zero external requests", async () => {
    const before = fetchStub.mock.calls.length;
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/query`, {
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
    const response = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/query`, {
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
    const missingSelector = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { version: "1.0.0" } }),
    });
    expect(missingSelector.status).toBe(400);
    const emptyBatch = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [] }),
    });
    expect(emptyBatch.status).toBe(400);
    const unsafeId = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/vuln?id=../../etc`);
    expect(unsafeId.status).toBe(400);
    expect(fetchStub.mock.calls.length).toBe(before);
  });

  it("reads OSV batch and vulnerability detail explicitly", async () => {
    await setMode("online-optional");
    const batch = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ ecosystem: "npm", name: "test-package", version: "1.0.0" }] }),
    });
    expect(batch.status).toBe(200);
    await expect(batch.json()).resolves.toMatchObject({ results: [{ advisories: [{ id: "GHSA-test-0001" }] }] });
    const vuln = await realFetch(`${baseUrl}/api/workspace/remote-sources/osv/vuln?id=GHSA-test-0001`);
    expect(vuln.status).toBe(200);
    await expect(vuln.json()).resolves.toMatchObject({ advisory: { id: "GHSA-test-0001" } });
  });
});
