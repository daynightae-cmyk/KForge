import { spawn } from "child_process";
import type { RuntimePort, RuntimeService } from "../../shared/topology";
import { attributeListenerPort } from "./listenerAttribution";
import type { RuntimeControlCommand, RuntimeControlPlan } from "./topologyDetectors";

const controls = new Map<string, Map<string, RuntimeControlPlan>>();

/**
 * Windows listener attribution crosses an OS process boundary, and it used to
 * run once per service per health tick. A proven owner re-queried every few
 * seconds spends the product's health budget on bookkeeping and pushes slow
 * attributions into the startup readiness deadline, so proven ownership is now
 * reused for a bounded window and re-verified on a schedule instead. The window
 * is part of the evidence contract: Inspector text states when attribution was
 * actually captured rather than implying a check that did not run.
 */
export const LISTENER_REVERIFY_MS = 30_000;
/** Missing OS evidence is retried sooner, but still not on every probe. */
export const LISTENER_RETRY_MS = 5_000;
const MAX_LISTENER_EVIDENCE_ENTRIES = 256;

type CachedListenerEvidence = {
  port: number;
  spawnedPid?: number;
  capturedAt: number;
  /** True only when the OS produced an owning PID; false means nothing was proved. */
  conclusive: boolean;
  ownership: ListenerOwnershipEvidence;
};

const listenerEvidence = new Map<string, CachedListenerEvidence>();

function listenerKey(projectId: string, serviceId: string) {
  return `${projectId}\u0000${serviceId}`;
}

function forgetProjectListenerEvidence(projectId: string) {
  for (const key of listenerEvidence.keys()) if (key.startsWith(`${projectId}\u0000`)) listenerEvidence.delete(key);
}

export function forgetListenerEvidence(projectId: string, serviceId: string) {
  listenerEvidence.delete(listenerKey(projectId, serviceId));
}

function rememberListenerEvidence(projectId: string, service: RuntimeService, capturedAt: number, conclusive: boolean, ownership: ListenerOwnershipEvidence) {
  const key = listenerKey(projectId, service.id);
  listenerEvidence.delete(key);
  // The live service object keeps mutating its own port evidence, so the cache
  // stores a detached copy: the reuse text is always appended to the evidence
  // that was actually captured, never to whatever the service says now.
  listenerEvidence.set(key, {
    port: service.port.allocated ?? 0,
    spawnedPid: service.processId,
    capturedAt,
    conclusive,
    ownership: { ...ownership, port: { ...ownership.port } },
  });
  // A long-lived desktop process can cycle through many projects; keep the
  // table bounded and drop the oldest entries first.
  while (listenerEvidence.size > MAX_LISTENER_EVIDENCE_ENTRIES) {
    const oldest = listenerEvidence.keys().next();
    if (oldest.done) break;
    listenerEvidence.delete(oldest.value);
  }
}

export function registerRuntimeControls(projectId: string, plans: Record<string, RuntimeControlPlan>) {
  controls.set(projectId, new Map(Object.entries(plans)));
  // A fresh discovery is a fresh claim about the runtime, so previously
  // attributed listener evidence no longer applies to it.
  forgetProjectListenerEvidence(projectId);
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

  const cached = listenerEvidence.get(listenerKey(projectId, service.id));
  if (cached && cached.port === service.port.allocated && cached.spawnedPid === service.processId) {
    const age = Date.now() - cached.capturedAt;
    const withinWindow = cached.conclusive ? age < LISTENER_REVERIFY_MS : age < LISTENER_RETRY_MS;
    if (withinWindow) {
      const capturedAt = new Date(cached.capturedAt).toISOString();
      const budget = Math.round((cached.conclusive ? LISTENER_REVERIFY_MS : LISTENER_RETRY_MS) / 1000);
      const note = cached.conclusive
        ? ` Ownership was reused for this health check instead of re-reading the OS; the last real attribution was captured at ${capturedAt} and is re-verified at most every ${budget}s.`
        : ` No listener owner was proved; that absence was captured at ${capturedAt} and is retried at most every ${budget}s.`;
      return { ...cached.ownership, port: { ...cached.ownership.port, evidence: `${cached.ownership.port.evidence}${note}` } };
    }
  }

  const attribution = await attributeListenerPort(service.port.allocated, service.processId);
  const plan = runtimeControlPlan(projectId, service.id);
  const capturedAt = Date.now();
  if (!attribution.pid) {
    const ownership: ListenerOwnershipEvidence = {
      port: { ...service.port, ownership: "UNKNOWN", collision: "NONE", evidence: `${attribution.detail} Attribution source: ${attribution.source}.` },
      externalConflict: false,
      relation: attribution.relation,
    };
    rememberListenerEvidence(projectId, service, capturedAt, false, ownership);
    return ownership;
  }
  if (attribution.relation === "SPAWNED_PROCESS" || attribution.relation === "DESCENDANT_PROCESS") {
    const ownership: ListenerOwnershipEvidence = {
      port: { ...service.port, ownership: "KFORGE_SESSION", collision: "NONE", evidence: `${attribution.detail} Attribution source: ${attribution.source}.` },
      externalConflict: false,
      listenerPid: attribution.pid,
      relation: attribution.relation,
    };
    rememberListenerEvidence(projectId, service, capturedAt, true, ownership);
    return ownership;
  }
  if (plan?.managedExternalListener) {
    const ownership: ListenerOwnershipEvidence = {
      port: { ...service.port, ownership: "UNKNOWN", collision: "NONE", evidence: `${attribution.detail} The service was launched through ${plan.source}; the OS listener PID is recorded, but KForge does not falsely promote a container/runtime-owned host listener to KFORGE_SESSION without process-tree proof.` },
      externalConflict: false,
      listenerPid: attribution.pid,
      relation: "MANAGED_RUNTIME_EXTERNAL_PROCESS",
    };
    rememberListenerEvidence(projectId, service, capturedAt, true, ownership);
    return ownership;
  }
  const ownership: ListenerOwnershipEvidence = {
    port: { ...service.port, ownership: "EXTERNAL", collision: "PORT_CONFLICT", evidence: `${attribution.detail} Attribution source: ${attribution.source}. The listener is not owned by the proven KForge process tree.` },
    externalConflict: true,
    listenerPid: attribution.pid,
    relation: attribution.relation,
  };
  rememberListenerEvidence(projectId, service, capturedAt, true, ownership);
  return ownership;
}
