import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, ExternalLink, Home, Network, Play, RefreshCcw, RotateCw, ServerCog, Square, TerminalSquare, TriangleAlert } from "lucide-react";
import type { ProjectSummary } from "@shared/workspace";
import type { RuntimeService, RuntimeTopologyDiscovery, TopologySession } from "@shared/topology";
import type { SurfaceProps } from "./surfaceContracts";
import type { RecordRow } from "./surfaceContracts";
import { fetchJson } from "./api";
import { StatusBadge } from "./ui";

type Response = { projectId: string; trust: string; discovery?: RuntimeTopologyDiscovery; session?: TopologySession };
type EvidenceTab = "console" | "problems" | "health" | "timeline" | "network";

function serviceUrl(service?: RuntimeService, route?: string) {
  if (!service?.port.allocated || !service.browserEntrypoint) return "";
  return new URL(route || service.browserEntrypoint, `http://127.0.0.1:${service.port.allocated}`).toString();
}

function readEntryRoutes(projectId: string): Record<string, { history: string[]; index: number }> {
  try { const value = JSON.parse(localStorage.getItem(`kforge:topology-routes:v1:${projectId}`) || "{}"); return value && typeof value === "object" ? value : {}; }
  catch { return {}; }
}

export default function TopologyLab({ project, onExecution, onInspectorContext }: {
  project: ProjectSummary;
  onExecution: SurfaceProps["onExecution"];
  onInspectorContext?: SurfaceProps["onInspectorContext"];
}) {
  const endpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/topology`;
  const [discovery, setDiscovery] = useState<RuntimeTopologyDiscovery | null>(null);
  const [session, setSession] = useState<TopologySession | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<EvidenceTab>("console");
  const [entryRoutes, setEntryRoutes] = useState<Record<string, { history: string[]; index: number }>>(() => readEntryRoutes(project.id));
  const [routeInput, setRouteInput] = useState("/");

  const load = useCallback(async () => {
    const result = await fetchJson<Response>(endpoint);
    setDiscovery(result.discovery || null); setSession(result.session || null);
    const services = result.session?.services || result.discovery?.services || [];
    setSelectedId((current) => services.some((service) => service.id === current) ? current : services.find((service) => service.browserEntrypoint)?.id || services[0]?.id || "");
    return result;
  }, [endpoint]);

  useEffect(() => { setNotice(""); void load().catch((error) => setNotice(error instanceof Error ? error.message : "Topology evidence unavailable.")); }, [load]);
  useEffect(() => { setEntryRoutes(readEntryRoutes(project.id)); }, [project.id]);
  useEffect(() => { try { localStorage.setItem(`kforge:topology-routes:v1:${project.id}`, JSON.stringify(entryRoutes)); } catch { /* Optional browser storage. */ } }, [entryRoutes, project.id]);
  useEffect(() => {
    if (!session || !["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(session.state)) return;
    const timer = window.setInterval(() => void fetchJson<{ session?: TopologySession }>(`${endpoint}/health`, { method: "POST" }).then((result) => result.session && setSession(result.session)).catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [endpoint, session?.state]);

  const services = session?.services || discovery?.services || [];
  const selected = services.find((service) => service.id === selectedId) || services[0];
  const entrypoints = services.filter((service) => Boolean(service.browserEntrypoint));
  const routeState = selected ? entryRoutes[selected.id] || { history: [selected.browserEntrypoint || "/"], index: 0 } : { history: ["/"], index: 0 };
  const selectedRoute = routeState.history[routeState.index] || selected?.browserEntrypoint || "/";
  const previewUrl = serviceUrl(selected, selectedRoute);
  const previewLive = Boolean(previewUrl && selected && ["HEALTHY", "RUNNING"].includes(selected.state));

  useEffect(() => {
    if (!selected || !onInspectorContext) return;
    onInspectorContext({ kind: "topology-service", title: selected.name, projectName: project.name, service: selected as unknown as RecordRow, topologySession: session as unknown as RecordRow || undefined });
  }, [onInspectorContext, project.name, selected, session]);

  useEffect(() => {
    if (!selected?.browserEntrypoint) return;
    try { localStorage.setItem(`kforge:topology-entrypoint:${project.id}`, selected.id); window.dispatchEvent(new CustomEvent("kforge-topology-entrypoint", { detail: { projectId: project.id, serviceId: selected.id } })); }
    catch { /* Browser storage is optional. */ }
  }, [project.id, selected?.browserEntrypoint, selected?.id]);

  useEffect(() => { setRouteInput(selectedRoute); }, [selected?.id, selectedRoute]);

  const navigateEntrypoint = (value: string) => {
    if (!selected?.browserEntrypoint || !selected.port.allocated) return;
    try {
      const base = serviceUrl(selected); const candidate = new URL(value.trim() || "/", base);
      if (candidate.origin !== new URL(base).origin) throw new Error("Topology Preview navigation is limited to the selected loopback service origin.");
      const next = `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
      setEntryRoutes((current) => {
        const state = current[selected.id] || { history: [selected.browserEntrypoint || "/"], index: 0 };
        const history = [...state.history.slice(0, state.index + 1), next].slice(-40);
        return { ...current, [selected.id]: { history, index: history.length - 1 } };
      });
      setRouteInput(next); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid topology Preview route."); }
  };

  const moveEntrypointHistory = (direction: -1 | 1) => {
    if (!selected) return;
    const next = routeState.index + direction;
    if (next < 0 || next >= routeState.history.length) return;
    setEntryRoutes((current) => ({ ...current, [selected.id]: { ...routeState, index: next } }));
  };

  const operate = async (operation: "start" | "stop" | "restart", serviceId?: string) => {
    const target = serviceId ? `${endpoint}/services/${encodeURIComponent(serviceId)}/${operation}` : `${endpoint}/${operation}`;
    setBusy(`${serviceId || "topology"}:${operation}`); setNotice("");
    onExecution({ label: `${serviceId || "Topology"} ${operation}`, state: "RUNNING", source: "Canonical Runtime Topology" });
    try {
      const result = await fetchJson<{ session?: TopologySession }>(target, { method: "POST" });
      if (result.session) { setSession(result.session); window.dispatchEvent(new CustomEvent("kforge-topology-session", { detail: { projectId: project.id, session: result.session } })); }
      onExecution({ label: `${serviceId || "Topology"} ${operation}`, state: result.session?.state || "UNKNOWN", source: "Canonical Runtime Topology", output: result.session?.logs.map((line) => `[${line.serviceId}] ${line.message}`).join("\n") });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Topology ${operation} failed.`;
      setNotice(message); onExecution({ label: `${serviceId || "Topology"} ${operation}`, state: "FAILED", source: "Canonical Runtime Topology", message }); await load().catch(() => undefined);
    } finally { setBusy(""); }
  };

  const dependencies = useMemo(() => {
    const serviceById = new Map(services.map((service) => [service.id, service]));
    return services.flatMap((service) => service.dependencies.map((dependency) => ({ service, dependency, target: serviceById.get(dependency.serviceId) })));
  }, [services]);
  const actionReason = project.trust !== "trusted" ? "Execution blocked: trust this project first." : undefined;

  return <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-label="Runtime Topology Lab" data-topology-state={session?.state || discovery?.state || "UNKNOWN"}>
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <ServerCog size={16} className="text-violet-400" /><div className="mr-auto"><h2 className="text-sm font-semibold">Full-stack Topology Lab</h2><p className="text-[11px] text-muted-foreground">Compose · Procfile · package/native runtimes · owned processes · measured health</p></div>
      <StatusBadge value={session?.state || discovery?.state || "DISCOVERING"} />
      <button title={actionReason || (busy ? "Another topology operation is in progress." : !services.length ? "No runnable services were discovered." : undefined)} disabled={project.trust !== "trusted" || !services.length || Boolean(busy)} onClick={() => void operate("start")}><Play size={13} /> Start topology</button>
      <button title={actionReason || (busy ? "Another topology operation is in progress." : !session ? "No topology session exists." : undefined)} disabled={project.trust !== "trusted" || !session || Boolean(busy)} onClick={() => void operate("restart")}><RotateCw size={13} /> Restart topology</button>
      <button title={actionReason || (busy ? "Another topology operation is in progress." : !session ? "No topology session exists." : undefined)} disabled={project.trust !== "trusted" || !session || Boolean(busy)} onClick={() => void operate("stop")}><Square size={13} /> Stop all</button>
    </header>

    {!services.length ? <div className="p-5"><StatusBadge value="UNAVAILABLE" /><h3 className="mt-3 text-sm font-semibold">No runnable topology was proven</h3><p className="mt-1 text-xs text-muted-foreground">KForge did not invent services. Add a runnable package/native entrypoint, canonical Compose/Procfile definition, or an explicit <code>.kforge/topology.json</code>.</p>{discovery?.limitations.map((item) => <p key={item} className="mt-1 text-[11px] text-muted-foreground">{item}</p>)}</div> : <>
      <div className="grid min-h-[440px] xl:grid-cols-[245px_minmax(0,1fr)_330px]">
        <section className="border-r" aria-label="Topology services">
          <div className="border-b px-3 py-2 text-xs font-semibold">Services <span className="ml-1 text-muted-foreground">{services.length}</span></div>
          <div className="max-h-[560px] overflow-auto p-1.5">
            {services.map((service) => <article key={service.id} className={`mb-1 rounded-md border p-2 ${selected?.id === service.id ? "border-violet-500/60 bg-violet-500/10" : "bg-background/40"}`}>
              <button className="flex w-full items-start gap-2 border-0 bg-transparent p-0 text-left" aria-pressed={selected?.id === service.id} onClick={() => setSelectedId(service.id)}>
                <span className={`mt-1 h-2 w-2 rounded-full ${["HEALTHY", "RUNNING"].includes(service.state) ? "bg-emerald-400" : service.state === "FAILED" || service.state === "BLOCKED" ? "bg-red-400" : "bg-slate-500"}`} />
                <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{service.name}</strong><small className="block truncate text-[10px] text-muted-foreground">{service.kind} · {service.port.allocated || service.port.requested || "no port"} · PID {service.processId || "—"}</small></span><StatusBadge value={service.state} />
              </button>
              <div className="mt-2 flex gap-1">
                <button title={actionReason || (busy ? "Another topology operation is in progress." : ["STARTING", "RUNNING", "HEALTHY"].includes(service.state) ? `${service.name} is already active.` : undefined)} disabled={project.trust !== "trusted" || ["STARTING", "RUNNING", "HEALTHY"].includes(service.state) || Boolean(busy)} onClick={() => void operate("start", service.id)}><Play size={11} /><span className="sr-only">Start {service.name}</span></button>
                <button title={actionReason || (busy ? "Another topology operation is in progress." : !["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(service.state) ? `${service.name} has no active owned process.` : undefined)} disabled={project.trust !== "trusted" || !["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(service.state) || Boolean(busy)} onClick={() => void operate("stop", service.id)}><Square size={11} /><span className="sr-only">Stop {service.name}</span></button>
                <button title={actionReason || (busy ? "Another topology operation is in progress." : undefined)} disabled={project.trust !== "trusted" || Boolean(busy)} onClick={() => void operate("restart", service.id)}><RefreshCcw size={11} /><span className="sr-only">Restart {service.name}</span></button>
                <button title={!serviceUrl(service) ? `${service.name} has no active browser entrypoint.` : undefined} disabled={!serviceUrl(service)} onClick={() => serviceUrl(service) && window.open(serviceUrl(service), "_blank", "noopener,noreferrer")}><ExternalLink size={11} /><span className="sr-only">Open {service.name}</span></button>
              </div>
            </article>)}
          </div>
        </section>

        <section className="min-w-0 bg-muted/10" aria-label="Live app and topology canvas">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Network size={14} /><strong className="text-xs">Topology canvas</strong>
            {entrypoints.length ? <><label className="ml-auto text-[11px] text-muted-foreground" htmlFor="topology-entrypoint">Preview</label><select id="topology-entrypoint" aria-label="Topology browser entrypoint" value={selected?.browserEntrypoint ? selected.id : entrypoints[0]?.id} onChange={(event) => setSelectedId(event.target.value)}>{entrypoints.map((service) => <option key={service.id} value={service.id}>{service.browserLabel || service.name}</option>)}</select></> : <span className="ml-auto text-[11px] text-muted-foreground">No browser entrypoint</span>}
          </div>
          <div className="grid min-h-[190px] grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Keyboard accessible topology nodes">
            {services.map((service) => <div role="listitem" key={service.id}><button className={`h-full min-h-20 w-full rounded-lg border bg-card p-3 text-left ${selected?.id === service.id ? "ring-1 ring-violet-400" : ""}`} onClick={() => setSelectedId(service.id)}><span className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{service.name}</strong><StatusBadge value={service.state} /></span><span className="mt-2 block text-[10px] text-muted-foreground">{service.kind} · {service.source.source}</span><span className="mt-1 block text-[10px]">{service.dependencies.length ? `Depends on ${service.dependencies.map((item) => item.serviceId).join(", ")}` : "Dependencies UNKNOWN / none proven"}</span></button></div>)}
          </div>
          <section className="border-b px-3 py-2" aria-label="Proven topology relationships"><strong className="text-[11px]">Evidence edges</strong>{dependencies.length ? <ul className="mt-1 grid gap-1">{dependencies.map(({ service, dependency, target }) => <li key={`${service.id}:${dependency.serviceId}`} className="text-[10px]"><button className="border-0 bg-transparent p-0 text-left" onClick={() => setSelectedId(service.id)}><strong>{service.name}</strong> → <strong>{target?.name || dependency.serviceId}</strong> · {dependency.relationship} · {dependency.evidence.source}</button></li>)}</ul> : <p className="mt-1 text-[10px] text-muted-foreground">No dependency edge is proven. KForge does not draw decorative arrows.</p>}</section>
          <div className="min-h-[235px] p-3">
            {selected?.browserEntrypoint ? <div className="mb-2 flex items-center gap-1" role="toolbar" aria-label="Topology Preview browser controls"><button aria-label="Topology Preview back" disabled={routeState.index === 0} onClick={() => moveEntrypointHistory(-1)}><ArrowLeft size={12} /></button><button aria-label="Topology Preview forward" disabled={routeState.index >= routeState.history.length - 1} onClick={() => moveEntrypointHistory(1)}><ArrowRight size={12} /></button><button aria-label="Topology Preview home" onClick={() => navigateEntrypoint(selected.browserEntrypoint || "/")}><Home size={12} /></button><form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); navigateEntrypoint(routeInput); }}><input className="w-full" aria-label="Topology Preview address" value={routeInput} onChange={(event) => setRouteInput(event.target.value)} /></form><button aria-label="Open topology Preview externally" disabled={!previewUrl} onClick={() => previewUrl && window.open(previewUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={12} /></button></div> : null}
            {previewLive ? <iframe title={`${selected?.name} topology Preview`} className="h-[185px] w-full rounded-lg border bg-white" src={previewUrl} sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin" referrerPolicy="no-referrer" /> : <div className="flex h-[185px] flex-col items-center justify-center rounded-lg border bg-card/60 p-5 text-center"><Activity size={24} /><strong className="mt-2 text-sm">{selected?.browserEntrypoint ? `${selected.name} is ${selected.state}` : "Select a browser-capable service"}</strong><span className="mt-1 text-xs text-muted-foreground">A process is not shown as a live app until its service health evidence is RUNNING or HEALTHY.</span></div>}
          </div>
        </section>

        <section className="border-l p-3" aria-label="Topology service detail panel">
          <div className="flex items-center gap-2"><strong className="mr-auto text-xs">Service inspector</strong><StatusBadge value={selected?.state || "UNKNOWN"} /></div>
          {selected ? <dl className="mt-3 grid gap-2 text-[11px]">
            <div><dt className="text-muted-foreground">Identity / kind</dt><dd>{selected.name} · {selected.kind}</dd></div>
            <div><dt className="text-muted-foreground">Command</dt><dd><code className="break-all">{selected.command.display}</code></dd></div>
            <div><dt className="text-muted-foreground">Detection source</dt><dd className="break-all">{selected.source.source} · {selected.source.confidence}</dd></div>
            <div><dt className="text-muted-foreground">Working directory</dt><dd className="break-all">{selected.relativeRoot}</dd></div>
            <div><dt className="text-muted-foreground">Process / uptime</dt><dd>PID {selected.processId || "NOT_RUNNING"} · {selected.startedAt ? Math.max(0, Math.round((Date.now() - new Date(selected.startedAt).getTime()) / 1000)) + "s" : "NOT_STARTED"}</dd></div>
            <div><dt className="text-muted-foreground">Port ownership</dt><dd>{selected.port.host}:{selected.port.allocated || selected.port.requested || "—"} · {selected.port.ownership} · {selected.port.collision}<small className="mt-1 block break-words text-muted-foreground">{selected.port.evidence}</small></dd></div>
            <div><dt className="text-muted-foreground">Health</dt><dd>{selected.health.kind} · {selected.health.verdict} · {selected.health.detail}</dd></div>
            <div><dt className="text-muted-foreground">Dependencies</dt><dd>{selected.dependencies.length ? selected.dependencies.map((item) => `${item.serviceId} (${item.relationship})`).join(", ") : "UNKNOWN / none proven"}</dd></div>
            <div><dt className="text-muted-foreground">Environment disclosure</dt><dd>{selected.environment.length ? selected.environment.map((item) => <span key={item.name} className="mt-1 block"><code>{item.name}</code> · {item.state}{item.safeValue !== undefined ? ` · ${item.safeValue}` : ""}</span>) : "No required variables declared."}</dd></div>
            <div><dt className="text-muted-foreground">Network behavior</dt><dd>{selected.networkPolicy}</dd></div>
            <div><dt className="text-muted-foreground">Restart policy</dt><dd>{selected.restartPolicy} (default)</dd></div>
          </dl> : null}
        </section>
      </div>

      <section className="border-t" aria-label="Topology evidence dock">
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
          <button aria-pressed={tab === "console"} onClick={() => setTab("console")}><TerminalSquare size={12} /> Topology console</button>
          <button aria-pressed={tab === "problems"} onClick={() => setTab("problems")}>Topology issues {session?.problems.length || 0}</button>
          <button aria-pressed={tab === "health"} onClick={() => setTab("health")}>Topology health</button>
          <button aria-pressed={tab === "timeline"} onClick={() => setTab("timeline")}>Topology timeline</button>
          <button aria-pressed={tab === "network"} onClick={() => setTab("network")}>Topology links</button>
        </div>
        <div className="max-h-44 overflow-auto p-3 text-[11px]" tabIndex={0}>
          {tab === "console" ? <pre className="whitespace-pre-wrap break-words">{session?.logs.length ? session.logs.map((line) => `[${line.serviceId.toUpperCase()}] ${line.message}`).join("\n") : "No process output captured."}</pre> : null}
          {tab === "problems" ? <div className="grid gap-1">{session?.problems.length ? session.problems.map((item) => <button key={item.id} className="rounded border p-2 text-left" onClick={() => item.serviceId && setSelectedId(item.serviceId)}><StatusBadge value={item.kind} /> <span className="ml-2">{item.detail}</span><small className="mt-1 block text-muted-foreground">{item.evidence}</small></button>) : "No runtime topology problems have been recorded."}</div> : null}
          {tab === "health" ? <div className="grid gap-1">{services.map((service) => <button key={service.id} className="grid rounded border p-2 text-left sm:grid-cols-[160px_100px_minmax(0,1fr)]" onClick={() => setSelectedId(service.id)}><strong>{service.name}</strong><span>{service.health.verdict}</span><span>{service.health.detail}</span></button>)}</div> : null}
          {tab === "timeline" ? <ol className="grid gap-1">{session?.timeline.length ? session.timeline.map((item, index) => <li key={`${item.at}:${item.phase}:${index}`} className="grid rounded border p-2 sm:grid-cols-[100px_150px_minmax(0,1fr)]"><span>{new Date(item.at).toLocaleTimeString()}</span><strong>{item.serviceId || item.phase}</strong><span>{item.detail}</span></li>) : <li>No topology session timeline exists.</li>}</ol> : null}
          {tab === "network" ? <div>{session?.networkEvidence.length ? session.networkEvidence.map((item, index) => <p key={`${item.at}:${index}`} className="mb-1 rounded border p-2"><strong>{item.sourceServiceId || "BROWSER/EXTERNAL"} → {item.destinationServiceId || "EXTERNAL"}</strong> · {item.relationship}<span className="mt-1 block break-words">{item.detail}</span><small className="mt-1 block text-muted-foreground">{item.evidence}</small></p>) : <p>No configured dependency or observed browser traffic evidence exists yet. Packaged desktop capture records bounded Chromium request facts when a topology Preview is loaded; server-only sessions make no browser-telemetry claim.</p>}</div> : null}
        </div>
      </section>
    </>}
    {notice ? <p className="border-t px-3 py-2 text-xs" role="status">{notice}</p> : null}
  </section>;
}
