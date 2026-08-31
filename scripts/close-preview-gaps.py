from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def write(name: str, value: str) -> None:
    (ROOT / name).write_text(value, encoding="utf-8")


def replace_once(name: str, old: str, new: str) -> None:
    value = read(name)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{name}: expected one occurrence, found {count}: {old[:120]!r}")
    write(name, value.replace(old, new, 1))


def replace_range(name: str, start: str, end: str, replacement: str) -> None:
    value = read(name)
    left = value.find(start)
    if left < 0:
        raise RuntimeError(f"{name}: start marker not found: {start!r}")
    right = value.find(end, left)
    if right < 0:
        raise RuntimeError(f"{name}: end marker not found: {end!r}")
    write(name, value[:left] + replacement + value[right:])


# ---------------------------------------------------------------------------
# Canonical topology runtime integration
# ---------------------------------------------------------------------------
replace_once(
    "server/services/topologyRuntime.ts",
    '} from "../../shared/topology";\n',
    '} from "../../shared/topology";\nimport { detectAutomaticTopology } from "./topologyDetectors";\nimport { materializeRuntimeCommand, materializeRuntimeEnvironment, registerRuntimeControls, runServiceControl, runTopologyCleanup, runtimeControlPlan, verifyServiceListener } from "./topologyRuntimeIntegration";\n',
)

new_discovery = r'''export async function discoverRuntimeTopology(projectId: string, projectPath: string): Promise<RuntimeTopologyDiscovery> {
  const configPath = path.join(projectPath, ".kforge", "topology.json");
  const config = await readJson(configPath);
  let services: RuntimeService[] = [];
  let automatic: Awaited<ReturnType<typeof detectAutomaticTopology>> | undefined;
  if (config) {
    services = await discoverExplicit(projectId, projectPath, configPath, config);
    registerRuntimeControls(projectId, {});
  } else {
    automatic = await detectAutomaticTopology(projectId, projectPath);
    const packageServices = automatic.mode === "native" ? await discoverPackages(projectId, projectPath) : [];
    const packageRoots = new Set(packageServices.map((service) => path.resolve(service.rootPath)));
    const detectedServices = automatic.specs
      .filter((spec) => !packageRoots.has(path.resolve(spec.rootPath)))
      .map((spec) => makeService({
        projectId, projectPath, id: spec.id, name: spec.name, kind: spec.kind, rootPath: spec.rootPath,
        command: spec.command, source: spec.source, dependencies: spec.dependencies,
        requestedPort: spec.requestedPort, healthKind: spec.healthKind, healthEndpoint: spec.healthEndpoint,
        browserEntrypoint: spec.browserEntrypoint, browserLabel: spec.browserLabel, envRequired: spec.envRequired,
      }));
    services = [...packageServices, ...detectedServices];
    const activeIds = new Set(services.map((service) => service.id));
    registerRuntimeControls(projectId, Object.fromEntries(Object.entries(automatic.controls).filter(([id]) => activeIds.has(id))));
  }
  const sources = new Set(services.map((service) => service.source.source));
  automatic?.evidenceSources.forEach((source) => sources.add(source));
  if (existsSync(path.join(projectPath, "turbo.json"))) sources.add("turbo.json (workspace evidence only; service commands remain manifest-backed)");
  if (existsSync(path.join(projectPath, "nx.json"))) sources.add("nx.json (workspace evidence only; service commands remain manifest-backed)");
  if (existsSync(path.join(projectPath, "pnpm-workspace.yaml"))) sources.add("pnpm-workspace.yaml (workspace evidence)");
  const discovery: RuntimeTopologyDiscovery = {
    projectId, projectPath, discoveredAt: now(), state: services.length ? "DISCOVERED" : "UNAVAILABLE", services,
    evidenceSources: [...sources],
    limitations: [
      "Discovery executes no project code. KForge accepts explicit topology configuration, package scripts, canonical Docker Compose/Procfile definitions, and evidence-backed native runtime entrypoints.",
      ...(automatic?.limitations || ["Explicit .kforge/topology.json is authoritative when present; undeclared relationships remain UNKNOWN."]),
      "Static dependency edges are shown only when declared by explicit topology, Compose depends_on, or runnable workspace package dependencies; all other relationships remain UNKNOWN.",
      "Packaged Electron captures bounded browser request telemetry through session.webRequest without request bodies or credentials. Browser-hosted/server-only sessions cannot claim Chromium subresource telemetry and show only evidence actually received.",
      "Listener PID attribution is attempted with OS evidence after a healthy listener appears. Ownership remains UNKNOWN when PID or ancestry proof is unavailable, and an unrelated proven listener is never promoted to KFORGE_SESSION.",
    ],
  };
  discoveries.set(projectId, discovery);
  return cloneDiscovery(discovery);
}

'''
replace_range("server/services/topologyRuntime.ts", "export async function discoverRuntimeTopology", "function cloneService", new_discovery)

old_windows = r'''function resolveWindowsCommand(command: RuntimeService["command"]) {
  if (process.platform !== "win32" || command.executable.toLowerCase() !== "npm.cmd") return { command: command.executable, args: command.args, runAsNode: false };
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) return { command: command.executable, args: command.args, runAsNode: false };
  return { command: process.execPath, args: [npmCli, ...command.args], runAsNode: Boolean(process.versions.electron) };
}
'''
new_windows = r'''function resolveWindowsCommand(command: RuntimeService["command"]) {
  if (process.platform !== "win32") return { command: command.executable, args: command.args, runAsNode: false };
  if (command.executable.toLowerCase() === "npm.cmd") {
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(npmCli)) return { command: process.execPath, args: [npmCli, ...command.args], runAsNode: Boolean(process.versions.electron) };
  }
  if (/\.(?:cmd|bat)$/i.test(command.executable)) {
    const quote = (value: string) => `"${value.replace(/["^&|<>]/g, (character) => `^${character}`)}"`;
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", [command.executable, ...command.args].map(quote).join(" ")], runAsNode: false };
  }
  return { command: command.executable, args: command.args, runAsNode: false };
}
'''
replace_once("server/services/topologyRuntime.ts", old_windows, new_windows)

old_tcp = r'''    if (service.health.kind === "TCP") {
      const ok = await tcpProbe(service.port.allocated);
      service.health = { kind: "TCP", verdict: ok ? "HEALTHY" : "UNHEALTHY", checkedAt, latencyMs: Math.round(performance.now() - started), detail: ok ? `TCP listener accepted a loopback connection on ${service.port.allocated}.` : `No TCP listener responded on ${service.port.allocated}.` };
      if (ok) { service.state = "HEALTHY"; timeline(topology.session, "listener-detected", service.health.detail, service.id); }
      return;
    }
'''
new_tcp = r'''    if (service.health.kind === "TCP") {
      const ok = await tcpProbe(service.port.allocated);
      service.health = { kind: "TCP", verdict: ok ? "HEALTHY" : "UNHEALTHY", checkedAt, latencyMs: Math.round(performance.now() - started), detail: ok ? `TCP listener accepted a loopback connection on ${service.port.allocated}.` : `No TCP listener responded on ${service.port.allocated}.` };
      if (ok) {
        const first = service.state !== "HEALTHY";
        const ownership = await verifyServiceListener(topology.session.projectId, service);
        service.port = ownership.port;
        service.state = ownership.externalConflict ? "DEGRADED" : "HEALTHY";
        if (ownership.externalConflict) {
          problem(topology.session, { serviceId: service.id, kind: "PORT_CONFLICT", severity: "error", detail: `Healthy TCP response came from an OS-attributed listener outside the proven KForge process tree.`, evidence: service.port.evidence });
          propagateDependencyFailure(topology, service);
        } else if (first) timeline(topology.session, "listener-detected", `${service.health.detail} ${service.port.evidence}`, service.id);
      }
      return;
    }
'''
replace_once("server/services/topologyRuntime.ts", old_tcp, new_tcp)

old_http = r'''    if (response.ok) {
      const first = service.state !== "HEALTHY"; service.state = "HEALTHY"; service.port.ownership = "UNKNOWN"; service.port.collision = "NONE";
      service.port.evidence = `Port was free before spawn and responding ${service.health.kind} evidence appeared afterward. OS-level listener PID attribution is not captured, so port ownership remains UNKNOWN rather than inferred.`;
      if (first) { timeline(topology.session, "listener-detected", `${service.health.kind} listener responded at ${url}.`, service.id); timeline(topology.session, "healthy", service.health.detail, service.id); }
    } else if (service.state === "HEALTHY") {
'''
new_http = r'''    if (response.ok) {
      const first = service.state !== "HEALTHY";
      const ownership = await verifyServiceListener(topology.session.projectId, service);
      service.port = ownership.port;
      service.state = ownership.externalConflict ? "DEGRADED" : "HEALTHY";
      if (ownership.externalConflict) {
        problem(topology.session, { serviceId: service.id, kind: "PORT_CONFLICT", severity: "error", detail: `Healthy HTTP response came from an OS-attributed listener outside the proven KForge process tree.`, evidence: service.port.evidence });
        propagateDependencyFailure(topology, service);
      } else if (first) {
        timeline(topology.session, "listener-detected", `${service.health.kind} listener responded at ${url}. ${service.port.evidence}`, service.id);
        timeline(topology.session, "healthy", service.health.detail, service.id);
      }
    } else if (service.state === "HEALTHY") {
'''
replace_once("server/services/topologyRuntime.ts", old_http, new_http)

old_launch = r'''  const launch = resolveWindowsCommand(service.command);
  const child = spawn(launch.command, launch.args, {
    cwd: service.rootPath, shell: false, windowsHide: true, detached: process.platform !== "win32",
    env: { ...process.env, ...(launch.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...(service.port.allocated ? { PORT: String(service.port.allocated), HOST: "127.0.0.1", ASPNETCORE_URLS: `http://127.0.0.1:${service.port.allocated}` } : {}) },
  });
'''
new_launch = r'''  const runtimeCommand = materializeRuntimeCommand(topology.session.id, service);
  const launch = resolveWindowsCommand(runtimeCommand);
  const runtimeEnvironment = materializeRuntimeEnvironment(topology.session.projectId, topology.session.id, service);
  const child = spawn(launch.command, launch.args, {
    cwd: service.rootPath, shell: false, windowsHide: true, detached: process.platform !== "win32",
    env: { ...process.env, ...(launch.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...(service.port.allocated ? { PORT: String(service.port.allocated), HOST: "127.0.0.1", ASPNETCORE_URLS: `http://127.0.0.1:${service.port.allocated}` } : {}), ...runtimeEnvironment },
  });
'''
replace_once("server/services/topologyRuntime.ts", old_launch, new_launch)

# Existing service.command.display references in startOne should describe the materialized command actually executed.
value = read("server/services/topologyRuntime.ts")
value = value.replace("service.command.display", "runtimeCommand.display")
write("server/services/topologyRuntime.ts", value)

old_stop = r'''  await terminateOwned(active, false);
  if (!(await exited)) {
    const forcedExit = new Promise<boolean>((resolve) => {
      if (active.child.exitCode !== null) return resolve(true);
      const timer = setTimeout(() => resolve(false), 2_000);
      active.child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
    await terminateOwned(active, true);
    if (!(await forcedExit)) throw new Error(`Owned process ${active.child.pid} did not exit after safe escalation.`);
  }
'''
new_stop = r'''  const controlPlan = runtimeControlPlan(topology.session.projectId, service.id);
  const gracefulControl = await runServiceControl(topology.session.projectId, topology.session.id, service, false);
  gracefulControl.forEach((result) => log(topology, service, "system", `${result.ok ? "Control succeeded" : "Control failed"}: ${result.command}${result.output ? ` · ${result.output}` : ""}`));
  if (!controlPlan?.stop?.length || gracefulControl.some((result) => !result.ok)) await terminateOwned(active, false);
  if (!(await exited)) {
    const forcedExit = new Promise<boolean>((resolve) => {
      if (active.child.exitCode !== null) return resolve(true);
      const timer = setTimeout(() => resolve(false), 2_000);
      active.child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
    const forceControl = await runServiceControl(topology.session.projectId, topology.session.id, service, true);
    forceControl.forEach((result) => log(topology, service, "system", `${result.ok ? "Force control succeeded" : "Force control failed"}: ${result.command}${result.output ? ` · ${result.output}` : ""}`));
    await terminateOwned(active, true);
    if (!(await forcedExit)) throw new Error(`Owned process ${active.child.pid} did not exit after safe escalation.`);
  }
'''
replace_once("server/services/topologyRuntime.ts", old_stop, new_stop)

old_stop_topology = r'''export async function stopTopology(projectId: string) {
  const topology = sessions.get(projectId); if (!topology) return undefined;
  const order = dependencyOrder(topology.session.services).reverse();
  for (const serviceId of order) await stopOne(topology, serviceId);
  if (topology.scheduler) clearInterval(topology.scheduler);
  topology.session.endedAt = now(); topology.session.state = "STOPPED"; return cloneSession(topology.session);
}
'''
new_stop_topology = r'''export async function stopTopology(projectId: string) {
  const topology = sessions.get(projectId); if (!topology) return undefined;
  const order = dependencyOrder(topology.session.services).reverse();
  for (const serviceId of order) await stopOne(topology, serviceId);
  const cleanup = await runTopologyCleanup(projectId, topology.session.id, topology.session.services);
  const cleanupFailures = cleanup.filter((result) => !result.ok);
  cleanup.forEach((result) => timeline(topology.session, result.ok ? "stopped" : "failed", `${result.ok ? "Runtime cleanup succeeded" : "Runtime cleanup failed"}: ${result.command}${result.output ? ` · ${result.output}` : ""}`));
  if (cleanupFailures.length) throw new Error(`Topology runtime cleanup failed for ${cleanupFailures.length} command(s).`);
  if (topology.scheduler) clearInterval(topology.scheduler);
  topology.session.endedAt = now(); topology.session.state = "STOPPED"; return cloneSession(topology.session);
}
'''
replace_once("server/services/topologyRuntime.ts", old_stop_topology, new_stop_topology)

browser_traffic = r'''export function recordTopologyBrowserTraffic(observation: {
  url: string;
  sourceUrl?: string;
  method?: string;
  status?: number;
  resourceType?: string;
  fromCache?: boolean;
  error?: string;
}) {
  const parse = (value?: string) => {
    if (!value) return undefined;
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url : undefined; } catch { return undefined; }
  };
  const targetUrl = parse(observation.url); if (!targetUrl) return false;
  const sourceUrl = parse(observation.sourceUrl);
  const serviceAt = (session: TopologySession, url?: URL) => {
    if (!url || !["127.0.0.1", "localhost"].includes(url.hostname)) return undefined;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return session.services.find((service) => service.port.allocated === port);
  };
  for (const topology of sessions.values()) {
    if (topology.session.endedAt) continue;
    const source = serviceAt(topology.session, sourceUrl);
    const destination = serviceAt(topology.session, targetUrl);
    if (!source && !destination) continue;
    const safeUrl = `${targetUrl.origin}${targetUrl.pathname}${targetUrl.search ? "?[REDACTED_QUERY]" : ""}`;
    const status = observation.error ? `ERROR ${observation.error}` : observation.status === undefined ? "status unavailable" : `HTTP ${observation.status}`;
    const sourceLabel = source?.id || (destination ? "browser" : "UNKNOWN");
    const destinationLabel = destination?.id || targetUrl.origin;
    topology.session.networkEvidence = [...topology.session.networkEvidence, {
      at: now(),
      sourceServiceId: source?.id,
      destinationServiceId: destination?.id,
      relationship: "OBSERVED_TRAFFIC",
      detail: `${observation.method || "GET"} ${safeUrl} · ${status} · ${sourceLabel} -> ${destinationLabel}`,
      evidence: `Electron session.webRequest${observation.resourceType ? ` · ${observation.resourceType}` : ""}${observation.fromCache ? " · cache" : ""}; request bodies, cookies, authorization headers, and query values are not captured.`,
    }].slice(-MAX_NETWORK);
    return true;
  }
  return false;
}

'''
replace_once("server/services/topologyRuntime.ts", "export async function stopAllTopologies() {", browser_traffic + "export async function stopAllTopologies() {")

# ---------------------------------------------------------------------------
# Project discovery: Compose/Procfile-only projects must be first-class.
# ---------------------------------------------------------------------------
replace_once(
    "server/routes/workspace.ts",
    '    const markers = [".git", "package.json", "pyproject.toml", "requirements.txt", "setup.py", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json"];',
    '    const markers = [".git", "package.json", "pyproject.toml", "requirements.txt", "setup.py", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json", "Procfile", "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];',
)

# ---------------------------------------------------------------------------
# Production server -> Electron browser telemetry bridge.
# ---------------------------------------------------------------------------
replace_once(
    "server/productionServer.ts",
    'import { stopAllTopologies } from "./services/topologyRuntime";',
    'import { recordTopologyBrowserTraffic, stopAllTopologies } from "./services/topologyRuntime";\n\nexport { recordTopologyBrowserTraffic };',
)

# ---------------------------------------------------------------------------
# Electron: preserve project Preview headers and capture bounded webRequest facts.
# ---------------------------------------------------------------------------
replace_once("desktop/main.cjs", "let productionServer = null;\n", "let productionServer = null;\nlet productionServerModule = null;\n")
replace_once(
    "desktop/main.cjs",
    '  const serverModule = await import(pathToFileURL(modulePath).href);\n  productionServer = await serverModule.startKForgeProductionServer({ applicationRoot, host: "127.0.0.1", port: 0 });',
    '  productionServerModule = await import(pathToFileURL(modulePath).href);\n  productionServer = await productionServerModule.startKForgeProductionServer({ applicationRoot, host: "127.0.0.1", port: 0 });',
)
replace_once(
    "desktop/main.cjs",
    '  await current.close();\n  writeLog("INFO", "Loopback engine and managed Preview and topology processes stopped.");',
    '  await current.close();\n  productionServerModule = null;\n  writeLog("INFO", "Loopback engine and managed Preview and topology processes stopped.");',
)

traffic_function = r'''function recordDesktopTraffic(details, error) {
  if (!productionServerModule || typeof productionServerModule.recordTopologyBrowserTraffic !== "function") return;
  try {
    productionServerModule.recordTopologyBrowserTraffic({
      url: details.url,
      sourceUrl: details.referrer || "",
      method: details.method,
      status: typeof details.statusCode === "number" ? details.statusCode : undefined,
      resourceType: details.resourceType,
      fromCache: details.fromCache === true,
      error,
    });
  } catch (captureError) {
    writeLog("WARN", `Preview browser traffic capture failed: ${captureError instanceof Error ? captureError.message : String(captureError)}`);
  }
}

'''
replace_once("desktop/main.cjs", "function createWindow() {", traffic_function + "function createWindow() {")

new_webrequest = r'''session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const isLocalKForge = productionServer && details.url.startsWith(productionServer.url);
      if (!isLocalKForge) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": ["default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"],
        },
      });
    });
    const trafficFilter = { urls: ["http://*/*", "https://*/*"] };
    session.defaultSession.webRequest.onCompleted(trafficFilter, (details) => recordDesktopTraffic(details));
    session.defaultSession.webRequest.onErrorOccurred(trafficFilter, (details) => recordDesktopTraffic(details, details.error || "request failed"));
'''
replace_range("desktop/main.cjs", "session.defaultSession.webRequest.onHeadersReceived", "    writeLog(", new_webrequest + "    writeLog(")

# ---------------------------------------------------------------------------
# Topology Lab UI: expose source/PID evidence and observed traffic detail.
# ---------------------------------------------------------------------------
replace_once(
    "client/workbench/TopologyLab.tsx",
    'Manifest-backed services · owned processes · measured health',
    'Compose · Procfile · package/native runtimes · owned processes · measured health',
)
replace_once(
    "client/workbench/TopologyLab.tsx",
    'KForge did not invent services. Add manifest-backed runnable packages or an explicit <code>.kforge/topology.json</code>.',
    'KForge did not invent services. Add a runnable package/native entrypoint, canonical Compose/Procfile definition, or an explicit <code>.kforge/topology.json</code>.',
)
replace_once(
    "client/workbench/TopologyLab.tsx",
    '<div><dt className="text-muted-foreground">Port ownership</dt><dd>{selected.port.host}:{selected.port.allocated || selected.port.requested || "—"} · {selected.port.ownership} · {selected.port.collision}</dd></div>',
    '<div><dt className="text-muted-foreground">Port ownership</dt><dd>{selected.port.host}:{selected.port.allocated || selected.port.requested || "—"} · {selected.port.ownership} · {selected.port.collision}<small className="mt-1 block break-words text-muted-foreground">{selected.port.evidence}</small></dd></div>',
)
old_network = r'''          {tab === "network" ? <div>{session?.networkEvidence.length ? session.networkEvidence.map((item, index) => <p key={`${item.at}:${index}`} className="mb-1 rounded border p-2"><strong>{item.sourceServiceId || "UNKNOWN"} → {item.destinationServiceId || "UNKNOWN"}</strong> · {item.relationship} · {item.evidence}</p>) : <p>No configured dependency or observed traffic evidence exists. Browser traffic is NOT_CAPTURED.</p>}</div> : null}
'''
new_network = r'''          {tab === "network" ? <div>{session?.networkEvidence.length ? session.networkEvidence.map((item, index) => <p key={`${item.at}:${index}`} className="mb-1 rounded border p-2"><strong>{item.sourceServiceId || "BROWSER/EXTERNAL"} → {item.destinationServiceId || "EXTERNAL"}</strong> · {item.relationship}<span className="mt-1 block break-words">{item.detail}</span><small className="mt-1 block text-muted-foreground">{item.evidence}</small></p>) : <p>No configured dependency or observed browser traffic evidence exists yet. Packaged desktop capture records bounded Chromium request facts when a topology Preview is loaded; server-only sessions make no browser-telemetry claim.</p>}</div> : null}
'''
replace_once("client/workbench/TopologyLab.tsx", old_network, new_network)

# ---------------------------------------------------------------------------
# Security gate: moderate-or-higher dependency advisories become blocking.
# ---------------------------------------------------------------------------
replace_once(
    "scripts/verify-gate.mjs",
    'if (installOk) {\n  await runStep("typecheck", "npm", ["run", "typecheck"]);',
    'if (installOk) {\n  await runStep("npm-audit", "npm", ["audit", "--audit-level=moderate"]);\n  await runStep("typecheck", "npm", ["run", "typecheck"]);',
)
replace_once(
    "scripts/verify-gate.mjs",
    '} else {\n  for (const [id, command] of [',
    '} else {\n  skipStep("npm-audit", "npm audit --audit-level=moderate", "npm ci failed; dependency audit cannot run truthfully.");\n  for (const [id, command] of [',
)
replace_once(
    "scripts/verify-gate.mjs",
    'const required = ["workflow-pins", "npm-ci", "typecheck", "lint", "tests", "build", "e2e"];',
    'const required = ["workflow-pins", "npm-ci", "npm-audit", "typecheck", "lint", "tests", "build", "e2e"];',
)

# ---------------------------------------------------------------------------
# Unit evidence for the new discovery/telemetry/attribution contracts.
# ---------------------------------------------------------------------------
replace_once(
    "server/services/topologyRuntime.spec.ts",
    'import { discoverRuntimeTopology, getTopologySession, restartTopologyService, startTopology, startTopologyService, stopTopology, stopTopologyService } from "./topologyRuntime";',
    'import { discoverRuntimeTopology, getTopologySession, recordTopologyBrowserTraffic, restartTopologyService, startTopology, startTopologyService, stopTopology, stopTopologyService } from "./topologyRuntime";',
)
replace_once(
    "server/services/topologyRuntime.spec.ts",
    'async function write(root: string, name: string, content: string) { await fs.writeFile(path.join(root, name), content, "utf8"); }',
    'async function write(root: string, name: string, content: string) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), content, "utf8"); }\nasync function bare() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-topology-auto-")); roots.push(root); return root; }',
)

extra_tests = r'''

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
'''
value = read("server/services/topologyRuntime.spec.ts")
closing = "\n});\n"
position = value.rfind(closing)
if position < 0:
    raise RuntimeError("topologyRuntime.spec.ts closing describe marker not found")
write("server/services/topologyRuntime.spec.ts", value[:position] + extra_tests + value[position:])

# Procfile Windows safety: do not allow cmd expansion characters through the no-shell parser.
replace_once(
    "server/services/topologyDetectors.ts",
    '  if (!trimmed || /(?:&&|\\|\\||[;|`<>\\r\\n])/.test(trimmed)) return undefined;',
    '  if (!trimmed || /(?:&&|\\|\\||[;|`<>\\r\\n])/.test(trimmed) || (process.platform === "win32" && /[%!^&]/.test(trimmed))) return undefined;',
)

print("KForge Preview gap integration patch applied.")
