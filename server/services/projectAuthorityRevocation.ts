import type { ProjectSummary } from "../../shared/workspace";
import { listTasks, cancelTask } from "./tasks";
import { getPreviewStatus, stopPreviewAndWait } from "./previewRuntime";
import { setProjectTrust } from "./projectTrust";

export interface ProjectAuthorityRevocationReport {
  revokedAt: string;
  projectId: string;
  trust: "untrusted";
  preview: {
    before: string;
    after: string;
    sessionId?: string;
    pid?: number;
    stoppedAt?: string;
    stopError?: string;
  };
  tasks: {
    cancelledBeforeExecution: Array<{ id: string; kind: string; priorStatus: string }>;
    alreadyRunning: Array<{ id: string; kind: string; status: string; startedAt: string }>;
    terminalUnchanged: number;
  };
  guarantees: {
    futureTrustGatedRequests: "BLOCKED_UNTIL_RETRUSTED";
    queuedTasks: "CANCELLED_WHEN_STILL_QUEUED";
    activePreview: "STOP_REQUESTED_AND_AWAITED";
    alreadyRunningCommands: "NOT_RETROACTIVELY_UNDONE";
    sourceMutationByRevocation: false;
    remoteContactByRevocation: false;
  };
}

export async function revokeProjectAuthority(workspaceRoot: string, project: ProjectSummary): Promise<ProjectAuthorityRevocationReport> {
  const revokedAt = new Date().toISOString();

  // Persist the trust boundary first so concurrent follow-up requests resolve as
  // untrusted before teardown work begins.
  await setProjectTrust(workspaceRoot, project.path, "untrusted");

  const beforeTasks = listTasks(project.id);
  const cancelledBeforeExecution: ProjectAuthorityRevocationReport["tasks"]["cancelledBeforeExecution"] = [];
  for (const task of beforeTasks) {
    if (task.status !== "queued") continue;
    const result = cancelTask(task.id);
    if (result.cancellable) cancelledBeforeExecution.push({ id: task.id, kind: task.kind, priorStatus: "queued" });
  }

  const currentTasks = listTasks(project.id);
  const alreadyRunning = currentTasks
    .filter((task) => task.status === "running" || task.status === "retrying")
    .map((task) => ({ id: task.id, kind: task.kind, status: task.status, startedAt: task.startedAt }));
  const terminalUnchanged = currentTasks.filter((task) => ["succeeded", "failed", "cancelled", "blocked"].includes(task.status)).length;

  const previewBefore = getPreviewStatus(project.id);
  let previewAfter = previewBefore;
  let stopError: string | undefined;
  if (["starting", "running"].includes(previewBefore.state)) {
    try {
      previewAfter = await stopPreviewAndWait(project.id);
    } catch (error: unknown) {
      stopError = error instanceof Error ? error.message : String(error);
      previewAfter = getPreviewStatus(project.id);
    }
  }

  return {
    revokedAt,
    projectId: project.id,
    trust: "untrusted",
    preview: {
      before: previewBefore.state,
      after: previewAfter.state,
      sessionId: previewBefore.sessionId,
      pid: previewBefore.pid,
      stoppedAt: previewAfter.stoppedAt,
      stopError,
    },
    tasks: { cancelledBeforeExecution, alreadyRunning, terminalUnchanged },
    guarantees: {
      futureTrustGatedRequests: "BLOCKED_UNTIL_RETRUSTED",
      queuedTasks: "CANCELLED_WHEN_STILL_QUEUED",
      activePreview: "STOP_REQUESTED_AND_AWAITED",
      alreadyRunningCommands: "NOT_RETROACTIVELY_UNDONE",
      sourceMutationByRevocation: false,
      remoteContactByRevocation: false,
    },
  };
}
