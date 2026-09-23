import express from "express";
import { once } from "events";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import remoteSourcesRouter from "./remoteSources";
import { MCP_LIST_FIXTURE } from "../services/remoteSources/adapters/fixtures/mcpRegistryFixtures";

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

describe("Remote sources API", () => {
  let workspaceRoot = "";
  let server: Server | null = null;
  let baseUrl = "";
  let previousRoot: string | undefined;
  let fetchStub = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE));

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-remote-api-"));
    previousRoot = process.env.KFORGE_WORKSPACE_ROOT;
    process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;
    fetchStub = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE));
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
    expect(body.sources.map((source) => source.id)).toEqual(["mcp-official-registry"]);
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
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
