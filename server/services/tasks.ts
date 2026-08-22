import { randomUUID } from "crypto";

export type TaskKind = "scan" | "audit" | "test" | "build" | "typecheck" | "runtime" | "git" | "github" | "clone" | "agent" | "snapshot";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface KForgeTask {
  id: string;
  projectId: string;
  kind: TaskKind;
  status: TaskStatus;
  progress: number;
  logs: Array<{ at: string; message: string }>;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  output?: string;
  retryOf?: string;
}

export interface TaskExecutionResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  message: string;
}

const tasks = new Map<string, KForgeTask>();
const executors = new Map<string, () => Promise<TaskExecutionResult>>();

function append(task: KForgeTask, message: string) {
  task.logs.push({ at: new Date().toISOString(), message });
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
  const task: KForgeTask = { id: randomUUID(), projectId, kind, status: "queued", progress: 0, logs: [], startedAt: new Date().toISOString(), retryOf };
  tasks.set(task.id, task);
  executors.set(task.id, executor);
  queueMicrotask(async () => {
    if (task.status === "cancelled") return;
    task.status = "running";
    task.progress = 10;
    append(task, `${kind} started.`);
    try {
      const result = await executor();
      task.progress = 100;
      task.status = result.ok ? "succeeded" : "failed";
      task.exitCode = result.exitCode;
      task.error = result.ok ? undefined : result.message;
      task.output = result.output;
      append(task, result.message);
      if (result.output) append(task, result.output.slice(-12_000));
      task.finishedAt = new Date().toISOString();
    } catch (error: unknown) {
      task.progress = 100;
      task.status = "failed";
      task.error = error instanceof Error ? error.message : "Task failed.";
      append(task, task.error);
      task.finishedAt = new Date().toISOString();
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
  return { task, cancellable: true };
}

export function retryTask(taskId: string) {
  const original = tasks.get(taskId);
  const executor = executors.get(taskId);
  if (!original || !executor || original.status === "running" || original.status === "queued") return undefined;
  return startTask(original.projectId, original.kind, executor, original.id);
}
