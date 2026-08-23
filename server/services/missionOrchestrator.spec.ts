import { describe, expect, it } from "vitest";
import { executeMissionDag } from "./missionOrchestrator";
import { attachMission, getTask, startTask, type KForgeMission } from "./tasks";

function mission(taskId: string, steps: KForgeMission["steps"]): KForgeMission {
  return {
    id: taskId, projectId: "orchestrator-test", type: "audit", name: "Test mission", goal: "Exercise DAG execution.",
    state: "planning", status: "planning", createdAt: new Date().toISOString(), progress: 0,
    steps, evidence: [], changedFiles: [], warnings: [],
    recovery: { resume: true, rollback: false, inspect: true, detail: "Test recovery." },
  };
}

function step(taskId: string, id: string, index: number, dependencies: string[] = [], requiresConfirmation = false): KForgeMission["steps"][number] {
  return { id, missionId: taskId, index, name: id, kind: id, tool: id, status: "queued", dependencies, logs: [], evidence: [], requiresConfirmation, attempts: 0, retryCount: 0 };
}

function persistentTask() {
  return startTask("orchestrator-test", "agent", async () => new Promise(() => undefined));
}

describe("KForge Mission Orchestrator V3", () => {
  it("continues an independent step while blocking the dependent step after a failure", async () => {
    const task = persistentTask();
    attachMission(task.id, mission(task.id, [step(task.id, "failure", 0), step(task.id, "independent", 1), step(task.id, "dependent", 2, ["failure"])]));
    const result = await executeMissionDag(task.id, async (current) => current.id === "failure"
      ? { ok: false, message: "Intentional failure." }
      : { ok: true, output: { id: current.id }, message: `${current.id} completed.` });
    const stored = getTask(task.id)?.mission;
    expect(result.state).toBe("blocked");
    expect(stored?.steps.find((entry) => entry.id === "failure")?.status).toBe("failed");
    expect(stored?.steps.find((entry) => entry.id === "dependent")?.status).toBe("blocked");
    expect(stored?.steps.find((entry) => entry.id === "independent")?.status).toBe("succeeded");
    expect(stored?.progress).toBe(100);
  });

  it("stops at a confirmation-required step without executing a write-capable operation", async () => {
    const task = persistentTask();
    attachMission(task.id, mission(task.id, [step(task.id, "scan", 0), step(task.id, "apply", 1, ["scan"], true)]));
    const executed: string[] = [];
    const result = await executeMissionDag(task.id, async (current) => { executed.push(current.id); return { ok: true, message: "Read-only step completed." }; });
    const stored = getTask(task.id)?.mission;
    expect(result.state).toBe("blocked");
    expect(executed).toEqual(["scan"]);
    expect(stored?.steps.find((entry) => entry.id === "apply")?.status).toBe("waiting-confirmation");
  });
});
