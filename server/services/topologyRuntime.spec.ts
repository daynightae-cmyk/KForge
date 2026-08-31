import { createServer } from "net";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeTopology, getTopologySession, recordTopologyBrowserTraffic, restartTopologyService, startTopology, startTopologyService, stopTopology, stopTopologyService } from "./topologyRuntime";

const roots: string[] = [];
const projectIds: string[] = [];

async function fixture(services: unknown[]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-topology-")); roots.push(root);
  await fs.mkdir(path.join(root, ".kforge"), { recursive: true });
  await fs.writeFile(path.join(root, ".kforge", "topology.json"), JSON.stringify({ services }), "utf8");
  return root;
}

async function write(root: string, name: string, content: string) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content, "utf8"); }
async function bare() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-topology-auto-")); roots.push(root); return root; }
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

  it("discovers Docker Compose dependencies and published ports without executing Docker", async () => {
    const root = await bare();
    await write(root, "compose.yaml", [
      "services:",
      "  api:",
      "    image: example/api",
      "    ports:",
      "      - '43123:8080'",
      "  web:",
      "    image: example/web",
      "    depends_on:",
      "      - api",
      "    ports:",
      "      - '43124:3000'",
    ].join("\n"));
    const projectId = id();
    const discovery = await discoverRuntimeTopology(projectId, root);
    expect(discovery.services.map((service) => service.id)).toEqual(["api", "web"]);
    expect(discovery.services.find((service) => service.id === "api")?.port.requested).toBe(43123);
    expect(discovery.services.find((service) => service.id === "web")?.dependencies[0]).toMatchObject({ serviceId: "api", relationship: "CONFIGURED_DEPENDENCY" });
    expect(discovery.services.every((service) => service.processId === undefined)).toBe(true);
    expect(discovery.evidenceSources).toContain("compose.yaml");
  });

  it("discovers safe Procfile processes and PORT ownership requirements without a shell", async () => {
    const root = await bare();
    await write(root, "Procfile", "web: node server.cjs --port $PORT\nworker: node worker.cjs\nunsafe: node bad.cjs && echo nope\n");
    const discovery = await discoverRuntimeTopology(id(), root);
    expect(discovery.services.map((service) => service.id)).toEqual(["web", "worker"]);
    expect(discovery.services.find((service) => service.id === "web")).toMatchObject({ kind: "frontend", health: { kind: "TCP" }, browserEntrypoint: "/" });
    expect(discovery.services.find((service) => service.id === "web")?.command.display).toContain("{PORT}");
    expect(discovery.services.some((service) => service.id === "unsafe")).toBe(false);
  });

  it("discovers evidence-backed native Python, .NET, Java, Go, Rust, and PHP runtimes", async () => {
    const cases: Array<{ prepare: (root: string) => Promise<void>; expected: RegExp }> = [
      { expected: /FastAPI/, prepare: async (root) => { await write(root, "pyproject.toml", "dependencies = ['fastapi', 'uvicorn']"); await write(root, "main.py", "from fastapi import FastAPI\napp = FastAPI()\n"); } },
      { expected: /dotnet-/, prepare: async (root) => { await write(root, "web.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>'); } },
      { expected: /Spring Boot/, prepare: async (root) => { await write(root, "pom.xml", '<project><build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>'); } },
      { expected: /Go/, prepare: async (root) => { await write(root, "go.mod", "module example.test/app"); await write(root, "main.go", 'package main\nimport ("net/http";"os")\nfunc main(){http.ListenAndServe(":"+os.Getenv("PORT"),nil)}'); } },
      { expected: /Rust/, prepare: async (root) => { await write(root, "Cargo.toml", '[package]\nname="app"\nversion="0.1.0"\n[dependencies]\naxum="0.8"'); await write(root, "src/main.rs", 'fn main(){let _p=std::env::var("PORT"); let _="TcpListener"; let _="bind(";}'); } },
      { expected: /Laravel/, prepare: async (root) => { await write(root, "composer.json", JSON.stringify({ require: { "laravel/framework": "^12" } })); await write(root, "artisan", "<?php"); } },
    ];
    for (const item of cases) {
      const root = await bare(); await item.prepare(root);
      const discovery = await discoverRuntimeTopology(id(), root);
      expect(discovery.services.length, `${root} should expose a native runtime`).toBeGreaterThan(0);
      expect(discovery.services.map((service) => `${service.id} ${service.name}`).join(" ")).toMatch(item.expected);
      expect(discovery.services.every((service) => service.processId === undefined)).toBe(true);
    }
  });

  it("records bounded Electron browser traffic with query values redacted", async () => {
    const root = await fixture([{ id: "web", kind: "frontend", command: command("server.cjs"), health: { type: "HTTP" }, browserEntrypoint: "/" }]);
    await write(root, "server.cjs", "require('node:http').createServer((_q,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1'); setInterval(()=>{},1000);");
    const projectId = id(); const started = await startTopology(projectId, root); const web = started.services[0];
    expect(recordTopologyBrowserTraffic({ url: `http://127.0.0.1:${web.port.allocated}/api/orders?token=secret-value`, sourceUrl: `http://127.0.0.1:${web.port.allocated}/`, method: "GET", status: 200, resourceType: "xhr" })).toBe(true);
    const session = getTopologySession(projectId)!;
    expect(session.networkEvidence).toContainEqual(expect.objectContaining({ relationship: "OBSERVED_TRAFFIC", sourceServiceId: "web", destinationServiceId: "web" }));
    expect(session.networkEvidence.at(-1)?.detail).toContain("?[REDACTED_QUERY]");
    expect(session.networkEvidence.at(-1)?.detail).not.toContain("secret-value");
  }, 30_000);

  it("attributes a healthy Linux listener PID to the proven KForge process tree", async () => {
    if (process.platform !== "linux") return;
    const root = await fixture([{ id: "web", kind: "frontend", command: command("server.cjs"), health: { type: "HTTP" }, browserEntrypoint: "/" }]);
    await write(root, "server.cjs", "require('node:http').createServer((_q,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1'); setInterval(()=>{},1000);");
    const session = await startTopology(id(), root);
    expect(session.services[0].port.ownership).toBe("KFORGE_SESSION");
    expect(session.services[0].port.evidence).toMatch(/PID \d+/);
  }, 30_000);

});
