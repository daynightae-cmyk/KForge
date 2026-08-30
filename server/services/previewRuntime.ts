import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import net from "net";
import path from "path";
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
  health?: { ok: boolean; status?: number; latencyMs?: number; detail: string };
  healthHistory: Array<{ checkedAt: string; ok: boolean; status?: number; latencyMs?: number; detail: string }>;
  startupTimeline: Array<{ at: string; phase: "allocated" | "spawned" | "first-probe" | "healthy" | "exit" | "stopped" | "error"; detail: string }>;
  routes: Array<{ path: string; source: "root" | "html-link"; checkedAt: string }>;
  history: Array<{ at: string; event: "start" | "health" | "stop" | "exit" | "error"; detail: string }>;
  runtime: { execution: "LOCAL"; network: "NOT_REQUIRED"; source: "detected-project-script"; projectSourceSent: false };
  telemetry: { console: "process-stdout-stderr"; network: "loopback-health-probe-only"; browserConsoleCaptured: false };
  embedding: { state: "ALLOWED" | "BLOCKED" | "UNKNOWN"; reason?: string };
  logs: string[];
  error?: string;
}

export interface PreviewDocumentInspection {
  projectId: string;
  sessionId?: string;
  checkedAt: string;
  route: string;
  url?: string;
  state: "COMPLETED" | "UNAVAILABLE" | "FAILED";
  source: "loopback-html-response" | "none";
  httpStatus?: number;
  contentType?: string;
  findings: Array<{ id: string; category: "accessibility" | "document" | "responsive"; state: "PASS" | "WARNING" | "NOT_TESTED"; detail: string; evidence: string }>;
  limitations: string[];
  error?: string;
}

export type PreviewCapability = {
  available: boolean;
  command?: string;
  source?: string;
  reason?: string;
};

interface ActivePreview {
  child: ChildProcess;
  status: PreviewStatus;
}

const activePreviews = new Map<string, ActivePreview>();
const previewRecords = new Map<string, PreviewStatus>();
const MAX_LOG_LINES = 300;
const MAX_LOG_LINE_LENGTH = 1_500;
const MAX_HISTORY_ITEMS = 100;
const MAX_HEALTH_REDIRECTS = 3;

function baseStatus(projectId: string): PreviewStatus {
  return {
    projectId,
    state: "idle",
    logs: [],
    healthHistory: [],
    startupTimeline: [],
    routes: [],
    history: [],
    runtime: { execution: "LOCAL", network: "NOT_REQUIRED", source: "detected-project-script", projectSourceSent: false },
    telemetry: { console: "process-stdout-stderr", network: "loopback-health-probe-only", browserConsoleCaptured: false },
    embedding: { state: "UNKNOWN", reason: "Preview response headers have not been inspected." },
    health: { ok: false, detail: "No Preview process has been started in this KForge server session." },
  };
}

function cloneStatus(status: PreviewStatus): PreviewStatus {
  return {
    ...status,
    logs: [...status.logs],
    healthHistory: status.healthHistory.map((item) => ({ ...item })),
    startupTimeline: status.startupTimeline.map((item) => ({ ...item })),
    routes: status.routes.map((item) => ({ ...item })),
    history: status.history.map((item) => ({ ...item })),
    health: status.health ? { ...status.health } : undefined,
    runtime: { ...status.runtime },
    telemetry: { ...status.telemetry },
    embedding: { ...status.embedding },
  };
}

function recordStartup(status: PreviewStatus, phase: PreviewStatus["startupTimeline"][number]["phase"], detail: string) {
  status.startupTimeline = [...status.startupTimeline, { at: new Date().toISOString(), phase, detail }].slice(-MAX_HISTORY_ITEMS);
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

function resolvePreviewCommand(command: string, args: string[]) {
  if (process.platform !== "win32" || command.toLowerCase() !== "npm.cmd") return { command, args, runAsNode: false };
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) return { command, args, runAsNode: false };
  return { command: process.execPath, args: [npmCli, ...args], runAsNode: Boolean(process.versions.electron) };
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

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

async function fetchLoopbackOnly(value: string) {
  const initial = new URL(value);
  if (initial.protocol !== "http:" || !isLoopbackHostname(initial.hostname)) throw new Error(`Preview health probe refused non-loopback URL ${initial.origin}.`);
  const origin = initial.origin;
  let current = initial;
  for (let redirectCount = 0; redirectCount <= MAX_HEALTH_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, { signal: AbortSignal.timeout(3_000), redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current.toString(), redirects: redirectCount };
    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: current.toString(), redirects: redirectCount };
    const next = new URL(location, current);
    if (next.origin !== origin || next.protocol !== "http:" || !isLoopbackHostname(next.hostname)) {
      throw new Error(`Preview health probe blocked cross-origin redirect from ${origin} to ${next.origin}.`);
    }
    current = next;
  }
  throw new Error(`Preview health probe exceeded ${MAX_HEALTH_REDIRECTS} same-origin redirects.`);
}

export function evaluatePreviewEmbedding(headers: Headers): PreviewStatus["embedding"] {
  const xFrameOptions = (headers.get("x-frame-options") || "").trim();
  if (/\bdeny\b/i.test(xFrameOptions)) return { state: "BLOCKED", reason: `X-Frame-Options: ${xFrameOptions}` };
  if (/\bsameorigin\b/i.test(xFrameOptions)) return { state: "BLOCKED", reason: `X-Frame-Options: ${xFrameOptions}; the allocated Preview port is a distinct origin from the KForge shell.` };

  const contentSecurityPolicy = headers.get("content-security-policy") || "";
  const frameAncestors = contentSecurityPolicy.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/i)?.[1]?.trim();
  if (!frameAncestors) return { state: "ALLOWED", reason: "No X-Frame-Options or CSP frame-ancestors restriction was reported by the Preview response." };

  const tokens = frameAncestors.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes("'none'")) return { state: "BLOCKED", reason: `Content-Security-Policy frame-ancestors ${frameAncestors}` };
  if (tokens.includes("'self'")) return { state: "BLOCKED", reason: `Content-Security-Policy frame-ancestors ${frameAncestors}; Preview and KForge use different loopback ports/origins.` };
  if (tokens.includes("*") || tokens.includes("http://127.0.0.1:*") || tokens.includes("http://localhost:*")) return { state: "ALLOWED", reason: `Content-Security-Policy frame-ancestors ${frameAncestors}` };
  return { state: "UNKNOWN", reason: `Content-Security-Policy frame-ancestors ${frameAncestors} is an explicit allowlist that KForge cannot prove contains the current shell origin. Inline embedding stays disabled; opening the local app externally remains available.` };
}

async function probe(status: PreviewStatus) {
  status.checkedAt = new Date().toISOString();
  if (!status.url) return { ok: false, detail: "No local preview URL is available." };
  const started = performance.now();
  try {
    const { response, finalUrl, redirects } = await fetchLoopbackOnly(status.url);
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const detail = `HTTP ${response.status} ${response.statusText}${redirects ? ` · ${redirects} same-origin redirect(s)` : ""}`;
    status.health = { ok: response.ok, status: response.status, latencyMs, detail };
    if (!status.startupTimeline.some((entry) => entry.phase === "first-probe")) recordStartup(status, "first-probe", detail);
    if (response.ok && !status.startupTimeline.some((entry) => entry.phase === "healthy")) recordStartup(status, "healthy", `First responding health probe completed in ${latencyMs} ms.`);
    status.embedding = evaluatePreviewEmbedding(response.headers);
    status.healthHistory = [...status.healthHistory, { checkedAt: status.checkedAt, ...status.health }].slice(-MAX_HISTORY_ITEMS);
    const contentType = response.headers.get("content-type") || "";
    const routes = new Set<string>(["/"]);
    if (contentType.includes("text/html")) {
      const html = await response.text();
      const previewOrigin = new URL(status.url).origin;
      for (const match of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
        try {
          const linked = new URL(match[1], finalUrl);
          if (linked.origin === previewOrigin) routes.add(linked.pathname || "/");
        } catch { /* Ignore malformed document links. */ }
        if (routes.size >= 25) break;
      }
    }
    status.routes = [...routes].map((route, index) => ({ path: route, source: index === 0 ? "root" : "html-link", checkedAt: status.checkedAt! }));
    recordEvent(status, "health", detail);
    if (!response.ok && status.state === "running") status.error = detail;
    else if (response.ok && status.error?.startsWith("HTTP ")) status.error = undefined;
    return status.health;
  } catch (error: unknown) {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const detail = error instanceof Error ? error.message : String(error);
    status.health = { ok: false, latencyMs, detail };
    if (/blocked cross-origin redirect|refused non-loopback/i.test(detail)) status.embedding = { state: "BLOCKED", reason: detail };
    status.healthHistory = [...status.healthHistory, { checkedAt: status.checkedAt, ...status.health }].slice(-MAX_HISTORY_ITEMS);
    recordEvent(status, "health", detail);
    return status.health;
  }
}

export function inspectPreviewCapability(profile: ProjectProfile): PreviewCapability {
  const selection = selectProjectRuntime(profile, "<allocated>", "preview");
  if (selection.available === false) return { available: false, reason: selection.reason };
  return {
    available: true,
    command: selection.selected.display,
    source: selection.selected.source,
  };
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
  recordStartup(status, "allocated", `Reserved loopback port ${port} for project ${projectId}.`);
  recordEvent(status, "start", `Detected runtime from ${selected.source} started on local port ${port}.`);
  const launch = resolvePreviewCommand(selected.command, selected.args);
  const child = spawn(launch.command, launch.args, { cwd: projectPath, shell: false, windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, ...(launch.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), PORT: String(port), HOST: "127.0.0.1", ASPNETCORE_URLS: `http://127.0.0.1:${port}` } });
  status.pid = child.pid;
  recordStartup(status, "spawned", `Spawned the detected project command${child.pid ? ` as PID ${child.pid}` : ""}.`);
  const active: ActivePreview = { child, status };
  activePreviews.set(projectId, active);
  child.stdout?.on("data", (data: Buffer) => appendLog(status, data.toString()));
  child.stderr?.on("data", (data: Buffer) => appendLog(status, data.toString()));
  child.on("error", (error) => { status.state = "failed"; status.error = error.message; appendLog(status, error.message); recordStartup(status, "error", error.message); recordEvent(status, "error", error.message); });
  child.on("exit", (code, signal) => {
    if (status.state !== "stopped") {
      status.state = code === 0 ? "stopped" : "failed";
      status.error = code === 0 ? undefined : `Preview process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
    }
    status.stoppedAt = new Date().toISOString();
    appendLog(status, `Preview process exited: code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}.`);
    recordStartup(status, "exit", `Process exited with code ${code ?? "unknown"}${signal ? ` and signal ${signal}` : ""}.`);
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
  recordStartup(active.status, "stopped", "Preview stop requested by KForge.");
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

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}

export async function inspectPreviewDocument(projectId: string, route = "/"): Promise<PreviewDocumentInspection> {
  const status = getPreviewStatus(projectId);
  const checkedAt = new Date().toISOString();
  const base: PreviewDocumentInspection = { projectId, sessionId: status.sessionId, checkedAt, route, state: "UNAVAILABLE", source: "none", findings: [], limitations: [
    "This inspection reads the delivered HTML response. It does not execute application JavaScript or claim DOM, layout, contrast, keyboard, screen-reader, or overflow coverage.",
    "Browser console, request waterfalls, screenshots, element picking, and interaction capture require a browser bridge or automation runtime and remain unavailable here.",
  ] };
  if (!status.url || status.state !== "running" || !status.health?.ok) return { ...base, error: "A healthy canonical Preview session is required before document inspection." };
  try {
    const target = new URL(route.trim() || "/", status.url);
    if (target.origin !== new URL(status.url).origin) return { ...base, state: "FAILED", error: "Document inspection refused a route outside the active loopback origin." };
    const { response, finalUrl } = await fetchLoopbackOnly(target.toString());
    const contentType = response.headers.get("content-type") || "unknown";
    if (!contentType.toLowerCase().includes("text/html")) return { ...base, url: finalUrl, httpStatus: response.status, contentType, error: "The selected route did not return an HTML document." };
    const html = await response.text();
    const images = countMatches(html, /<img\b/gi);
    const imagesWithAlt = countMatches(html, /<img\b[^>]*\balt\s*=\s*["'][^"']*["'][^>]*>/gi);
    const controls = countMatches(html, /<(?:button|input|select|textarea)\b/gi);
    const labels = countMatches(html, /<label\b/gi);
    const hasLang = /<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html);
    const hasTitle = /<title>\s*[^<\s][\s\S]*?<\/title>/i.test(html);
    const hasViewport = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i.test(html);
    const findings: PreviewDocumentInspection["findings"] = [
      { id: "document-title", category: "document", state: hasTitle ? "PASS" : "WARNING", detail: hasTitle ? "A non-empty document title was delivered." : "No non-empty document title was found in the delivered HTML.", evidence: hasTitle ? "<title> present" : "<title> not observed" },
      { id: "document-language", category: "accessibility", state: hasLang ? "PASS" : "WARNING", detail: hasLang ? "The root HTML element declares a language." : "The root HTML element does not declare a language.", evidence: hasLang ? "html[lang] present" : "html[lang] not observed" },
      { id: "image-alternatives", category: "accessibility", state: images === imagesWithAlt ? "PASS" : "WARNING", detail: images === imagesWithAlt ? `${images} delivered image element(s) include an alt attribute.` : `${images - imagesWithAlt} of ${images} delivered image element(s) have no observed alt attribute.`, evidence: `${imagesWithAlt}/${images} img elements with alt` },
      { id: "form-label-baseline", category: "accessibility", state: controls === 0 || labels > 0 ? "PASS" : "WARNING", detail: controls === 0 ? "No native form controls were delivered in the initial HTML." : `${controls} native control(s) and ${labels} label element(s) were delivered. Runtime association is not tested.`, evidence: `${controls} controls; ${labels} labels` },
      { id: "viewport-meta", category: "responsive", state: hasViewport ? "PASS" : "WARNING", detail: hasViewport ? "A viewport meta declaration was delivered." : "No viewport meta declaration was observed; mobile layout behavior may be incorrect.", evidence: hasViewport ? "meta[name=viewport] present" : "meta[name=viewport] not observed" },
      { id: "runtime-layout", category: "responsive", state: "NOT_TESTED", detail: "Rendered overflow and breakpoint behavior require a browser layout engine and were not inferred from HTML.", evidence: "No browser layout measurement available" },
    ];
    return { ...base, state: "COMPLETED", source: "loopback-html-response", url: finalUrl, httpStatus: response.status, contentType, findings };
  } catch (error) {
    return { ...base, state: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
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

/**
 * Stops every preview process created by this KForge server instance. This is
 * used by the desktop runtime before its loopback server exits so no project
 * child process is left behind after the application window closes.
 */
export async function stopAllPreviews(timeoutMs = 5_000): Promise<void> {
  const projectIds = [...activePreviews.keys()];
  const results = await Promise.allSettled(projectIds.map((projectId) => stopPreviewAndWait(projectId, timeoutMs)));
  const failures = results
    .map((result, index) => ({ result, projectId: projectIds[index] }))
    .filter((entry): entry is { result: PromiseRejectedResult; projectId: string } => entry.result.status === "rejected");
  if (failures.length) {
    throw new Error(`KForge could not stop ${failures.length} preview process(es): ${failures.map((entry) => entry.projectId).join(", ")}`);
  }
}
