import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { initializeTaskStore, listTasks } from "./tasks";

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
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
