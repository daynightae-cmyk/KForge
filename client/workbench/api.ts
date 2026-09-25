export const KFORGE_WORKBENCH_CLIENT_HEADER = "X-KForge-Client";
export const KFORGE_WORKBENCH_CLIENT_VALUE = "workbench-v1";

function withWorkbenchClientHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set(KFORGE_WORKBENCH_CLIENT_HEADER, KFORGE_WORKBENCH_CLIENT_VALUE);
  return { ...init, headers };
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, withWorkbenchClientHeader(init));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || `${response.status} ${response.statusText}`);
  return payload as T;
}

export async function fetchEvidence(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(url, withWorkbenchClientHeader(init));
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export const jsonRequest = (body: unknown): RequestInit => withWorkbenchClientHeader({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function waitForTask(taskId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let task: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const result = await fetchJson<{ task: Record<string, unknown> }>(`/api/workspace/tasks/${encodeURIComponent(taskId)}`);
    task = result.task;
    const status = String(task.status || "").toLowerCase();
    if (!["queued", "running", "pending"].includes(status)) return task;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return task;
}
