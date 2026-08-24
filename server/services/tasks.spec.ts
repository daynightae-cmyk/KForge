import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { flushTaskStore, initializeTaskStore, listTasks } from "./tasks";

describe("KForge task recovery", () => {
  it("reloads only the selected workspace store instead of duplicating cached tasks", async () => {
    const firstRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-task-root-a-"));
    const secondRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-task-root-b-"));
    try {
      await fs.mkdir(path.join(firstRoot, ".kforge"), { recursive: true });
      await fs.mkdir(path.join(secondRoot, ".kforge"), { recursive: true });
      const task = (id: string, projectId: string) => ({ id, projectId, kind: "scan", status: "succeeded", progress: 100, logs: [], startedAt: "2026-08-24T00:00:00.000Z", finishedAt: "2026-08-24T00:00:01.000Z" });
      await fs.writeFile(path.join(firstRoot, ".kforge", "tasks.json"), JSON.stringify({ tasks: [task("first", "project-a")] }), "utf8");
      await fs.writeFile(path.join(secondRoot, ".kforge", "tasks.json"), JSON.stringify({ tasks: [task("second", "project-b")] }), "utf8");
      await initializeTaskStore(firstRoot);
      expect(listTasks().map((entry) => entry.id)).toEqual(["first"]);
      await initializeTaskStore(secondRoot);
      expect(listTasks().map((entry) => entry.id)).toEqual(["second"]);
    } finally {
      await flushTaskStore();
      await Promise.all([firstRoot, secondRoot].map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 })));
    }
  });

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
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-mission-graph-"));
    try {
      await initializeTaskStore(root);
      const { attachMission, startTask } = await import("./tasks");
      const task = startTask("mission-test", "agent", async () => ({ ok: false, output: "failure", message: "Scan failed." }));
      attachMission(task.id, {
        id: task.id,
        projectId: "mission-test",
        type: "audit",
        name: "audit",
        goal: "Test mission.",
        state: "queued",
        status: "queued",
        createdAt: new Date().toISOString(),
        progress: 0,
        steps: [
          { id: "scan", missionId: task.id, index: 0, name: "Scan", kind: "scan", tool: "scan", status: "running", dependencies: [], logs: [], evidence: [], requiresConfirmation: false, attempts: 0, retryCount: 0 },
          { id: "graph", missionId: task.id, index: 1, name: "Graph", kind: "graph", tool: "graph", status: "queued", dependencies: ["scan"], logs: [], evidence: [], requiresConfirmation: false, attempts: 0, retryCount: 0 },
          { id: "health", missionId: task.id, index: 2, name: "Health", kind: "health", tool: "health", status: "queued", dependencies: ["graph"], logs: [], evidence: [], requiresConfirmation: false, attempts: 0, retryCount: 0 },
        ],
        evidence: [],
        changedFiles: [],
        warnings: [],
        recovery: { resume: false, rollback: false, inspect: true, detail: "Test mission." },
      });

      const completed = await waitForTask(task.id);
      expect(completed.status).toBe("failed");
      expect(completed.mission?.state).toBe("failed");
      expect(completed.mission?.steps.find((step) => step.id === "graph")?.status).toBe("blocked");
      expect(completed.mission?.steps.find((step) => step.id === "health")?.status).toBe("blocked");
    } finally {
      await flushTaskStore();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });
});


describe("KForge V3 mission recovery", () => {
  it("marks an interrupted read-only mission as explicitly resumable after restart", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-v3-recovery-"));
    const stateDir = path.join(root, ".kforge");
    const now = new Date().toISOString();
    const task = {
      id: "interrupted-v3-audit", projectId: "project", kind: "agent", status: "running", progress: 50, logs: [], startedAt: now,
      mission: {
        id: "interrupted-v3-audit", projectId: "project", type: "audit", name: "Audit project", goal: "Collect read-only evidence.", state: "running", status: "running", createdAt: now, progress: 50,
        steps: [
          { id: "scan", missionId: "interrupted-v3-audit", index: 0, name: "Scan", kind: "discovery", tool: "scan", status: "succeeded", dependencies: [], logs: [], evidence: [], requiresConfirmation: false, attempts: 1, retryCount: 0 },
          { id: "graph", missionId: "interrupted-v3-audit", index: 1, name: "Graph", kind: "analysis", tool: "graph", status: "running", dependencies: ["scan"], logs: [], evidence: [], requiresConfirmation: false, attempts: 1, retryCount: 0 },
        ], evidence: [], changedFiles: [], warnings: [], recovery: { resume: true, rollback: false, inspect: true, detail: "Original state." },
      },
    };
    try {
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, "tasks.json"), JSON.stringify({ tasks: [task] }), "utf8");
      await initializeTaskStore(root);
      const restored = listTasks("project").find((entry) => entry.id === task.id);
      expect(restored?.mission?.state).toBe("interrupted");
      expect(restored?.mission?.recovery.resume).toBe(true);
      expect(restored?.mission?.recovery.recoveryRequired).toBe(false);
      expect(restored?.mission?.steps.find((entry) => entry.id === "graph")?.status).toBe("blocked");
    } finally {
      await flushTaskStore();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });
});
