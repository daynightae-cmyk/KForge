import { randomUUID } from "crypto";

export type TaskKind = "scan" | "audit" | "test" | "build" | "typecheck" | "runtime" | "git" | "github" | "clone" | "agent" | "snapshot";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "retrying";

export interface KForgeTask {
  id: string;
  projectId: string;
  kind: TaskKind;
  status: TaskStatus;
  progress: number;
  logs: Array<{ at: string; message: string; stream: "system" | "stdout" | "stderr" }>;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  error?: string;
  output?: string;
  artifacts?: string[];
  retryOf?: string;
}

export interface TaskExecutionResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  message: string;
  blocked?: boolean;
  artifacts?: string[];
}

const tasks = new Map<string, KForgeTask>();
const executors = new Map<string, () => Promise<TaskExecutionResult>>();

function append(task: KForgeTask, message: string, stream: "system" | "stdout" | "stderr" = "system") {
  task.logs.push({ at: new Date().toISOString(), message, stream });
  task.logs = task.logs.slice(-200);
}

export function listTasks(projectId?: string) {
  return [...tasks.values()].filter((task) => !projectId || task.projectId === projectId).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function getTask(taskId: string) {
  return tasks.get(taskId);
}

export function appendTaskLog(taskId: string, message: string, progress?: number) {
  const task = tasks.get(taskId);
  if (!task) return undefined;
  if (typeof progress === "number") task.progress = Math.max(task.progress, Math.min(99, Math.round(progress)));
  append(task, message);
  return task;
}

export function startTask(projectId: string, kind: TaskKind, executor: () => Promise<TaskExecutionResult>, retryOf?: string): KForgeTask {
  const task: KForgeTask = { id: randomUUID(), projectId, kind, status: retryOf ? "retrying" : "queued", progress: 0, logs: [], startedAt: new Date().toISOString(), retryOf };
  tasks.set(task.id, task);
  executors.set(task.id, executor);
  queueMicrotask(async () => {
    if (task.status === "cancelled") return;
    task.status = "running";
    task.progress = 10;
    append(task, retryOf ? `${kind} retry started.` : `${kind} started.`);
    try {
      const result = await executor();
      task.progress = 100;
      task.status = result.ok ? "succeeded" : result.blocked ? "blocked" : "failed";
      task.exitCode = result.exitCode;
      task.error = result.ok ? undefined : result.message;
      task.output = result.output;
      task.artifacts = result.artifacts;
      append(task, result.message, result.ok ? "system" : "stderr");
      if (result.output) append(task, result.output.slice(-12_000), "stdout");
      task.finishedAt = new Date().toISOString();
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    } catch (error: unknown) {
      task.progress = 100;
      task.status = "failed";
      task.error = error instanceof Error ? error.message : "Task failed.";
      append(task, task.error, "stderr");
      task.finishedAt = new Date().toISOString();
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    }
  });
  return task;
}

export function cancelTask(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return { task: undefined, cancellable: false };
  if (task.status !== "queued") return { task, cancellable: false };
  task.status = "cancelled";
  task.finishedAt = new Date().toISOString();
  append(task, "Task was cancelled before execution started.");
  task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
  return { task, cancellable: true };
}

export function retryTask(taskId: string) {
  const original = tasks.get(taskId);
  const executor = executors.get(taskId);
  if (!original || !executor || original.status === "running" || original.status === "queued") return undefined;
  return startTask(original.projectId, original.kind, executor, original.id);
}
