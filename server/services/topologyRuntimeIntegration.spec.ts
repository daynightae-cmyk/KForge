import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeService } from "../../shared/topology";

vi.mock("./listenerAttribution", () => ({ attributeListenerPort: vi.fn() }));

import { attributeListenerPort } from "./listenerAttribution";
import { LISTENER_REVERIFY_MS, LISTENER_RETRY_MS, forgetListenerEvidence, registerRuntimeControls, verifyServiceListener } from "./topologyRuntimeIntegration";

const attribute = vi.mocked(attributeListenerPort);

function service(overrides: Partial<RuntimeService> = {}): RuntimeService {
  return {
    id: "web",
    projectId: "project",
    name: "Web",
    kind: "frontend",
    rootPath: "/tmp/project",
    relativeRoot: ".",
    command: { executable: "node", args: ["server.cjs"], display: "node server.cjs" },
    source: { source: ".kforge/topology.json#services[0]", detail: "Explicit argv command.", confidence: "explicit" },
    dependencies: [],
    port: { allocated: 43_123, protocol: "http", host: "127.0.0.1", ownership: "UNKNOWN", collision: "NONE", evidence: "Loopback bind check proved port 43123 was available." },
    processId: 4242,
    state: "HEALTHY",
    health: { kind: "HTTP", verdict: "HEALTHY", detail: "HTTP 200 OK" },
    networkPolicy: "PROJECT_DECLARED_LOCAL_BEHAVIOR",
    environment: [],
    restartPolicy: "MANUAL",
    logs: [],
    ...overrides,
  };
}

function provedOwner(pid: number, spawnedPid?: number) {
  return { pid, relation: pid === spawnedPid ? "SPAWNED_PROCESS" as const : "EXTERNAL_PROCESS" as const, source: "netstat -ano -p TCP", detail: `OS evidence attributes listener to PID ${pid}.` };
}

let projectSequence = 0;
function freshProject() {
  projectSequence += 1;
  return `project-${projectSequence}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T00:00:00.000Z"));
  attribute.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listener ownership evidence budget", () => {
  it("reads the OS once and reuses proven ownership across health checks", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));

    for (let probe = 0; probe < 5; probe += 1) {
      const result = await verifyServiceListener(projectId, service({ projectId }));
      expect(result.port.ownership).toBe("KFORGE_SESSION");
      expect(result.externalConflict).toBe(false);
      vi.advanceTimersByTime(3_000);
    }

    expect(attribute).toHaveBeenCalledTimes(1);
  });

  it("states reused evidence as reuse instead of implying a check that did not run", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));
    await verifyServiceListener(projectId, service({ projectId }));
    vi.advanceTimersByTime(3_000);
    const reused = await verifyServiceListener(projectId, service({ projectId }));

    expect(reused.port.evidence).toContain("Ownership was reused for this health check instead of re-reading the OS");
    expect(reused.port.evidence).toContain("2026-11-06T00:00:00.000Z");
    expect(reused.port.evidence).toContain(`re-verified at most every ${Math.round(LISTENER_REVERIFY_MS / 1000)}s`);
  });

  it("re-verifies proven ownership on the bounded interval rather than every probe", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));

    for (let second = 0; second < 90; second += 1) {
      await verifyServiceListener(projectId, service({ projectId }));
      vi.advanceTimersByTime(1_000);
    }

    // 90 one-second checks over 90s: capture at 0s, 30s and 60s.
    expect(attribute).toHaveBeenCalledTimes(Math.ceil(90 / (LISTENER_REVERIFY_MS / 1_000)));
  });

  it("re-attributes when the owning process identity changes", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));
    await verifyServiceListener(projectId, service({ projectId }));

    // A restart can land on a recycled PID for the same port, so the previous
    // proof must not be carried over to the new process.
    attribute.mockResolvedValue(provedOwner(9999, 9999));
    const restarted = await verifyServiceListener(projectId, service({ projectId, processId: 9999 }));

    expect(attribute).toHaveBeenCalledTimes(2);
    expect(restarted.port.ownership).toBe("KFORGE_SESSION");
  });

  it("re-attributes when the allocated port changes", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));
    await verifyServiceListener(projectId, service({ projectId }));
    await verifyServiceListener(projectId, service({ projectId, port: { ...service({ projectId }).port, allocated: 43_999 } }));
    expect(attribute).toHaveBeenCalledTimes(2);
  });

  it("drops cached ownership when a service stops", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));
    await verifyServiceListener(projectId, service({ projectId }));
    forgetListenerEvidence(projectId, "web");
    await verifyServiceListener(projectId, service({ projectId }));
    expect(attribute).toHaveBeenCalledTimes(2);
  });

  it("starts from fresh evidence when a project is rediscovered", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(4242, 4242));
    await verifyServiceListener(projectId, service({ projectId }));
    registerRuntimeControls(projectId, {});
    await verifyServiceListener(projectId, service({ projectId }));
    expect(attribute).toHaveBeenCalledTimes(2);
  });

  it("keeps a proved external conflict visible without re-reading the OS each probe", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue(provedOwner(7777, 4242));
    const first = await verifyServiceListener(projectId, service({ projectId }));
    vi.advanceTimersByTime(3_000);
    const again = await verifyServiceListener(projectId, service({ projectId }));

    expect(first.externalConflict).toBe(true);
    expect(again.port.ownership).toBe("EXTERNAL");
    expect(again.port.collision).toBe("PORT_CONFLICT");
    expect(again.externalConflict).toBe(true);
    expect(attribute).toHaveBeenCalledTimes(1);
  });

  it("retries unproved ownership on its own shorter budget", async () => {
    const projectId = freshProject();
    attribute.mockResolvedValue({ relation: "UNAVAILABLE", source: "netstat -ano -p TCP", detail: "The Windows TCP table reported no listener on port 43123." });

    for (let second = 0; second < 12; second += 1) {
      const result = await verifyServiceListener(projectId, service({ projectId }));
      expect(result.port.ownership).toBe("UNKNOWN");
      expect(result.externalConflict).toBe(false);
      vi.advanceTimersByTime(1_000);
    }

    expect(attribute).toHaveBeenCalledTimes(Math.floor(12_000 / LISTENER_RETRY_MS) + 1);
  });

  it("bounds the evidence table so a long-lived desktop process cannot grow it forever", async () => {
    attribute.mockResolvedValue(provedOwner(4242, 4242));
    const projects = Array.from({ length: 260 }, freshProject);
    for (const projectId of projects) await verifyServiceListener(projectId, service({ projectId }));
    expect(attribute).toHaveBeenCalledTimes(260);

    // The oldest project was evicted, so it must re-read the OS again.
    attribute.mockClear();
    await verifyServiceListener(projects[0], service({ projectId: projects[0] }));
    await verifyServiceListener(projects.at(-1)!, service({ projectId: projects.at(-1)! }));
    expect(attribute.mock.calls.map((call) => call[0])).toEqual([43_123]);
  });

  it("makes no OS attribution claim for a process-only service", async () => {
    const projectId = freshProject();
    const result = await verifyServiceListener(projectId, service({ projectId, port: { ...service({ projectId }).port, allocated: undefined, protocol: "process" } }));
    expect(result.relation).toBe("NOT_APPLICABLE");
    expect(attribute).not.toHaveBeenCalled();
  });
});
