import { spawn, type ChildProcess } from "child_process";
import net from "net";
import type { ProjectProfile } from "../../shared/workspace";

export type PreviewState = "idle" | "starting" | "running" | "failed" | "stopped" | "blocked" | "unavailable";

export interface PreviewStatus {
  projectId: string;
  state: PreviewState;
  command?: string;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  checkedAt?: string;
  health?: { ok: boolean; status?: number; detail: string };
  logs: string[];
  error?: string;
}

interface ActivePreview {
  child: ChildProcess;
  status: PreviewStatus;
}

const activePreviews = new Map<string, ActivePreview>();
const MAX_LOG_LINES = 300;
const MAX_LOG_LINE_LENGTH = 1_500;

function appendLog(status: PreviewStatus, value: string) {
  const lines = value.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return;
  status.logs = [...status.logs, ...lines.map((line) => line.slice(0, MAX_LOG_LINE_LENGTH))].slice(-MAX_LOG_LINES);
}

function commandFor(packageManager: string | null, script: string, port: number) {
  const command = packageManager === "pnpm" ? "pnpm" : packageManager === "yarn" ? "yarn" : "npm";
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const args = command === "npm" ? ["run", script, "--", "--port", String(port)] : ["run", script, "--port", String(port)];
  return { command: executable, args, display: `${command} run ${script} -- --port ${port}` };
}

function selectedPreviewScript(profile: ProjectProfile) {
  if (profile.scripts.preview) return "preview";
  if (profile.scripts.dev) return "dev";
  if (profile.scripts.start) return "start";
  return undefined;
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
    if (!response.ok && status.state === "running") status.error = detail;
    return status.health;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    status.health = { ok: false, detail };
    return status.health;
  }
}

export function getPreviewStatus(projectId: string): PreviewStatus {
  const active = activePreviews.get(projectId);
  if (active) return { ...active.status, logs: [...active.status.logs] };
  return { projectId, state: "idle", logs: [], health: { ok: false, detail: "No Preview process has been started in this KForge server session." } };
}

export async function startPreview(projectId: string, projectPath: string, profile: ProjectProfile): Promise<PreviewStatus> {
  const existing = activePreviews.get(projectId);
  if (existing && ["starting", "running"].includes(existing.status.state)) return { ...existing.status, logs: [...existing.status.logs] };
  const script = selectedPreviewScript(profile);
  if (!script) return { projectId, state: "unavailable", logs: [], health: { ok: false, detail: "No preview, dev, or start script was detected from local project manifests." }, error: "PREVIEW_COMMAND_UNAVAILABLE" };
  const port = await reserveLocalPort();
  const selected = commandFor(profile.packageManager, script, port);
  const status: PreviewStatus = { projectId, state: "starting", command: selected.display, port, url: `http://127.0.0.1:${port}/`, startedAt: new Date().toISOString(), logs: [`Starting detected ${script} script on local port ${port}.`] };
  const child = spawn(selected.command, selected.args, { cwd: projectPath, shell: process.platform === "win32" && selected.command.endsWith(".cmd"), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" } });
  status.pid = child.pid;
  const active: ActivePreview = { child, status };
  activePreviews.set(projectId, active);
  child.stdout?.on("data", (data: Buffer) => appendLog(status, data.toString()));
  child.stderr?.on("data", (data: Buffer) => appendLog(status, data.toString()));
  child.on("error", (error) => { status.state = "failed"; status.error = error.message; appendLog(status, error.message); });
  child.on("exit", (code, signal) => {
    if (status.state !== "stopped") {
      status.state = code === 0 ? "stopped" : "failed";
      status.error = code === 0 ? undefined : `Preview process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
    }
    status.stoppedAt = new Date().toISOString();
    appendLog(status, `Preview process exited: code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}.`);
  });
  setTimeout(() => { void probe(status).then((health) => { if (status.state === "starting" && health.ok) status.state = "running"; }); }, 1_500).unref();
  return { ...status, logs: [...status.logs] };
}

export async function checkPreviewHealth(projectId: string): Promise<PreviewStatus> {
  const active = activePreviews.get(projectId);
  if (!active) return getPreviewStatus(projectId);
  const health = await probe(active.status);
  if (active.status.state === "starting" && health.ok) active.status.state = "running";
  return { ...active.status, logs: [...active.status.logs] };
}

export function stopPreview(projectId: string): PreviewStatus {
  const active = activePreviews.get(projectId);
  if (!active) return getPreviewStatus(projectId);
  active.status.state = "stopped";
  active.status.stoppedAt = new Date().toISOString();
  appendLog(active.status, "Preview stop requested by KForge.");
  if (!active.child.killed) active.child.kill();
  activePreviews.delete(projectId);
  return { ...active.status, logs: [...active.status.logs] };
}

export async function restartPreview(projectId: string, projectPath: string, profile: ProjectProfile) {
  stopPreview(projectId);
  return startPreview(projectId, projectPath, profile);
}
