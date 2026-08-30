import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import type { ProjectSummary } from "../../shared/workspace";
import { revokeProjectAuthority } from "./projectAuthorityRevocation";
import { flushTaskStore, getTask, initializeTaskStore, startTask } from "./tasks";

function project(root: string): ProjectSummary {
  return {
    id: "revocation-project",
    name: "revocation-project",
    trust: "trusted",
    path: root,
    provider: "Local",
    branch: "—",
    lastActivity: new Date().toISOString(),
    projectType: "Local project",
    modifiedFiles: 0,
    untrackedFiles: 0,
    ahead: 0,
    behind: 0,
    healthScore: null,
    securityStatus: "unknown",
    buildStatus: "unknown",
    testStatus: "unknown",
    syncStatus: "unknown",
    tags: [],
    favorite: false,
    pinned: false,
    archived: false,
    categories: { recent: false, favorite: false, pinned: false, archive: false },
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not reached before timeout.");
}

describe("project authority revocation teardown", () => {
  it("cancels a task that has not started before the executor microtask runs", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-revoke-queued-"));
    try {
      await initializeTaskStore(root);
      const task = startTask("revocation-project", "scan", async () => ({ ok: true, output: "should not execute", message: "done" }));
      const report = await revokeProjectAuthority(root, project(root));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(report.tasks.cancelledBeforeExecution).toContainEqual({ id: task.id, kind: "scan", priorStatus: "queued" });
      expect(report.tasks.alreadyRunning).toEqual([]);
      expect(getTask(task.id)?.status).toBe("cancelled");
      expect(report.guarantees.alreadyRunningCommands).toBe("NOT_RETROACTIVELY_UNDONE");
    } finally {
      await flushTaskStore();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });

  it("reports a task already in execution without falsely marking it cancelled", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-revoke-running-"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await initializeTaskStore(root);
      const task = startTask("revocation-project", "scan", async () => {
        await gate;
        return { ok: true, output: "completed after revocation request", message: "done" };
      });
      await waitUntil(() => getTask(task.id)?.status === "running");
      const report = await revokeProjectAuthority(root, project(root));
      expect(report.tasks.cancelledBeforeExecution).toEqual([]);
      expect(report.tasks.alreadyRunning).toContainEqual(expect.objectContaining({ id: task.id, kind: "scan", status: "running" }));
      expect(getTask(task.id)?.status).toBe("running");
      release();
      await waitUntil(() => getTask(task.id)?.status === "succeeded");
      expect(getTask(task.id)?.status).toBe("succeeded");
    } finally {
      release?.();
      await flushTaskStore();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });
});
