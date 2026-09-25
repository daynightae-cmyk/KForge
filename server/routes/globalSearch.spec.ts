import type { AddressInfo } from "net";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../index";
import type { GlobalSearchResponse } from "../../shared/workspace";
import { remoteCacheKey, writeRemoteCache } from "../services/remoteSources/cacheStore";
import { REMOTE_DOC_SOURCE_ID } from "../services/remoteSources/adapters/documentation";

afterEach(() => vi.unstubAllEnvs());

describe("Global Search evidence contract", () => {
  it("returns bounded source coverage and capability navigation for real local entities", async () => {
    vi.stubEnv("KFORGE_WORKSPACE_ROOT", path.resolve(process.cwd(), "fixtures"));
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/workspace/search?q=message`);
      expect(response.status).toBe(200);
      const payload = await response.json() as GlobalSearchResponse;
      expect(payload.query).toBe("message");
      expect(payload.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: "Symbols", title: "message", target: "Project graph", source: expect.stringContaining("project graph") }),
      ]));
      expect(Object.keys(payload.coverage)).toEqual(expect.arrayContaining(["Projects", "Files", "Symbols", "APIs", "Routes", "Problems", "Tasks", "Agents", "Models", "Marketplace", "Git", "GitHub", "Release", "Documentation", "Dependencies", "Technologies", "Results"]));
      expect(payload.coverage.Symbols?.searchedCount).toBeGreaterThan(0);
      expect(payload.coverage.Problems?.reason).toContain("typing did not start hidden scans");
      expect(payload.coverage.Models?.reason).toContain("did not contact a remote registry");
      expect(payload.coverage.Results?.totalOrUnknown).toBe(payload.results.length);
      const agentResponse = await fetch(`http://127.0.0.1:${address.port}/api/workspace/search?q=audit`);
      const agentPayload = await agentResponse.json() as GlobalSearchResponse;
      expect(agentPayload.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: "Agents", entityId: "audit", target: "Agents" }),
      ]));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 45_000);

  it("enriches Documentation with cached remote provider docs without network contact", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-global-search-docs-"));
    try {
      vi.stubEnv("KFORGE_WORKSPACE_ROOT", workspaceRoot);
      await writeRemoteCache(workspaceRoot, {
        sourceId: REMOTE_DOC_SOURCE_ID,
        key: remoteCacheKey([REMOTE_DOC_SOURCE_ID, "document", "hf-openapi"]),
        url: "https://huggingface.co/.well-known/openapi.json",
        fetchedAt: new Date().toISOString(),
        data: { text: JSON.stringify({ openapi: "3.1.0", info: { title: "Searchable Fixture API", version: "9.9.9" } }) },
      });
      const server = createServer().listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      try {
        const address = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${address.port}/api/workspace/search?q=searchable`);
        expect(response.status).toBe(200);
        const payload = await response.json() as GlobalSearchResponse;
        expect(payload.results).toEqual(expect.arrayContaining([
          expect.objectContaining({ entity: "Documentation", entityId: "remote-doc:hf-openapi", target: "Online Documentation" }),
        ]));
        expect(payload.coverage.Documentation?.reason).toContain("cached remote-doc");
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 45_000);
});
