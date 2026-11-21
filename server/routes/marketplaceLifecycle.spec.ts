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

  it("serializes overlapping update and uninstall so durable state cannot be resurrected", async () => {
    const installResponse = await post("install");
    expect(installResponse.status).toBe(200);

    const [updateResponse, uninstallResponse] = await Promise.all([post("update"), post("uninstall")]);
    expect([200, 409]).toContain(updateResponse.status);
    expect(uninstallResponse.status).toBe(200);

    const healthResponse = await fetch(`${baseUrl}/api/workspace/marketplace/items/${encodeURIComponent(ITEM_ID)}/health`);
    expect(healthResponse.status).toBe(404);
    await expect(healthResponse.json()).resolves.toMatchObject({ ok: false, installed: false });

    const registry = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kforge", "marketplace-registry.json"), "utf8")) as { items: Array<{ id?: string }> };
    expect(registry.items.filter((entry) => entry.id === ITEM_ID)).toHaveLength(0);
  }, 30_000);

  it("records every confirmed lifecycle mutation as real persisted task evidence and keeps refusals out of history", async () => {
    const { flushTaskStore, initializeTaskStore, listTasks } = await import("../services/tasks");
    // The router module may already have bound the task store to another
    // suite's workspace; rebind it to this test's isolated root so the
    // recorded history is provably durable in this workspace's ledger file.
    await initializeTaskStore(workspaceRoot);

    const refused = await post("install", false);
    expect(refused.status).toBe(400);
    await flushTaskStore();
    expect(listTasks("online"), "a refused mutation must not invent history").toHaveLength(0);

    const installResponse = await post("install");
    expect(installResponse.status).toBe(200);
    const installBody = await installResponse.json() as { operationId: string };
    await flushTaskStore();
    const afterInstall = listTasks("online");
    expect(afterInstall).toHaveLength(1);
    expect(afterInstall[0]).toMatchObject({ kind: "install", status: "succeeded", progress: 100 });
    expect(afterInstall[0].output).toContain(installBody.operationId);
    expect(afterInstall[0].output).toContain(ITEM_ID);
    const durable = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kforge", "tasks.json"), "utf8")) as { tasks: Array<{ kind: string }> };
    expect(durable.tasks.filter((task) => task.kind === "install")).toHaveLength(1);

    const runResponse = await post("run");
    expect(runResponse.status).toBe(200);
    await flushTaskStore();
    const afterRun = listTasks("online");
    expect(afterRun).toHaveLength(2);
    expect(afterRun.find((task) => task.kind === "package-run")).toMatchObject({ status: "succeeded" });

    const uninstallResponse = await post("uninstall");
    expect(uninstallResponse.status).toBe(200);
    await flushTaskStore();
    const afterUninstall = listTasks("online");
    expect(afterUninstall).toHaveLength(3);
    expect(afterUninstall.find((task) => task.kind === "uninstall")).toMatchObject({ status: "succeeded" });

    // A real failed operation is recorded as failed evidence, never hidden.
    const missingRun = await post("run");
    expect(missingRun.status).toBe(422);
    await flushTaskStore();
    const afterMissingRun = listTasks("online");
    expect(afterMissingRun).toHaveLength(4);
    const failedRun = afterMissingRun.filter((task) => task.kind === "package-run").sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    expect(failedRun.status).toBe("failed");
    expect(failedRun.error).toBeTruthy();
  }, 30_000);
});
