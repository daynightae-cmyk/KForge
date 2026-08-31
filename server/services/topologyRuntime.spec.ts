import { createServer } from "net";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeTopology, getTopologySession, restartTopologyService, startTopology, startTopologyService, stopTopology, stopTopologyService } from "./topologyRuntime";

const roots: string[] = [];
const projectIds: string[] = [];

async function fixture(services: unknown[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-topology-")); roots.push(root);
  await fs.mkdir(path.join(root, ".kforge"), { recursive: true });
  await fs.writeFile(path.join(root, ".kforge", "topology.json"), JSON.stringify({ services }), "utf8");
  return root;
}

async function write(root: string, name: string, content: string) { await fs.writeFile(path.join(root, name), content, "utf8"); }
function command(script: string) { return [process.execPath, script]; }
function id() { const value = `topology-${Date.now()}-${Math.random()}`; projectIds.push(value); return value; }

afterEach(async () => {
  await Promise.allSettled(projectIds.splice(0).map((projectId) => stopTopology(projectId)));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("canonical runtime topology", () => {
  it("discovers explicit services and dependency evidence without executing project code", async () => {
    const root = await fixture([
      { id: "api", name: "API", kind: "api", command: command("api.cjs"), health: { type: "HTTP", path: "/health" } },
      { id: "web", name: "Web", kind: "frontend", command: command("web.cjs"), dependencies: ["api"], health: { type: "HTTP" }, browserEntrypoint: "/" },
    ]);
    const projectId = id();
    const discovery = await discoverRuntimeTopology(projectId, root);
    expect(discovery.state).toBe("DISCOVERED");
    expect(discovery.services).toHaveLength(2);
    expect(discovery.services.every((service) => service.state === "DISCOVERED" && service.processId === undefined)).toBe(true);
    expect(discovery.services.find((service) => service.id === "web")?.dependencies[0]).toMatchObject({ serviceId: "api", relationship: "CONFIGURED_DEPENDENCY", evidence: { confidence: "explicit" } });
    expect(getTopologySession(projectId)).toBeUndefined();
  });

  it("runs frontend, API, and worker in dependency order with real health and service-scoped logs", async () => {
    const root = await fixture([
      { id: "worker", name: "Worker", kind: "worker", command: command("worker.cjs"), health: { type: "PROCESS" } },
      { id: "api", name: "API", kind: "api", command: command("server.cjs"), dependencies: ["worker"], health: { type: "HTTP", path: "/health" }, envRequired: ["TOPOLOGY_TEST_SECRET"] },
      { id: "web", name: "Web", kind: "frontend", command: command("server.cjs"), dependencies: ["api"], health: { type: "HTTP" }, browserEntrypoint: "/" },
    ]);
    await write(root, "worker.cjs", "console.log('worker loop ready'); setInterval(() => {}, 1000);");
    await write(root, "server.cjs", "const http=require('node:http'); const label=process.env.PORT; http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end(req.url==='/health'?'healthy':'app '+label)}).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('listener '+label));");
    const projectId = id();
    const session = await startTopology(projectId, root);
    expect(session.state).toMatch(/HEALTHY|RUNNING/);
    expect(session.services.find((service) => service.id === "worker")).toMatchObject({ state: "RUNNING", health: { verdict: "RUNNING" } });
    expect(session.services.filter((service) => service.id !== "worker").every((service) => service.state === "HEALTHY" && service.port.allocated && service.processId)).toBe(true);
    expect(session.timeline.findIndex((event) => event.serviceId === "worker" && event.phase === "process-spawned")).toBeLessThan(session.timeline.findIndex((event) => event.serviceId === "api" && event.phase === "process-spawned"));
    expect(session.timeline.findIndex((event) => event.serviceId === "api" && event.phase === "process-spawned")).toBeLessThan(session.timeline.findIndex((event) => event.serviceId === "web" && event.phase === "process-spawned"));
    expect(session.logs.some((line) => line.serviceId === "worker" && line.message.includes("worker loop ready"))).toBe(true);
    expect(session.problems).toEqual(expect.arrayContaining([expect.objectContaining({ serviceId: "api", kind: "MISSING_ENVIRONMENT" })]));
    expect(session.services.find((service) => service.id === "api")?.environment).toContainEqual(expect.objectContaining({ name: "TOPOLOGY_TEST_SECRET", state: "MISSING" }));
  }, 30_000);

  it("restarts and stops only the selected owned service", async () => {
    const root = await fixture([
      { id: "api", kind: "api", command: command("server.cjs"), health: { type: "HTTP" } },
      { id: "web", kind: "frontend", command: command("server.cjs"), health: { type: "HTTP" }, browserEntrypoint: "/" },
    ]);
    await write(root, "server.cjs", "require('node:http').createServer((_q,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1'); setInterval(()=>{},1000);");
    const projectId = id(); const started = await startTopology(projectId, root);
    const apiPid = started.services.find((service) => service.id === "api")!.processId;
    const webPid = started.services.find((service) => service.id === "web")!.processId;
    const restarted = await restartTopologyService(projectId, root, "web");
    expect(restarted.services.find((service) => service.id === "api")?.processId).toBe(apiPid);
    expect(restarted.services.find((service) => service.id === "web")?.processId).not.toBe(webPid);
    const stopped = await stopTopologyService(projectId, "api");
    expect(stopped.services.find((service) => service.id === "api")?.state).toBe("STOPPED");
    expect(stopped.services.find((service) => service.id === "web")?.state).toBe("HEALTHY");
  }, 30_000);

  it("reports a requested port conflict and never terminates the unrelated listener", async () => {
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address(); const port = typeof address === "object" && address ? address.port : 0;
    try {
      const root = await fixture([{ id: "web", kind: "frontend", command: command("unused.cjs"), port, health: { type: "HTTP" }, browserEntrypoint: "/" }]);
      const projectId = id(); const session = await startTopologyService(projectId, root, "web");
      expect(session.services[0]).toMatchObject({ state: "BLOCKED", port: { allocated: port, ownership: "EXTERNAL", collision: "PORT_CONFLICT" } });
      expect(session.services[0].processId).toBeUndefined();
      expect(session.problems).toContainEqual(expect.objectContaining({ kind: "PORT_CONFLICT", serviceId: "web" }));
      expect(listener.listening).toBe(true);
    } finally { await new Promise<void>((resolve) => listener.close(() => resolve())); }
  });

  it("records unexpected exit evidence and degrades dependent startup", async () => {
    const root = await fixture([
      { id: "api", kind: "api", command: command("crash.cjs"), health: { type: "HTTP" } },
      { id: "web", kind: "frontend", command: command("server.cjs"), dependencies: ["api"], health: { type: "HTTP" }, browserEntrypoint: "/" },
    ]);
    await write(root, "crash.cjs", "console.error('fatal fixture crash'); process.exit(7);");
    await write(root, "server.cjs", "require('node:http').createServer((_q,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1');");
    const projectId = id(); const session = await startTopology(projectId, root);
    expect(session.services.find((service) => service.id === "api")).toMatchObject({ state: "FAILED", exitCode: 7 });
    expect(session.services.find((service) => service.id === "web")?.state).toBe("BLOCKED");
    expect(session.problems).toEqual(expect.arrayContaining([expect.objectContaining({ serviceId: "api", kind: "UNEXPECTED_EXIT" }), expect.objectContaining({ serviceId: "web", kind: "DEPENDENCY_UNAVAILABLE" })]));
  });

  it("reports a missing runtime as unavailable command evidence without a fake PID", async () => {
    const root = await fixture([{ id: "missing", kind: "runtime", command: ["kforge-runtime-that-does-not-exist"], health: { type: "PROCESS" } }]);
    const projectId = id(); const session = await startTopology(projectId, root);
    expect(session.services[0].state).toBe("FAILED");
    expect(session.services[0].processId).toBeUndefined();
    expect(session.problems).toContainEqual(expect.objectContaining({ serviceId: "missing", kind: "COMMAND_UNAVAILABLE" }));
  });
});
