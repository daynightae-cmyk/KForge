import express from "express";
import { once } from "events";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import marketplaceLifecycleRouter from "./marketplaceLifecycle";

const ITEM_ID = "package:kforge:json-inspector";

describe("Marketplace lifecycle API", () => {
  let workspaceRoot = "";
  let server: Server | null = null;
  let baseUrl = "";
  let previousRoot: string | undefined;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-marketplace-api-"));
    previousRoot = process.env.KFORGE_WORKSPACE_ROOT;
    process.env.KFORGE_WORKSPACE_ROOT = workspaceRoot;

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/workspace/marketplace", marketplaceLifecycleRouter);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Marketplace test server did not expose a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      server.close();
      await once(server, "close");
      server = null;
    }
    if (previousRoot === undefined) delete process.env.KFORGE_WORKSPACE_ROOT;
    else process.env.KFORGE_WORKSPACE_ROOT = previousRoot;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function post(action: string, confirmed = true) {
    return fetch(`${baseUrl}/api/workspace/marketplace/items/${encodeURIComponent(ITEM_ID)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed }),
    });
  }

  it("blocks every mutation without explicit confirmation", async () => {
    const response = await post("install", false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "MARKETPLACE_CONFIRMATION_REQUIRED" });
  });

  it("executes install → health → run → update → uninstall through the real API", async () => {
    const installResponse = await post("install");
    expect(installResponse.status).toBe(200);
    await expect(installResponse.json()).resolves.toMatchObject({ stage: "INSTALLED", installed: true, integrityVerified: true, sizeVerified: true });

    const healthResponse = await fetch(`${baseUrl}/api/workspace/marketplace/items/${encodeURIComponent(ITEM_ID)}/health`);
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({ ok: true, installed: true, version: "1.0.0" });

    const runResponse = await post("run");
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toMatchObject({ ok: true, result: { result: "json-inspection-complete", version: "1.0.0" } });

    const updateResponse = await post("update");
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({ stage: "UPDATED", installed: true, integrityVerified: true });

    const updatedHealthResponse = await fetch(`${baseUrl}/api/workspace/marketplace/items/${encodeURIComponent(ITEM_ID)}/health`);
    expect(updatedHealthResponse.status).toBe(200);
    await expect(updatedHealthResponse.json()).resolves.toMatchObject({ ok: true, version: "1.1.0" });

    const uninstallResponse = await post("uninstall");
    expect(uninstallResponse.status).toBe(200);
    await expect(uninstallResponse.json()).resolves.toMatchObject({ stage: "UNINSTALLED", installed: false });

    const missingHealthResponse = await fetch(`${baseUrl}/api/workspace/marketplace/items/${encodeURIComponent(ITEM_ID)}/health`);
    expect(missingHealthResponse.status).toBe(404);
    await expect(missingHealthResponse.json()).resolves.toMatchObject({ ok: false, installed: false });
  }, 30_000);
});
