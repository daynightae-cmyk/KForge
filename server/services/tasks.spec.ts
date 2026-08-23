import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { flushTaskStore, initializeTaskStore, listTasks } from "./tasks";

describe("KForge task recovery", () => {
  it("marks an interrupted persisted agent mission as blocked and preserves its evidence", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-recovery-"));
    const stateDir = path.join(root, ".kforge");
    const task = { id: "interrupted-agent", projectId: "project", kind: "agent", status: "running", progress: 42, logs: [{ at: new Date().toISOString(), message: "Patch pending", stream: "system" }], startedAt: new Date().toISOString() };
    try {
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "tasks.json"), JSON.stringify({ tasks: [task] }), "utf8");
      const recovery = await initializeTaskStore(root);
      const restored = listTasks("project").find((entry) => entry.id === task.id);
      expect(recovery.interrupted).toBeGreaterThanOrEqual(1);
      expect(restored).toMatchObject({ status: "blocked", interrupted: true });
      expect(restored?.error).toContain("Interrupted by a previous KForge session");
      expect(restored?.logs.some((entry) => entry.message.includes("Inspect the task evidence"))).toBe(true);
    } finally {
      await flushTaskStore();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });
});

async function waitForTask(taskId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const task = listTasks("mission-test").find((entry) => entry.id === taskId);
    if (task && ["succeeded", "failed", "blocked", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Task did not reach a terminal state.");
}

describe("KForge mission graph execution", () => {
  it("blocks queued dependent mission steps after a failed mission result", async () => {
    const { attachMission, startTask } = await import("./tasks");
    const task = startTask("mission-test", "agent", async () => ({ ok: false, output: "failure", message: "Scan failed." }));
    attachMission(task.id, {
      id: task.id,
      name: "audit",
      state: "queued",
      steps: [
        { id: "scan", name: "Scan", tool: "scan", status: "running", dependencies: [], logs: [], retryCount: 0 },
        { id: "graph", name: "Graph", tool: "graph", status: "queued", dependencies: ["scan"], logs: [], retryCount: 0 },
        { id: "health", name: "Health", tool: "health", status: "queued", dependencies: ["graph"], logs: [], retryCount: 0 },
      ],
      changedFiles: [],
      warnings: [],
      recovery: { resume: false, rollback: false, inspect: true, detail: "Test mission." },
    });

    const completed = await waitForTask(task.id);
    expect(completed.status).toBe("failed");
    expect(completed.mission?.state).toBe("failed");
    expect(completed.mission?.steps.find((step) => step.id === "graph")?.status).toBe("blocked");
    expect(completed.mission?.steps.find((step) => step.id === "health")?.status).toBe("blocked");
  });
});
