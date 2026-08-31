import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import { existsSync } from "fs";
import net from "net";
import path from "path";
import type {
  RuntimeDependency,
  RuntimeEnvironmentDisclosure,
  RuntimeHealth,
  RuntimeLogLine,
  RuntimeProblem,
  RuntimeService,
  RuntimeServiceKind,
  RuntimeTimelineEvent,
  RuntimeTopologyDiscovery,
  TopologySession,
} from "../../shared/topology";

type JsonRecord = Record<string, unknown>;
type ActiveService = { child: ChildProcess; service: RuntimeService };
type ActiveTopology = { session: TopologySession; active: Map<string, ActiveService>; scheduler?: NodeJS.Timeout };

const sessions = new Map<string, ActiveTopology>();
const discoveries = new Map<string, RuntimeTopologyDiscovery>();
const MAX_LOG_LINES = 1_200;
const MAX_SERVICE_LOG_LINES = 400;
const MAX_TIMELINE = 500;
const MAX_PROBLEMS = 200;
const MAX_NETWORK = 400;
const HEALTH_INTERVAL_MS = 3_000;
const SAFE_ENV_VALUES = new Set(["PORT", "HOST", "NODE_ENV", "ASPNETCORE_ENVIRONMENT", "ASPNETCORE_URLS"]);
const SECRET_NAME = /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|database_url|connection_string)/i;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function now() { return new Date().toISOString(); }
function normalizedId(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "service"; }
function relative(root: string, target: string) { return path.relative(root, target).split(path.sep).join("/") || "."; }

async function readJson(file: string): Promise<JsonRecord | undefined> {
  try { return record(JSON.parse(await fs.readFile(file, "utf8"))); } catch { return undefined; }
}

function inside(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function safeCommand(value: unknown): { executable: string; args: string[]; display: string } | undefined {
  const parts = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean) : [];
  if (!parts.length || parts.some((part) => /[;&|`$<>\r\n]/.test(part))) return undefined;
  return { executable: parts[0], args: parts.slice(1), display: parts.join(" ") };
}

function packageManager(root: string) {
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(root, "bun.lock")) || existsSync(path.join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function packageScriptCommand(manager: string, script: string) {
  const executable = process.platform === "win32" ? `${manager}.cmd` : manager;
  const args = manager === "yarn" ? [script] : ["run", script];
  return { executable, args, display: [manager, ...args].join(" ") };
}

function scriptPort(script: string) {
  const match = script.match(/(?:--port(?:=|\s+)|\bPORT\s*=\s*)(\d{2,5})\b/i);
  const value = Number(match?.[1]);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined;
}

function classifyService(name: string, rootPath: string, manifest: JsonRecord, script: string): RuntimeServiceKind {
  const haystack = `${name} ${rootPath} ${script}`.toLowerCase();
  const dependencies = { ...record(manifest.dependencies), ...record(manifest.devDependencies) };
  if (/\b(worker|queue|consumer|job)\b/.test(haystack)) return "worker";
  if (/\b(docs?|storybook)\b/.test(haystack)) return "documentation";
  if (/\badmin\b/.test(haystack)) return "admin";
  if (/\b(websocket|socket|ws)\b/.test(haystack) || dependencies.ws || dependencies.socketio) return "websocket";
  if (/\b(api|server|backend)\b/.test(haystack) || dependencies.express || dependencies["@nestjs/core"] || dependencies.fastify) return "api";
  if (dependencies.vite || dependencies.next || dependencies.react || /\b(web|front|client|vite|next)\b/.test(haystack)) return "frontend";
  return "unknown";
}

function browserKind(kind: RuntimeServiceKind) {
  return kind === "frontend" || kind === "admin" || kind === "documentation";
}

function environmentDisclosure(names: string[], port?: number): RuntimeEnvironmentDisclosure[] {
  const unique = [...new Set([...(port ? ["PORT", "HOST"] : []), ...names])];
  return unique.map((name) => {
    const present = name === "PORT" || name === "HOST" || process.env[name] !== undefined;
    if (!present) return { name, state: "MISSING", source: "process environment presence check" };
    if (name === "PORT") return { name, state: "PRESENT", safeValue: String(port), source: "KForge session allocation" };
    if (name === "HOST") return { name, state: "PRESENT", safeValue: "127.0.0.1", source: "KForge loopback policy" };
    if (SAFE_ENV_VALUES.has(name) && !SECRET_NAME.test(name)) return { name, state: "PRESENT", safeValue: String(process.env[name]), source: "explicit safe runtime variable" };
    return { name, state: "REDACTED", source: "process environment presence check" };
  });
}

function makeService(input: {
  projectId: string; projectPath: string; id: string; name: string; kind: RuntimeServiceKind; rootPath: string;
  command: RuntimeService["command"]; source: RuntimeService["source"]; dependencies?: RuntimeDependency[];
  requestedPort?: number; healthKind?: RuntimeHealth["kind"]; healthEndpoint?: string; browserEntrypoint?: string;
  browserLabel?: string; envRequired?: string[];
}): RuntimeService {
  const hasPort = input.requestedPort !== undefined || input.healthKind === "HTTP" || input.healthKind === "TCP" || Boolean(input.browserEntrypoint);
  const healthKind = input.healthKind || (input.browserEntrypoint ? "HTTP" : "PROCESS");
  return {
    id: input.id,
    projectId: input.projectId,
    name: input.name,
    kind: input.kind,
    rootPath: input.rootPath,
    relativeRoot: relative(input.projectPath, input.rootPath),
    command: input.command,
    source: input.source,
    dependencies: input.dependencies || [],
    port: {
      requested: input.requestedPort,
      protocol: healthKind === "HTTP" ? "http" : healthKind === "TCP" ? "tcp" : "process",
      host: "127.0.0.1",
      ownership: "UNALLOCATED",
      collision: "NOT_CHECKED",
      evidence: hasPort ? "Port has not been allocated or checked." : "This process has no detected listener requirement.",
    },
    state: "DISCOVERED",
    health: { kind: healthKind, verdict: healthKind === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "NOT_CAPTURED", detail: "No runtime health evidence has been captured." },
    healthEndpoint: input.healthEndpoint,
    browserEntrypoint: input.browserEntrypoint,
    browserLabel: input.browserLabel,
    networkPolicy: healthKind === "PROCESS" || healthKind === "NOT_APPLICABLE" ? "PROCESS_ONLY" : "PROJECT_DECLARED_LOCAL_BEHAVIOR",
    environment: environmentDisclosure(input.envRequired || [], input.requestedPort),
    restartPolicy: "MANUAL",
    logs: [],
  };
}

async function packageManifests(root: string, maxDepth = 5): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || found.length >= 200) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) found.push(path.join(directory, "package.json"));
    await Promise.all(entries.filter((entry) => entry.isDirectory() && !["node_modules", ".git", "dist", "build", "release", ".next"].includes(entry.name)).map((entry) => visit(path.join(directory, entry.name), depth + 1)));
  }
  await visit(root, 0);
  return found;
}

function explicitKind(value: unknown): RuntimeServiceKind {
  return ["frontend", "backend", "api", "worker", "websocket", "documentation", "admin", "runtime", "unknown"].includes(String(value)) ? value as RuntimeServiceKind : "unknown";
}

async function discoverExplicit(projectId: string, projectPath: string, configPath: string, config: JsonRecord) {
  const manager = packageManager(projectPath);
  const rawServices = Array.isArray(config.services) ? config.services.map(record) : [];
  const services: RuntimeService[] = [];
  for (const [index, item] of rawServices.entries()) {
    const id = normalizedId(typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : `service-${index + 1}`);
    const serviceRoot = path.resolve(projectPath, typeof item.root === "string" ? item.root : ".");
    if (!inside(projectPath, serviceRoot)) continue;
    const script = typeof item.script === "string" ? item.script : undefined;
    const command = script ? packageScriptCommand(manager, script) : safeCommand(item.command);
    if (!command) continue;
    const requestedPort = Number.isInteger(item.port) && Number(item.port) > 0 && Number(item.port) <= 65535 ? Number(item.port) : undefined;
    const health = record(item.health);
    const healthKind = ["HTTP", "TCP", "PROCESS", "CUSTOM", "NOT_APPLICABLE"].includes(String(health.type).toUpperCase()) ? String(health.type).toUpperCase() as RuntimeHealth["kind"] : undefined;
    const browserPath = typeof item.browserEntrypoint === "string" ? item.browserEntrypoint : undefined;
    services.push(makeService({
      projectId, projectPath, id,
      name: typeof item.name === "string" ? item.name : id,
      kind: explicitKind(item.kind), rootPath: serviceRoot, command,
      source: { source: `${relative(projectPath, configPath)}#services[${index}]`, detail: script ? `Explicit package script ${script}.` : "Explicit argv command.", confidence: "explicit" },
      requestedPort, healthKind, healthEndpoint: typeof health.path === "string" ? health.path : undefined,
      browserEntrypoint: browserPath, browserLabel: typeof item.browserLabel === "string" ? item.browserLabel : undefined,
      envRequired: strings(item.envRequired),
    }));
  }
  const byId = new Set(services.map((service) => service.id));
  rawServices.forEach((item, index) => {
    const id = normalizedId(typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : `service-${index + 1}`);
    const service = services.find((candidate) => candidate.id === id);
    if (!service) return;
    service.dependencies = strings(item.dependencies).map(normalizedId).filter((dependency) => byId.has(dependency)).map((dependency) => ({
      serviceId: dependency,
      relationship: "CONFIGURED_DEPENDENCY",
      evidence: { source: `${relative(projectPath, configPath)}#services[${index}].dependencies`, detail: `${service.id} explicitly declares ${dependency}.`, confidence: "explicit" },
    }));
  });
  return services;
}

async function discoverPackages(projectId: string, projectPath: string) {
  const manifests = await packageManifests(projectPath);
  const manager = packageManager(projectPath);
  const candidates: Array<{ manifestPath: string; manifest: JsonRecord; packageName: string; service: RuntimeService }> = [];
  for (const manifestPath of manifests) {
    const manifest = await readJson(manifestPath);
    if (!manifest) continue;
    const scripts = record(manifest.scripts);
    const scriptName = ["preview", "dev", "start", "serve", "worker"].find((name) => typeof scripts[name] === "string");
    if (!scriptName) continue;
    const script = String(scripts[scriptName]);
    const serviceRoot = path.dirname(manifestPath);
    const packageName = typeof manifest.name === "string" ? manifest.name : path.basename(serviceRoot);
    const kind = classifyService(packageName, relative(projectPath, serviceRoot), manifest, script);
    const requestedPort = scriptPort(script);
    const isBrowser = browserKind(kind) || /\b(vite|next|react-scripts|astro|storybook)\b/i.test(script);
    candidates.push({ manifestPath, manifest, packageName, service: makeService({
      projectId, projectPath, id: normalizedId(relative(projectPath, serviceRoot) === "." ? packageName : relative(projectPath, serviceRoot)),
      name: packageName, kind, rootPath: serviceRoot, command: packageScriptCommand(manager, scriptName),
      source: { source: `${relative(projectPath, manifestPath)}#scripts.${scriptName}`, detail: `Runnable package script: ${script}`, confidence: "high" },
      requestedPort, healthKind: isBrowser || kind === "api" || kind === "backend" || kind === "websocket" ? "HTTP" : "PROCESS",
      browserEntrypoint: isBrowser ? "/" : undefined, browserLabel: isBrowser ? packageName : undefined,
    }) });
  }
  const packageId = new Map(candidates.map((candidate) => [candidate.packageName, candidate.service.id]));
  for (const candidate of candidates) {
    const declared = { ...record(candidate.manifest.dependencies), ...record(candidate.manifest.devDependencies), ...record(candidate.manifest.peerDependencies) };
    candidate.service.dependencies = Object.keys(declared).flatMap((name): RuntimeDependency[] => {
      const dependency = packageId.get(name);
      if (!dependency || dependency === candidate.service.id) return [];
      return [{ serviceId: dependency, relationship: "WORKSPACE_PACKAGE_DEPENDENCY", evidence: { source: `${relative(projectPath, candidate.manifestPath)}#dependencies.${name}`, detail: `Runnable workspace package ${candidate.packageName} declares runnable workspace package ${name}.`, confidence: "high" } }];
    });
  }
  return candidates.map((candidate) => candidate.service);
}

export async function discoverRuntimeTopology(projectId: string, projectPath: string): Promise<RuntimeTopologyDiscovery> {
  const configPath = path.join(projectPath, ".kforge", "topology.json");
  const config = await readJson(configPath);
  const services = config ? await discoverExplicit(projectId, projectPath, configPath, config) : await discoverPackages(projectId, projectPath);
  const sources = new Set(services.map((service) => service.source.source));
  if (existsSync(path.join(projectPath, "turbo.json"))) sources.add("turbo.json (workspace evidence only; service commands remain package-script backed)");
  if (existsSync(path.join(projectPath, "nx.json"))) sources.add("nx.json (workspace evidence only; service commands remain package-script backed)");
  if (existsSync(path.join(projectPath, "pnpm-workspace.yaml"))) sources.add("pnpm-workspace.yaml (workspace evidence)");
  const discovery: RuntimeTopologyDiscovery = {
    projectId, projectPath, discoveredAt: now(), state: services.length ? "DISCOVERED" : "UNAVAILABLE", services,
    evidenceSources: [...sources],
    limitations: [
      "Automatic discovery executes no project code and exposes only manifest-backed runnable services.",
      "Docker Compose, Procfile, framework-native Python/.NET/Java/Go/Rust/PHP topology expansion is UNAVAILABLE unless services are declared in .kforge/topology.json; root Preview detection remains available through its compatibility contract.",
      "Static dependency edges are shown only for explicit topology configuration or runnable workspace package dependencies; all other relationships remain UNKNOWN.",
      "Observed browser traffic requires browser instrumentation and is NOT_CAPTURED by this server-side process topology.",
    ],
  };
  discoveries.set(projectId, discovery);
  return cloneDiscovery(discovery);
}

function cloneService(service: RuntimeService): RuntimeService {
  return {
    ...service,
    command: { ...service.command }, source: { ...service.source }, port: { ...service.port }, health: { ...service.health },
    dependencies: service.dependencies.map((dependency) => ({ ...dependency, evidence: { ...dependency.evidence } })),
    environment: service.environment.map((item) => ({ ...item })), logs: service.logs.map((line) => ({ ...line })),
    processOwner: service.processOwner ? { ...service.processOwner } : undefined,
  };
}

function cloneDiscovery(discovery: RuntimeTopologyDiscovery): RuntimeTopologyDiscovery {
  return { ...discovery, services: discovery.services.map(cloneService), evidenceSources: [...discovery.evidenceSources], limitations: [...discovery.limitations] };
}

function cloneSession(session: TopologySession): TopologySession {
  return { ...session, services: session.services.map(cloneService), timeline: session.timeline.map((item) => ({ ...item })), logs: session.logs.map((item) => ({ ...item })), problems: session.problems.map((item) => ({ ...item })), networkEvidence: session.networkEvidence.map((item) => ({ ...item })), limits: { ...session.limits } };
}

function timeline(session: TopologySession, phase: RuntimeTimelineEvent["phase"], detail: string, serviceId?: string) {
  session.timeline = [...session.timeline, { at: now(), phase, detail, serviceId }].slice(-MAX_TIMELINE);
}

function log(topology: ActiveTopology, service: RuntimeService, stream: RuntimeLogLine["stream"], value: string) {
  const lines = value.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const message of lines) {
    const item = { at: now(), serviceId: service.id, stream, message: message.slice(0, 1_500) } satisfies RuntimeLogLine;
    service.logs = [...service.logs, item].slice(-MAX_SERVICE_LOG_LINES);
    topology.session.logs = [...topology.session.logs, item].slice(-MAX_LOG_LINES);
  }
}

function problem(session: TopologySession, item: Omit<RuntimeProblem, "id" | "at">) {
  const existing = session.problems.find((candidate) => candidate.kind === item.kind && candidate.serviceId === item.serviceId && candidate.detail === item.detail);
  if (existing) return;
  session.problems = [...session.problems, { ...item, id: randomUUID(), at: now() }].slice(-MAX_PROBLEMS);
}

function portAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address(); const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function resolveWindowsCommand(command: RuntimeService["command"]) {
  if (process.platform !== "win32" || command.executable.toLowerCase() !== "npm.cmd") return { command: command.executable, args: command.args, runAsNode: false };
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) return { command: command.executable, args: command.args, runAsNode: false };
  return { command: process.execPath, args: [npmCli, ...command.args], runAsNode: Boolean(process.versions.electron) };
}

function loopbackUrl(service: RuntimeService, endpoint?: string) {
  if (!service.port.allocated) return undefined;
  const base = `http://127.0.0.1:${service.port.allocated}`;
  return new URL(endpoint || service.healthEndpoint || service.browserEntrypoint || "/", base).toString();
}

async function tcpProbe(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1_500); socket.once("connect", () => done(true)); socket.once("timeout", () => done(false)); socket.once("error", () => done(false));
  });
}

async function probeService(topology: ActiveTopology, service: RuntimeService): Promise<void> {
  if (!topology.active.has(service.id) || !["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(service.state)) return;
  const checkedAt = now(); const started = performance.now();
  if (!service.health.checkedAt) timeline(topology.session, "first-health-probe", `First ${service.health.kind} health evidence requested.`, service.id);
  if (service.health.kind === "PROCESS" || service.health.kind === "NOT_APPLICABLE") {
    service.health = { kind: service.health.kind, verdict: service.health.kind === "PROCESS" ? "RUNNING" : "NOT_APPLICABLE", checkedAt, detail: service.health.kind === "PROCESS" ? "KForge-owned process is alive; no listener or HTTP health is claimed." : "No health probe applies to this service." };
    service.state = "RUNNING"; return;
  }
  if (!service.port.allocated) return;
  try {
    if (service.health.kind === "TCP") {
      const ok = await tcpProbe(service.port.allocated);
      service.health = { kind: "TCP", verdict: ok ? "HEALTHY" : "UNHEALTHY", checkedAt, latencyMs: Math.round(performance.now() - started), detail: ok ? `TCP listener accepted a loopback connection on ${service.port.allocated}.` : `No TCP listener responded on ${service.port.allocated}.` };
      if (ok) { service.state = "HEALTHY"; timeline(topology.session, "listener-detected", service.health.detail, service.id); }
      return;
    }
    const url = loopbackUrl(service);
    if (!url) return;
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_500) });
    const latencyMs = Math.round(performance.now() - started);
    service.health = { kind: service.health.kind, verdict: response.ok ? "HEALTHY" : "UNHEALTHY", checkedAt, status: response.status, latencyMs, endpoint: url, detail: `HTTP ${response.status} ${response.statusText}` };
    if (response.ok) {
      const first = service.state !== "HEALTHY"; service.state = "HEALTHY"; service.port.ownership = "UNKNOWN"; service.port.collision = "NONE";
      service.port.evidence = `Port was free before spawn and responding ${service.health.kind} evidence appeared afterward. OS-level listener PID attribution is not captured, so port ownership remains UNKNOWN rather than inferred.`;
      if (first) { timeline(topology.session, "listener-detected", `${service.health.kind} listener responded at ${url}.`, service.id); timeline(topology.session, "healthy", service.health.detail, service.id); }
    } else if (service.state === "HEALTHY") {
      service.state = "DEGRADED";
      problem(topology.session, { serviceId: service.id, kind: "HEALTH_FAILURE", severity: "error", detail: service.health.detail, evidence: url });
      propagateDependencyFailure(topology, service);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    service.health = { kind: service.health.kind, verdict: "UNHEALTHY", checkedAt, latencyMs: Math.round(performance.now() - started), endpoint: loopbackUrl(service), detail };
    if (service.state === "HEALTHY") { service.state = "DEGRADED"; propagateDependencyFailure(topology, service); }
  }
}

function aggregate(session: TopologySession) {
  const states = session.services.map((service) => service.state);
  if (!states.length) return "UNAVAILABLE" as const;
  if (states.some((state) => state === "STARTING" || state === "STOPPING")) return states.some((state) => state === "STARTING") ? "STARTING" as const : "STOPPING" as const;
  const good = states.filter((state) => state === "HEALTHY" || state === "RUNNING").length;
  const bad = states.filter((state) => state === "FAILED" || state === "BLOCKED" || state === "DEGRADED" || state === "UNAVAILABLE").length;
  if (good && bad) return "DEGRADED" as const;
  if (bad && !good) return "FAILED" as const;
  if (good === states.length) return states.every((state) => state === "HEALTHY") ? "HEALTHY" as const : "RUNNING" as const;
  if (states.every((state) => state === "STOPPED" || state === "NOT_STARTED" || state === "DISCOVERED")) return states.some((state) => state === "STOPPED") ? "STOPPED" as const : "DISCOVERED" as const;
  return "UNKNOWN" as const;
}

function refreshAggregate(topology: ActiveTopology) { topology.session.state = aggregate(topology.session); }

function propagateDependencyFailure(topology: ActiveTopology, failed: RuntimeService) {
  for (const dependent of topology.session.services.filter((service) => service.dependencies.some((dependency) => dependency.serviceId === failed.id))) {
    if (["HEALTHY", "RUNNING"].includes(dependent.state)) dependent.state = "DEGRADED";
    const edge = dependent.dependencies.find((dependency) => dependency.serviceId === failed.id)!;
    problem(topology.session, { serviceId: dependent.id, kind: "DEPENDENCY_UNAVAILABLE", severity: "error", detail: `${dependent.name} is degraded because dependency ${failed.name} is ${failed.state}.`, evidence: edge.evidence.source });
  }
}

function startScheduler(topology: ActiveTopology) {
  if (topology.scheduler) return;
  topology.scheduler = setInterval(() => { void Promise.all(topology.session.services.map((service) => probeService(topology, service))).then(() => refreshAggregate(topology)); }, HEALTH_INTERVAL_MS);
  topology.scheduler.unref();
}

async function createSession(projectId: string, projectPath: string) {
  const discovery = await discoverRuntimeTopology(projectId, projectPath);
  const session: TopologySession = {
    id: randomUUID(), projectId, projectPath, createdAt: now(), state: discovery.state === "UNAVAILABLE" ? "UNAVAILABLE" : "DISCOVERED",
    services: discovery.services.map((service) => ({ ...cloneService(service), state: "NOT_STARTED" })),
    selectedEntrypoint: discovery.services.find((service) => service.browserEntrypoint)?.id,
    timeline: [], logs: [], problems: [], networkEvidence: [],
    limits: { logLines: MAX_LOG_LINES, healthRecordsPerService: 1, timelineEvents: MAX_TIMELINE, networkRecords: MAX_NETWORK },
  };
  timeline(session, "session-created", `Topology session ${session.id} created without executing project code.`);
  session.services.forEach((service) => {
    timeline(session, "discovered", `${service.name} discovered from ${service.source.source}.`, service.id);
    service.dependencies.forEach((dependency) => {
      timeline(session, "dependency-resolved", `${service.id} depends on ${dependency.serviceId}: ${dependency.evidence.detail}`, service.id);
      session.networkEvidence.push({ at: now(), sourceServiceId: service.id, destinationServiceId: dependency.serviceId, relationship: "CONFIGURED_DEPENDENCY", detail: dependency.evidence.detail, evidence: dependency.evidence.source });
    });
  });
  const topology = { session, active: new Map<string, ActiveService>() };
  sessions.set(projectId, topology); return topology;
}

async function ensureSession(projectId: string, projectPath: string) {
  return sessions.get(projectId) || createSession(projectId, projectPath);
}

async function startOne(topology: ActiveTopology, serviceId: string, stack = new Set<string>()): Promise<RuntimeService> {
  const service = topology.session.services.find((candidate) => candidate.id === serviceId);
  if (!service) throw new Error(`Unknown topology service ${serviceId}.`);
  if (["STARTING", "RUNNING", "HEALTHY"].includes(service.state)) return service;
  if (stack.has(service.id)) { service.state = "BLOCKED"; problem(topology.session, { serviceId, kind: "DEPENDENCY_UNAVAILABLE", severity: "error", detail: "Dependency cycle blocks deterministic startup.", evidence: [...stack, service.id].join(" -> ") }); return service; }
  const nextStack = new Set(stack).add(service.id);
  for (const dependency of service.dependencies) {
    const dependencyService = await startOne(topology, dependency.serviceId, nextStack);
    if (!["HEALTHY", "RUNNING"].includes(dependencyService.state)) {
      service.state = "BLOCKED";
      problem(topology.session, { serviceId, kind: "DEPENDENCY_UNAVAILABLE", severity: "error", detail: `${service.name} is blocked by ${dependencyService.name} (${dependencyService.state}).`, evidence: dependency.evidence.source });
      refreshAggregate(topology); return service;
    }
  }
  const requiresPort = service.port.protocol !== "process";
  if (requiresPort) {
    const port = service.port.requested || await reservePort();
    if (service.port.requested && !(await portAvailable(port))) {
      service.port = { ...service.port, allocated: port, ownership: "EXTERNAL", collision: "PORT_CONFLICT", evidence: `Loopback bind check proved port ${port} was occupied before KForge spawned this service. The owning process was not terminated.` };
      service.state = "BLOCKED";
      problem(topology.session, { serviceId, kind: "PORT_CONFLICT", severity: "error", detail: `Requested port ${port} is already occupied.`, evidence: service.port.evidence });
      timeline(topology.session, "failed", `Port ${port} conflict; no process was spawned.`, serviceId); refreshAggregate(topology); return service;
    }
    service.port = { ...service.port, allocated: port, ownership: "UNKNOWN", collision: "NONE", evidence: `Loopback bind check proved port ${port} was available immediately before spawn. Listener PID attribution has not been captured.` };
    timeline(topology.session, "port-allocated", `${service.port.requested ? "Requested" : "Dynamic"} loopback port ${port} allocated.`, serviceId);
  } else {
    service.port = { ...service.port, ownership: "UNALLOCATED", collision: "NONE", evidence: "Process-only service does not claim a listener port." };
  }
  service.environment = environmentDisclosure(service.environment.map((item) => item.name).filter((name) => !["PORT", "HOST"].includes(name)), service.port.allocated);
  const missing = service.environment.filter((item) => item.state === "MISSING");
  if (missing.length) missing.forEach((item) => problem(topology.session, { serviceId, kind: "MISSING_ENVIRONMENT", severity: "warning", detail: `${item.name} is missing.`, evidence: item.source }));
  service.state = "STARTING"; service.startedAt = now(); service.stoppedAt = undefined; service.exitCode = undefined; service.exitSignal = undefined;
  const launch = resolveWindowsCommand(service.command);
  const child = spawn(launch.command, launch.args, {
    cwd: service.rootPath, shell: false, windowsHide: true, detached: process.platform !== "win32",
    env: { ...process.env, ...(launch.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...(service.port.allocated ? { PORT: String(service.port.allocated), HOST: "127.0.0.1", ASPNETCORE_URLS: `http://127.0.0.1:${service.port.allocated}` } : {}) },
  });
  if (!child.pid) {
    child.once("error", () => { /* The unavailable-command evidence is recorded synchronously below. */ });
    service.state = "FAILED"; service.health = { ...service.health, verdict: "UNHEALTHY", checkedAt: now(), detail: "The command could not be spawned and provided no PID." };
    problem(topology.session, { serviceId, kind: "COMMAND_UNAVAILABLE", severity: "error", detail: "The service command could not be spawned and did not provide a PID.", evidence: service.command.display });
    timeline(topology.session, "failed", service.health.detail, service.id); refreshAggregate(topology); return service;
  }
  service.processId = child.pid;
  service.processOwner = { sessionId: topology.session.id, serviceId, pid: child.pid, spawnedAt: service.startedAt, command: service.command.display };
  topology.active.set(service.id, { child, service });
  timeline(topology.session, "process-spawned", `KForge spawned owned PID ${child.pid} from ${service.source.source}.`, service.id);
  log(topology, service, "system", `Spawned owned PID ${child.pid}: ${service.command.display}`);
  child.stdout?.on("data", (data: Buffer) => log(topology, service, "stdout", data.toString()));
  child.stderr?.on("data", (data: Buffer) => log(topology, service, "stderr", data.toString()));
  child.once("error", (error) => {
    service.state = "FAILED"; service.health = { ...service.health, verdict: "UNHEALTHY", checkedAt: now(), detail: error.message };
    log(topology, service, "system", error.message); timeline(topology.session, "failed", error.message, service.id);
    problem(topology.session, { serviceId, kind: "COMMAND_UNAVAILABLE", severity: "error", detail: error.message, evidence: service.command.display }); refreshAggregate(topology);
  });
  child.once("exit", (code, signal) => {
    const requested = service.state === "STOPPING" || service.state === "STOPPED";
    service.exitCode = code; service.exitSignal = signal; service.stoppedAt = now(); service.state = requested ? "STOPPED" : "FAILED";
    service.health = { ...service.health, verdict: requested ? "NOT_CAPTURED" : "UNHEALTHY", checkedAt: now(), detail: `Process exited with code ${code ?? "unknown"}${signal ? ` and signal ${signal}` : ""}.` };
    log(topology, service, "system", service.health.detail); timeline(topology.session, requested ? "stopped" : "failed", service.health.detail, service.id);
    if (!requested) problem(topology.session, { serviceId, kind: "UNEXPECTED_EXIT", severity: "error", detail: service.health.detail, evidence: `Owned PID ${child.pid}; ${service.command.display}` });
    if (!requested) propagateDependencyFailure(topology, service);
    if (topology.active.get(service.id)?.child === child) topology.active.delete(service.id); refreshAggregate(topology);
  });
  startScheduler(topology);
  const deadline = Date.now() + 12_000;
  do {
    await probeService(topology, service);
    if (["HEALTHY", "RUNNING", "FAILED"].includes(service.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  if (service.state === "STARTING") {
    service.state = "DEGRADED";
    problem(topology.session, { serviceId, kind: "HEALTH_FAILURE", severity: "warning", detail: "Process is alive but did not produce healthy listener evidence within 12 seconds.", evidence: service.health.detail });
  }
  refreshAggregate(topology); return service;
}

async function terminateOwned(active: ActiveService, force = false) {
  const { child, service } = active;
  if (!service.processOwner || service.processOwner.pid !== child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])], { windowsHide: true });
      killer.once("exit", () => resolve()); killer.once("error", () => resolve());
    });
  } else {
    try { process.kill(-child.pid!, force ? "SIGKILL" : "SIGTERM"); } catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch { /* already gone */ } }
  }
}

async function stopOne(topology: ActiveTopology, serviceId: string, timeoutMs = 4_000): Promise<RuntimeService> {
  const service = topology.session.services.find((candidate) => candidate.id === serviceId);
  if (!service) throw new Error(`Unknown topology service ${serviceId}.`);
  const active = topology.active.get(service.id);
  if (!active) { if (service.state !== "FAILED" && service.state !== "BLOCKED") service.state = "STOPPED"; refreshAggregate(topology); return service; }
  if (!service.processOwner || service.processOwner.sessionId !== topology.session.id || service.processOwner.serviceId !== service.id || service.processOwner.pid !== active.child.pid) throw new Error(`Process ownership mismatch refused stop for ${service.id}.`);
  service.state = "STOPPING"; timeline(topology.session, "stop-requested", `Stop requested for owned PID ${active.child.pid}.`, service.id); log(topology, service, "system", "Stop requested by KForge.");
  const exited = new Promise<boolean>((resolve) => {
    if (active.child.exitCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    active.child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
  await terminateOwned(active, false);
  if (!(await exited)) {
    const forcedExit = new Promise<boolean>((resolve) => {
      if (active.child.exitCode !== null) return resolve(true);
      const timer = setTimeout(() => resolve(false), 2_000);
      active.child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
    await terminateOwned(active, true);
    if (!(await forcedExit)) throw new Error(`Owned process ${active.child.pid} did not exit after safe escalation.`);
  }
  if (active.child.exitCode === null && topology.active.has(service.id)) throw new Error(`Owned process ${active.child.pid} did not exit after safe escalation.`);
  service.state = "STOPPED"; service.stoppedAt ||= now(); topology.active.delete(service.id); refreshAggregate(topology); return service;
}

function dependencyOrder(services: RuntimeService[]) {
  const visited = new Set<string>(); const visiting = new Set<string>(); const order: string[] = [];
  function visit(id: string) {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id); const service = services.find((candidate) => candidate.id === id);
    service?.dependencies.forEach((dependency) => visit(dependency.serviceId));
    visiting.delete(id); visited.add(id); order.push(id);
  }
  services.forEach((service) => visit(service.id)); return order;
}

export async function getRuntimeTopology(projectId: string, projectPath: string) {
  const discovery = await discoverRuntimeTopology(projectId, projectPath);
  const topology = sessions.get(projectId);
  return { discovery, session: topology ? cloneSession(topology.session) : undefined };
}

export function getTopologySession(projectId: string) { const topology = sessions.get(projectId); return topology ? cloneSession(topology.session) : undefined; }

export async function startTopology(projectId: string, projectPath: string) {
  const existing = sessions.get(projectId);
  const topology = existing && !existing.session.endedAt ? existing : await createSession(projectId, projectPath);
  for (const serviceId of dependencyOrder(topology.session.services)) await startOne(topology, serviceId);
  refreshAggregate(topology); return cloneSession(topology.session);
}

export async function startTopologyService(projectId: string, projectPath: string, serviceId: string) {
  const topology = await ensureSession(projectId, projectPath); await startOne(topology, serviceId); return cloneSession(topology.session);
}

export async function stopTopologyService(projectId: string, serviceId: string) {
  const topology = sessions.get(projectId); if (!topology) throw new Error("No topology session exists.");
  await stopOne(topology, serviceId); return cloneSession(topology.session);
}

export async function restartTopologyService(projectId: string, projectPath: string, serviceId: string) {
  const topology = await ensureSession(projectId, projectPath); await stopOne(topology, serviceId); await startOne(topology, serviceId); return cloneSession(topology.session);
}

export async function checkTopologyHealth(projectId: string) {
  const topology = sessions.get(projectId); if (!topology) return undefined;
  await Promise.all(topology.session.services.map((service) => probeService(topology, service))); refreshAggregate(topology); return cloneSession(topology.session);
}

export async function stopTopology(projectId: string) {
  const topology = sessions.get(projectId); if (!topology) return undefined;
  const order = dependencyOrder(topology.session.services).reverse();
  for (const serviceId of order) await stopOne(topology, serviceId);
  if (topology.scheduler) clearInterval(topology.scheduler);
  topology.session.endedAt = now(); topology.session.state = "STOPPED"; return cloneSession(topology.session);
}

export async function restartTopology(projectId: string, projectPath: string) {
  await stopTopology(projectId); sessions.delete(projectId); return startTopology(projectId, projectPath);
}

export async function stopAllTopologies() {
  const results = await Promise.allSettled([...sessions.keys()].map(stopTopology));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) throw new Error(`KForge could not stop ${failed.length} topology session(s).`);
}
