import { expect, test } from "@playwright/test";

/**
 * Remote-source adapters are the only KForge surfaces that may contact an
 * external provider. This spec pins the three truth contracts they must keep:
 *
 * 1. Only an explicit KForge Workbench caller may trigger a remote-source read.
 * 2. While the operating mode blocks network access, every adapter refuses with
 *    REMOTE_SOURCE_OFFLINE_BLOCKED and states that no request was made. It must
 *    never answer with fabricated catalog data.
 * 3. Local-only remote-source reads (the approved source registry and the local
 *    documentation index) keep working offline and report NOT_REQUIRED network.
 *
 * Every assertion below was first observed against the production server built
 * from the final main SHA; the suite is a regression lock, not a guess.
 */

const WORKBENCH_HEADERS = { "x-kforge-client": "workbench-v1" };

const OFFLINE_BLOCKED: { method: "GET" | "POST"; path: string; query?: string; body?: unknown }[] = [
  { method: "GET", path: "/api/workspace/remote-sources/mcp/servers", query: "search=types&limit=3" },
  { method: "GET", path: "/api/workspace/remote-sources/mcp/versions", query: "server=@modelcontextprotocol/server-filesystem" },
  { method: "GET", path: "/api/workspace/remote-sources/mcp/version", query: "server=@modelcontextprotocol/server-filesystem&version=0.6.2" },
  { method: "GET", path: "/api/workspace/remote-sources/mcp/versions", query: "server=io.github.owner/filesystem" },
  { method: "GET", path: "/api/workspace/remote-sources/open-vsx/search", query: "query=python" },
  { method: "GET", path: "/api/workspace/remote-sources/open-vsx/extension", query: "namespace=ms-python&extension=python&version=2024.2.0" },
  { method: "GET", path: "/api/workspace/remote-sources/open-vsx/versions", query: "namespace=ms-python&extension=python" },
  { method: "GET", path: "/api/workspace/remote-sources/open-vsx/version", query: "namespace=ms-python&extension=python&version=2024.2.0" },
  { method: "POST", path: "/api/workspace/remote-sources/osv/query", body: { package: { ecosystem: "npm", name: "express" } } },
  { method: "POST", path: "/api/workspace/remote-sources/osv/querybatch", body: { queries: [{ ecosystem: "npm", name: "express" }] } },
  { method: "GET", path: "/api/workspace/remote-sources/osv/vuln", query: "id=GHSA-jf85-cpcp-j695" },
  { method: "GET", path: "/api/workspace/remote-sources/huggingface/models", query: "search=llama&limit=3" },
  { method: "GET", path: "/api/workspace/remote-sources/huggingface/model", query: "id=codellama/CodeLlama-7b-hf" },
  { method: "GET", path: "/api/workspace/remote-sources/kforge-updates/releases" },
  { method: "GET", path: "/api/workspace/remote-sources/kforge-updates/release", query: "tag=v0.1.0" },
  { method: "GET", path: "/api/workspace/remote-sources/kforge-updates/status" },
  { method: "POST", path: "/api/workspace/remote-sources/documentation/refresh", body: { sourceId: "hf-openapi" } },
  { method: "GET", path: "/api/workspace/remote-sources/npm/search", query: "text=express&size=3" },
  { method: "GET", path: "/api/workspace/remote-sources/npm/package", query: "name=express" },
  { method: "GET", path: "/api/workspace/remote-sources/npm/version", query: "name=express&version=5.3.0" },
  { method: "GET", path: "/api/workspace/remote-sources/pypi/search", query: "text=requests" },
  { method: "GET", path: "/api/workspace/remote-sources/pypi/package", query: "name=requests&version=2.32.3" },
  { method: "GET", path: "/api/workspace/remote-sources/nuget/search", query: "q=Newtonsoft.Json&take=3" },
  { method: "GET", path: "/api/workspace/remote-sources/nuget/registration", query: "id=Newtonsoft.Json" },
  { method: "GET", path: "/api/workspace/remote-sources/winget/search", query: "q=Git.Git&limit=3" },
  { method: "GET", path: "/api/workspace/remote-sources/winget/manifest", query: "packageId=Git.Git&version=2.44.7" },
];

test.describe("KForge remote-source truth contracts", () => {
  test.beforeEach(async ({ page }) => {
    const mode = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(mode.ok(), await mode.text()).toBeTruthy();
  });

  test("rejects remote-source reads without the explicit Workbench caller marker", async ({ page }) => {
    const response = await page.request.get("/api/workspace/remote-sources/mcp/servers?search=types");
    expect(response.status()).toBe(403);
    const payload = await response.json() as { code?: string; error?: string };
    expect(payload.code).toBe("REMOTE_SOURCE_CALLER_REQUIRED");
    expect(payload.error).toMatch(/explicit KForge Workbench caller marker/i);
  });

  test("refuses every networked adapter while the operating mode blocks network access", async ({ page }) => {
    for (const adapter of OFFLINE_BLOCKED) {
      const url = adapter.query ? `${adapter.path}?${adapter.query}` : adapter.path;
      const response = adapter.method === "POST"
        ? await page.request.post(url, { headers: WORKBENCH_HEADERS, data: adapter.body })
        : await page.request.get(url, { headers: WORKBENCH_HEADERS });
      const label = `${adapter.method} ${url}`;
      expect(response.status(), `${label} must be refused while offline`).toBe(403);
      const payload = await response.json() as { code?: string; error?: string };
      expect(payload.code, `${label} must carry the offline-blocked contract`).toBe("REMOTE_SOURCE_OFFLINE_BLOCKED");
      expect(payload.error, `${label} must state that no request was made`).toMatch(/No request was made/i);
    }
  });

  test("keeps the approved source registry and local documentation index readable offline", async ({ page }) => {
    const registry = await page.request.get("/api/workspace/remote-sources", { headers: WORKBENCH_HEADERS });
    expect(registry.ok(), await registry.text()).toBeTruthy();
    const registryPayload = await registry.json() as { sources?: unknown[]; transparency?: { network?: string; execution?: string } };
    expect(Array.isArray(registryPayload.sources)).toBeTruthy();
    expect(registryPayload.sources?.length ?? 0).toBeGreaterThan(0);
    expect(registryPayload.transparency?.network).toBe("NOT_REQUIRED");
    expect(registryPayload.transparency?.execution).toBe("LOCAL");

    const sources = await page.request.get("/api/workspace/remote-sources/documentation/sources", { headers: WORKBENCH_HEADERS });
    expect(sources.ok(), await sources.text()).toBeTruthy();
    const sourcesPayload = await sources.json() as { sources?: { id: string; allowedOrigins?: string[] }[] };
    expect(sourcesPayload.sources?.length ?? 0).toBeGreaterThan(0);

    const search = await page.request.get("/api/workspace/remote-sources/documentation/search?q=install", { headers: WORKBENCH_HEADERS });
    expect(search.ok(), await search.text()).toBeTruthy();
    const searchPayload = await search.json() as { evidence?: { network?: string }; query?: string; searchedSources?: unknown[] };
    expect(searchPayload.query).toBe("install");
    expect(searchPayload.evidence?.network).toBe("NOT_REQUIRED");
  });

  test("rejects a documentation refresh for a source outside the allowlist", async ({ page }) => {
    const response = await page.request.post("/api/workspace/remote-sources/documentation/refresh", {
      headers: WORKBENCH_HEADERS,
      data: { sourceId: "not-an-allowlisted-source" },
    });
    expect(response.status()).toBe(400);
    const payload = await response.json() as { code?: string; error?: string };
    expect(payload.code).toBe("REMOTE_SOURCE_BAD_REQUEST");
    expect(payload.error).toMatch(/allowlist/i);
  });
});
