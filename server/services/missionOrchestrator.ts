import { completeMission, getTask, updateMissionStep, type KForgeMission, type MissionStep } from "./tasks";

export interface MissionStepExecution {
  ok: boolean;
  output?: unknown;
  message: string;
  blocked?: boolean;
  changedFiles?: string[];
  snapshotId?: string;
}

export interface MissionExecutionSummary {
  ok: boolean;
  state: "succeeded" | "failed" | "blocked";
  completed: string[];
  failed: string[];
  blocked: string[];
}

function isComplete(status: MissionStep["status"]) { return ["succeeded", "failed", "blocked", "skipped"].includes(status); }

function dependenciesFailed(mission: KForgeMission, step: MissionStep) {
  return step.dependencies.some((dependency) => {
    const dependencyStep = mission.steps.find((candidate) => candidate.id === dependency);
    return dependencyStep?.status === "failed" || dependencyStep?.status === "blocked";
  });
}

function dependenciesReady(mission: KForgeMission, step: MissionStep) {
  return step.dependencies.every((dependency) => {
    const dependencyStep = mission.steps.find((candidate) => candidate.id === dependency);
    return dependencyStep?.status === "succeeded" || dependencyStep?.status === "skipped";
  });
}

export async function executeMissionDag(taskId: string, executeStep: (step: MissionStep) => Promise<MissionStepExecution>): Promise<MissionExecutionSummary> {
  const completed: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];
  for (;;) {
    const task = getTask(taskId);
    const mission = task?.mission;
    if (!task || !mission) throw new Error("Persisted mission was not available for execution.");

    for (const step of mission.steps.filter((candidate) => candidate.status === "queued" && dependenciesFailed(mission, candidate))) {
      updateMissionStep(taskId, step.id, { status: "blocked", logs: ["Blocked because a required dependency failed or was blocked."], error: "DEPENDENCY_FAILED" });
      blocked.push(step.id);
    }

    const refreshed = getTask(taskId)?.mission;
    if (!refreshed) throw new Error("Mission state disappeared during execution.");
    const ready = refreshed.steps.filter((candidate) => candidate.status === "queued" && dependenciesReady(refreshed, candidate));
    if (!ready.length) break;

    const confirmationStep = ready.find((step) => step.requiresConfirmation);
    if (confirmationStep) {
      updateMissionStep(taskId, confirmationStep.id, { status: "waiting-confirmation", logs: ["Explicit confirmation is required before this write-capable step can execute."], error: "CONFIRMATION_REQUIRED" });
      blocked.push(confirmationStep.id);
      break;
    }

    await Promise.all(ready.map(async (step) => {
      updateMissionStep(taskId, step.id, { status: "running", logs: [`Running typed strategy step using ${step.tool}.`] });
      try {
        const result = await executeStep(step);
        const current = getTask(taskId)?.mission?.steps.find((entry) => entry.id === step.id);
        const status = result.ok ? "succeeded" : result.blocked ? "blocked" : "failed";
        updateMissionStep(taskId, step.id, { status, output: result.output === undefined ? undefined : JSON.stringify(result.output, null, 2).slice(0, 12_000), error: result.ok ? undefined : result.message, logs: [result.message] });
        if (result.changedFiles?.length) { const live = getTask(taskId)?.mission; if (live) live.changedFiles = [...new Set([...live.changedFiles, ...result.changedFiles])]; }
        if (result.snapshotId) { const live = getTask(taskId)?.mission; if (live) { live.snapshotId = result.snapshotId; live.recovery.rollback = true; } }
        if (status === "succeeded") completed.push(step.id); else if (status === "failed") failed.push(step.id); else blocked.push(step.id);
        void current;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Mission step failed.";
        updateMissionStep(taskId, step.id, { status: "failed", error: message, logs: [message] });
        failed.push(step.id);
      }
    }));
  }

  const mission = getTask(taskId)?.mission;
  if (!mission) throw new Error("Mission state was unavailable after execution.");
  const waiting = mission.steps.some((step) => step.status === "waiting-confirmation");
  const hasFailed = mission.steps.some((step) => step.status === "failed");
  const hasBlocked = mission.steps.some((step) => step.status === "blocked");
  const remaining = mission.steps.some((step) => !isComplete(step.status));
  const state = waiting || hasBlocked || remaining ? "blocked" : hasFailed ? "failed" : "succeeded";
  completeMission(taskId, state, state === "blocked" ? "Mission has blocked or confirmation-required steps; inspect evidence before retrying." : state === "failed" ? "Mission captured failed evidence; dependent steps were blocked." : "All planned mission steps completed with recorded evidence.");
  return { ok: state === "succeeded", state, completed, failed, blocked };
}
