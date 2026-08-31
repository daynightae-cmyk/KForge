import { spawn } from "child_process";
import type { RuntimePort, RuntimeService } from "../../shared/topology";
import { attributeListenerPort } from "./listenerAttribution";
import type { RuntimeControlCommand, RuntimeControlPlan } from "./topologyDetectors";

const controls = new Map<string, Map<string, RuntimeControlPlan>>();

export function registerRuntimeControls(projectId: string, plans: Record<string, RuntimeControlPlan>) {
  controls.set(projectId, new Map(Object.entries(plans)));
}

export function runtimeControlPlan(projectId: string, serviceId: string) {
  return controls.get(projectId)?.get(serviceId);
}

function sessionToken(sessionId: string) {
  return `kforge-${sessionId.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || "session"}`;
}

function materialize(value: string, sessionId: string, service: RuntimeService) {
  const port = String(service.port.allocated || service.port.requested || "");
  return value
    .replace(/\{PORT\}/g, port)
    .replace(/\{HOST\}/g, "127.0.0.1")
    .replace(/\{SESSION\}/g, sessionToken(sessionId));
}

export function materializeRuntimeCommand(sessionId: string, service: RuntimeService, source: RuntimeControlCommand = service.command) {
  const executable = materialize(source.executable, sessionId, service);
  const args = source.args.map((arg) => materialize(arg, sessionId, service));
  return { executable, args, display: [executable, ...args].join(" ") };
}

export function materializeRuntimeEnvironment(projectId: string, sessionId: string, service: RuntimeService) {
  const plan = runtimeControlPlan(projectId, service.id);
  return Object.fromEntries(Object.entries(plan?.env || {}).map(([name, value]) => [name, materialize(value, sessionId, service)]));
}

async function runControlCommand(sessionId: string, service: RuntimeService, command: RuntimeControlCommand, timeoutMs = 15_000) {
  const resolved = materializeRuntimeCommand(sessionId, service, command);
  return await new Promise<{ ok: boolean; code: number; output: string }>((resolve) => {
    const child = spawn(resolved.executable, resolved.args, { cwd: service.rootPath, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output: output.trim().slice(-20_000) });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already stopped */ } finish(124); }, timeoutMs);
    child.stdout?.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { output += data.toString(); });
    child.once("error", (error) => { output += error.message; finish(127); });
    child.once("exit", (code) => finish(code ?? 1));
  });
}

export async function runServiceControl(projectId: string, sessionId: string, service: RuntimeService, force = false) {
  const plan = runtimeControlPlan(projectId, service.id);
  const commands = force ? plan?.forceStop : plan?.stop;
  const results: Array<{ command: string; ok: boolean; code: number; output: string }> = [];
  for (const item of commands || []) {
    const materialized = materializeRuntimeCommand(sessionId, service, item);
    const result = await runControlCommand(sessionId, service, item);
    results.push({ command: materialized.display, ...result });
  }
  return results;
}

export async function runTopologyCleanup(projectId: string, sessionId: string, services: RuntimeService[]) {
  const seen = new Set<string>();
  const results: Array<{ command: string; ok: boolean; code: number; output: string }> = [];
  for (const service of services) {
    const plan = runtimeControlPlan(projectId, service.id);
    for (const item of plan?.cleanup || []) {
      const materialized = materializeRuntimeCommand(sessionId, service, item);
      if (seen.has(materialized.display)) continue;
      seen.add(materialized.display);
      const result = await runControlCommand(sessionId, service, item, 25_000);
      results.push({ command: materialized.display, ...result });
    }
  }
  return results;
}

export interface ListenerOwnershipEvidence {
  port: RuntimePort;
  externalConflict: boolean;
  listenerPid?: number;
  relation: string;
}

export async function verifyServiceListener(projectId: string, service: RuntimeService): Promise<ListenerOwnershipEvidence> {
  if (!service.port.allocated || service.port.protocol === "process") return { port: { ...service.port }, externalConflict: false, relation: "NOT_APPLICABLE" };
  const attribution = await attributeListenerPort(service.port.allocated, service.processId);
  const plan = runtimeControlPlan(projectId, service.id);
  if (!attribution.pid) {
    return {
      port: { ...service.port, ownership: "UNKNOWN", collision: "NONE", evidence: `${attribution.detail} Attribution source: ${attribution.source}.` },
      externalConflict: false,
      relation: attribution.relation,
    };
  }
  if (attribution.relation === "SPAWNED_PROCESS" || attribution.relation === "DESCENDANT_PROCESS") {
    return {
      port: { ...service.port, ownership: "KFORGE_SESSION", collision: "NONE", evidence: `${attribution.detail} Attribution source: ${attribution.source}.` },
      externalConflict: false,
      listenerPid: attribution.pid,
      relation: attribution.relation,
    };
  }
  if (plan?.managedExternalListener) {
    return {
      port: { ...service.port, ownership: "UNKNOWN", collision: "NONE", evidence: `${attribution.detail} The service was launched through ${plan.source}; the OS listener PID is recorded, but KForge does not falsely promote a container/runtime-owned host listener to KFORGE_SESSION without process-tree proof.` },
      externalConflict: false,
      listenerPid: attribution.pid,
      relation: "MANAGED_RUNTIME_EXTERNAL_PROCESS",
    };
  }
  return {
    port: { ...service.port, ownership: "EXTERNAL", collision: "PORT_CONFLICT", evidence: `${attribution.detail} Attribution source: ${attribution.source}. The listener is not owned by the proven KForge process tree.` },
    externalConflict: true,
    listenerPid: attribution.pid,
    relation: attribution.relation,
  };
}
