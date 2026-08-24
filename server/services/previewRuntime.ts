import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import net from "net";
import type { ProjectProfile } from "../../shared/workspace";
import { selectProjectRuntime } from "./projectExecution";

export type PreviewState = "idle" | "starting" | "running" | "failed" | "stopped" | "blocked" | "unavailable";

export interface PreviewStatus {
  projectId: string;
  sessionId?: string;
  state: PreviewState;
  command?: string;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  checkedAt?: string;
  health?: { ok: boolean; status?: number; detail: string };
  healthHistory: Array<{ checkedAt: string; ok: boolean; status?: number; detail: string }>;
  routes: Array<{ path: string; source: "root" | "html-link"; checkedAt: string }>;
  history: Array<{ at: string; event: "start" | "health" | "stop" | "exit" | "error"; detail: string }>;
  runtime: { execution: "LOCAL"; network: "NOT_REQUIRED"; source: "detected-project-script"; projectSourceSent: false };
  telemetry: { console: "process-stdout-stderr"; network: "health-probe-only"; browserConsoleCaptured: false };
  logs: string[];
  error?: string;
}

interface ActivePreview {
  child: ChildProcess;
  status: PreviewStatus;
}

const activePreviews = new Map<string, ActivePreview>();
const previewRecords = new Map<string, PreviewStatus>();
const MAX_LOG_LINES = 300;
const MAX_LOG_LINE_LENGTH = 1_500;
const MAX_HISTORY_ITEMS = 100;

function baseStatus(projectId: string): PreviewStatus {
  return {
    projectId,
    state: "idle",
    logs: [],
    healthHistory: [],
    routes: [],
    history: [],
    runtime: { execution: "LOCAL", network: "NOT_REQUIRED", source: "detected-project-script", projectSourceSent: false },
    telemetry: { console: "process-stdout-stderr", network: "health-probe-only", browserConsoleCaptured: false },
    health: { ok: false, detail: "No Preview process has been started in this KForge server session." },
  };
}

function cloneStatus(status: PreviewStatus): PreviewStatus {
  return {
    ...status,
    logs: [...status.logs],
    healthHistory: status.healthHistory.map((item) => ({ ...item })),
    routes: status.routes.map((item) => ({ ...item })),
    history: status.history.map((item) => ({ ...item })),
    health: status.health ? { ...status.health } : undefined,
    runtime: { ...status.runtime },
    telemetry: { ...status.telemetry },
  };
}

function recordEvent(status: PreviewStatus, event: PreviewStatus["history"][number]["event"], detail: string) {
  status.history = [...status.history, { at: new Date().toISOString(), event, detail }].slice(-MAX_HISTORY_ITEMS);
  previewRecords.set(status.projectId, status);
}

function appendLog(status: PreviewStatus, value: string) {
  const lines = value.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  status.logs = [...status.logs, ...lines.map((line) => line.slice(0, MAX_LOG_LINE_LENGTH))].slice(-MAX_LOG_LINES);
}

function reserveLocalPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function probe(status: PreviewStatus) {
  status.checkedAt = new Date().toISOString();
  if (!status.url) return { ok: false, detail: "No local preview URL is available." };
  try {
    const response = await fetch(status.url, { signal: AbortSignal.timeout(3_000) });
    const detail = `HTTP ${response.status} ${response.statusText}`;
    status.health = { ok: response.ok, status: response.status, detail };
    status.healthHistory = [...status.healthHistory, { checkedAt: status.checkedAt, ...status.health }].slice(-MAX_HISTORY_ITEMS);
    const contentType = response.headers.get("content-type") || "";
    const routes = new Set<string>(["/"]);
    if (contentType.includes("text/html")) {
      const html = await response.text();
      for (const match of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
        try {
          const linked = new URL(match[1], status.url);
          if (linked.origin === new URL(status.url).origin) routes.add(linked.pathname || "/");
        } catch { /* Ignore malformed document links. */ }
        if (routes.size >= 25) break;
      }
    }
    status.routes = [...routes].map((route, index) => ({ path: route, source: index === 0 ? "root" : "html-link", checkedAt: status.checkedAt! }));
    recordEvent(status, "health", detail);
    if (!response.ok && status.state === "running") status.error = detail;
    return status.health;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    status.health = { ok: false, detail };
    status.healthHistory = [...status.healthHistory, { checkedAt: status.checkedAt, ...status.health }].slice(-MAX_HISTORY_ITEMS);
    recordEvent(status, "health", detail);
    return status.health;
  }
}

export function getPreviewStatus(projectId: string): PreviewStatus {
  const active = activePreviews.get(projectId);
  if (active) return cloneStatus(active.status);
  return cloneStatus(previewRecords.get(projectId) || baseStatus(projectId));
}

export async function startPreview(projectId: string, projectPath: string, profile: ProjectProfile): Promise<PreviewStatus> {
  const existing = activePreviews.get(projectId);
  if (existing && ["starting", "running"].includes(existing.status.state)) return cloneStatus(existing.status);
  const port = await reserveLocalPort();
  const selection = selectProjectRuntime(profile, port, "preview");
  if (selection.available === false) {
    const unavailable = { ...baseStatus(projectId), state: "unavailable" as const, health: { ok: false, detail: selection.reason }, error: "PREVIEW_COMMAND_UNAVAILABLE" };
    previewRecords.set(projectId, unavailable);
    return cloneStatus(unavailable);
  }
  const selected = selection.selected;
  const previous = previewRecords.get(projectId);
  const status: PreviewStatus = { ...baseStatus(projectId), sessionId: randomUUID(), state: "starting", command: selected.display, port, url: `http://127.0.0.1:${port}${selected.urlPath || "/"}`, startedAt: new Date().toISOString(), logs: [`Starting detected runtime from ${selected.source} on local port ${port}.`], history: previous?.history || [], healthHistory: previous?.healthHistory || [] };
  recordEvent(status, "start", `Detected runtime from ${selected.source} started on local port ${port}.`);
  const child = spawn(selected.command, selected.args, { cwd: projectPath, shell: process.platform === "win32" && selected.command.endsWith(".cmd"), windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ASPNETCORE_URLS: `http://127.0.0.1:${port}` } });
  status.pid = child.pid;
  const active: ActivePreview = { child, status };
  activePreviews.set(projectId, active);
  child.stdout?.on("data", (data: Buffer) => appendLog(status, data.toString()));
  child.stderr?.on("data", (data: Buffer) => appendLog(status, data.toString()));
  child.on("error", (error) => { status.state = "failed"; status.error = error.message; appendLog(status, error.message); recordEvent(status, "error", error.message); });
  child.on("exit", (code, signal) => {
    if (status.state !== "stopped") {
      status.state = code === 0 ? "stopped" : "failed";
      status.error = code === 0 ? undefined : `Preview process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
    }
    status.stoppedAt = new Date().toISOString();
    appendLog(status, `Preview process exited: code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}.`);
    recordEvent(status, "exit", `Process exited with code ${code ?? "unknown"}${signal ? ` and signal ${signal}` : ""}.`);
    if (activePreviews.get(projectId)?.child === child) activePreviews.delete(projectId);
  });
  setTimeout(() => { void probe(status).then((health) => { if (status.state === "starting" && health.ok) status.state = "running"; }); }, 1_500).unref();
  return cloneStatus(status);
}

export async function checkPreviewHealth(projectId: string): Promise<PreviewStatus> {
  const active = activePreviews.get(projectId);
  if (!active) return getPreviewStatus(projectId);
  const health = await probe(active.status);
  if (active.status.state === "starting" && health.ok) active.status.state = "running";
  return cloneStatus(active.status);
}

export async function waitForPreviewHealth(projectId: string, timeoutMs = 10_000, intervalMs = 250): Promise<PreviewStatus> {
  const deadline = Date.now() + timeoutMs;
  let status = await checkPreviewHealth(projectId);
  while (Date.now() < deadline && !status.health?.ok && status.health?.status === undefined && !["failed", "blocked", "unavailable", "stopped"].includes(status.state)) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    status = await checkPreviewHealth(projectId);
  }
  return status;
}

export function stopPreview(projectId: string): PreviewStatus {
  const active = activePreviews.get(projectId);
  if (!active) return getPreviewStatus(projectId);
  active.status.state = "stopped";
  active.status.stoppedAt = new Date().toISOString();
  appendLog(active.status, "Preview stop requested by KForge.");
  recordEvent(active.status, "stop", "Preview stop requested by KForge.");
  if (!active.child.killed) {
    if (process.platform === "win32" && active.child.pid) spawn("taskkill", ["/pid", String(active.child.pid), "/t", "/f"], { windowsHide: true });
    else if (active.child.pid) {
      try { process.kill(-active.child.pid, "SIGTERM"); }
      catch { active.child.kill(); }
    } else active.child.kill();
  }
  activePreviews.delete(projectId);
  previewRecords.set(projectId, active.status);
  return cloneStatus(active.status);
}

export async function stopPreviewAndWait(projectId: string, timeoutMs = 5_000): Promise<PreviewStatus> {
  const child = activePreviews.get(projectId)?.child;
  if (!child) return stopPreview(projectId);
  const exitPromise = new Promise<boolean>((resolve) => {
    if (child.exitCode !== null) { resolve(true); return; }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
  stopPreview(projectId);
  const exited = await exitPromise;
  if (!exited) throw new Error(`Preview process ${child.pid || "unknown"} did not exit within ${timeoutMs}ms.`);
  return getPreviewStatus(projectId);
}

export async function restartPreview(projectId: string, projectPath: string, profile: ProjectProfile) {
  await stopPreviewAndWait(projectId);
  return startPreview(projectId, projectPath, profile);
}
