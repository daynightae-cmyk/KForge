import { useEffect, useMemo, useState } from "react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { viewLabel } from "./navigation";
import { StatusBadge } from "./ui";
import { SimpleFetchSurface } from "./surfaceShared";
import { ProjectRequired } from "./ProjectStartActions";
import {
  Boxes, Braces, ChevronRight, GitBranch, Layers, Link2, Network, Route, Search, Sparkles, Zap,
} from "lucide-react";

type GraphNode = { id?: string; type?: string; label?: string; path?: string };
type GraphEdge = { from?: string; to?: string; type?: string };
type GraphResponse = {
  projectId?: string;
  graph?: {
    nodes?: GraphNode[];
    edges?: GraphEdge[];
    generatedAt?: string;
    coverage?: { state?: string; scannedCount?: number; totalOrUnknown?: number | null; limit?: number; reason?: string; source?: string };
    cache?: { state?: string; fingerprint?: string; generatedAt?: string };
  };
};

type Positioned = { key: string; label: string; meta: string; path?: string; x: number; y: number; kind: "module" | "dependency" | "entry" };

const GRAPH_W = 1000;
const GRAPH_H = 520;

function moduleFor(path?: string) {
  if (!path) return "root";
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "root";
  if (["client", "server", "shared", "desktop", "tests", "scripts", "installer"].includes(parts[0])) {
    return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

function humanType(type?: string) {
  return (type || "node").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ProjectGraphWorkbench({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ modules: true, dependencies: true, entries: true });
  const [selected, setSelected] = useState<string>("");
  const [impactTarget, setImpactTarget] = useState("");
  const [impact, setImpact] = useState<RecordRow | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactError, setImpactError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setMessage("");
    void fetchJson<GraphResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph`, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setData(next); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Project graph evidence unavailable."); });
    return () => controller.abort();
  }, [project.id]);

  const nodes = useMemo(() => data?.graph?.nodes || [], [data]);
  const edges = useMemo(() => data?.graph?.edges || [], [data]);
  const coverage = data?.graph?.coverage;
  const cache = data?.graph?.cache;

  const counts = useMemo(() => ({
    files: nodes.filter((node) => node.type === "file").length,
    tests: nodes.filter((node) => node.type === "test").length,
    symbols: nodes.filter((node) => node.type === "symbol").length,
    dependencies: nodes.filter((node) => node.type === "dependency").length,
    entries: nodes.filter((node) => node.type === "api" || node.type === "route").length,
    configs: nodes.filter((node) => node.type === "config").length,
  }), [nodes]);

  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of edges) {
      if (edge.from) map.set(edge.from, (map.get(edge.from) || 0) + 1);
      if (edge.to) map.set(edge.to, (map.get(edge.to) || 0) + 1);
    }
    return map;
  }, [edges]);

  const modules = useMemo(() => {
    const byGroup = new Map<string, { files: number; tests: number; total: number }>();
    for (const node of nodes) {
      if (!["file", "test", "config", "symbol", "api", "route"].includes(node.type || "")) continue;
      const group = moduleFor(node.path);
      const entry = byGroup.get(group) || { files: 0, tests: 0, total: 0 };
      if (node.type === "file") entry.files += 1;
      if (node.type === "test") entry.tests += 1;
      entry.total += 1;
      byGroup.set(group, entry);
    }
    return [...byGroup.entries()]
      .filter(([group]) => group !== "root")
      .sort((left, right) => right[1].total - left[1].total)
      .slice(0, 7)
      .map(([group, entry]) => ({ group, ...entry }));
  }, [nodes]);

  const dependencyNodes = useMemo(() => nodes
    .filter((node) => node.type === "dependency")
    .map((node) => ({ node, degree: degree.get(node.id || "") || 0 }))
    .sort((left, right) => right.degree - left.degree)
    .slice(0, 5), [degree, nodes]);

  const entryNodes = useMemo(() => nodes
    .filter((node) => node.type === "api" || node.type === "route")
    .map((node) => ({ node, degree: degree.get(node.id || "") || 0 }))
    .sort((left, right) => right.degree - left.degree)
    .slice(0, 3), [degree, nodes]);

  const positioned = useMemo(() => {
    const list: Positioned[] = [];
    modules.forEach((module, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(modules.length, 1);
      list.push({
        key: `module:${module.group}`,
        label: module.group,
        meta: `${module.total} nodes`,
        x: GRAPH_W / 2 + 300 * Math.cos(angle),
        y: GRAPH_H / 2 + 170 * Math.sin(angle),
        kind: "module",
      });
    });
    dependencyNodes.forEach((entry, index) => {
      list.push({
        key: entry.node.id || `dependency:${index}`,
        label: entry.node.label || entry.node.path || "dependency",
        meta: `${entry.degree} edge${entry.degree === 1 ? "" : "s"}`,
        path: entry.node.path,
        x: 110,
        y: 110 + index * 70,
        kind: "dependency",
      });
    });
    entryNodes.forEach((entry, index) => {
      list.push({
        key: entry.node.id || `entry:${index}`,
        label: entry.node.label || entry.node.path || "entry point",
        meta: `${entry.degree} edge${entry.degree === 1 ? "" : "s"}`,
        path: entry.node.path,
        x: GRAPH_W - 110,
        y: 150 + index * 90,
        kind: "entry",
      });
    });
    return list;
  }, [dependencyNodes, entryNodes, modules]);

  const visibleNodes = useMemo(() => positioned.filter((node) => {
    if (node.kind === "module" && !filters.modules) return false;
    if (node.kind === "dependency" && !filters.dependencies) return false;
    if (node.kind === "entry" && !filters.entries) return false;
    return true;
  }), [filters, positioned]);

  const groupEdges = useMemo(() => {
    const fileGroup = new Map<string, string>();
    for (const node of nodes) if (node.type === "file" || node.type === "test" || node.type === "api" || node.type === "route") fileGroup.set(node.id || "", moduleFor(node.path));
    const cross = new Map<string, number>();
    for (const edge of edges) {
      if (!edge.from || !edge.to) continue;
      const from = fileGroup.get(edge.from);
      const to = fileGroup.get(edge.to);
      if (!from || !to || from === to || from === "root" || to === "root") continue;
      if (!modules.some((module) => module.group === from) || !modules.some((module) => module.group === to)) continue;
      const key = `${from}→${to}`;
      cross.set(key, (cross.get(key) || 0) + 1);
    }
    return [...cross.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10);
  }, [edges, modules, nodes]);

  const matchIds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return new Set<string>();
    return new Set(positioned.filter((node) => `${node.label} ${node.meta} ${node.path || ""}`.toLowerCase().includes(normalized)).map((node) => node.key));
  }, [positioned, query]);

  const selectedNode = positioned.find((node) => node.key === selected) || null;
  const selectedConnections = selectedNode ? (selectedNode.kind === "module"
    ? edges.filter((edge) => (nodes.find((node) => node.id === edge.from) && moduleFor(nodes.find((node) => node.id === edge.from)?.path) === selectedNode.label) || (nodes.find((node) => node.id === edge.to) && moduleFor(nodes.find((node) => node.id === edge.to)?.path) === selectedNode.label)).length
    : degree.get(selectedNode.key) || 0) : 0;

  const runImpact = async () => {
    if (!impactTarget.trim() || impactBusy) return;
    setImpactBusy(true);
    setImpactError("");
    try {
      const result = await fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph/impact?target=${encodeURIComponent(impactTarget.trim())}`);
      setImpact(result);
    } catch (error) {
      setImpactError(error instanceof Error ? error.message : "Impact analysis failed.");
    } finally {
      setImpactBusy(false);
    }
  };

  const impactBody = (impact?.impact || {}) as RecordRow;
  const asList = (value: unknown) => Array.isArray(value) ? value : [];
  const selectedHasMatch = (key: string) => matchIds.size === 0 || matchIds.has(key);

  const highestModule = modules[0];
  const mostConnected = [...positioned].sort((left, right) => (degree.get(right.key) || 0) - (degree.get(left.key) || 0))[0];

  return <section className="kw-simple-surface kw-graph-workbench" aria-label="Project graph evidence">
    {message && <p className="kw-message" role="status">{message}</p>}
    {!data && !message ? <div className="kw-graph-loading" role="status">Reading bounded local graph evidence…</div> : null}

    <section className="kf-stat-grid" aria-label="Project graph summary">
      <article className="kf-stat"><span className="kf-tile"><Layers size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Files</span><strong className="kf-stat__value">{counts.files}<small> indexed</small></strong><span className="kf-stat__foot">{counts.tests} test files · {counts.configs} config</span></div></article>
      <article className="kf-stat"><span className="kf-tile"><Boxes size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Modules</span><strong className="kf-stat__value">{modules.length}<small> groups</small></strong><span className="kf-stat__foot">Largest: {highestModule?.group || "—"}</span></div></article>
      <article className="kf-stat"><span className="kf-tile"><GitBranch size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Dependencies</span><strong className="kf-stat__value">{counts.dependencies}<small> packages</small></strong><span className="kf-stat__foot">Manifest evidence only</span></div></article>
      <article className="kf-stat"><span className="kf-tile"><Braces size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Symbols</span><strong className="kf-stat__value">{counts.symbols}<small> defined</small></strong><span className="kf-stat__foot">Static syntax evidence</span></div></article>
      <article className="kf-stat"><span className="kf-tile"><Route size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Entry points</span><strong className="kf-stat__value">{counts.entries}<small> routes / APIs</small></strong><span className="kf-stat__foot">{degree.get(positioned.find((node) => node.kind === "entry")?.key || "") || 0} connections on top route</span></div></article>
    </section>

    <div className="kw-graph-layout">
      <section className="kf-card kw-graph-card" aria-label="Project dependency graph">
        <header className="kw-graph-head">
          <div className="kf-card__title"><span className="kf-tile"><Network size={18} /></span><div><h2>Project Dependency Graph</h2><p>Files, symbols and imports from the bounded local scan.</p></div></div>
          <div className="kw-graph-search"><Search size={14} /><input aria-label="Search graph" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes, paths…" /></div>
          <div className="kw-graph-legend">
            <span><i data-kind="module" />Project module</span>
            <span><i data-kind="dependency" />Dependency</span>
            <span><i data-kind="entry" />Entry point</span>
          </div>
        </header>
        <div className="kw-graph-canvas" aria-label="Graph canvas">
          <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} role="presentation">
            <defs>
              <linearGradient id="kf-edge-violet" x1="0" x2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
            </defs>
            {visibleNodes.filter((node) => node.kind === "module").map((node) => <path key={`root-${node.key}`} className="kw-graph-edge" d={`M ${GRAPH_W / 2} ${GRAPH_H / 2} C ${GRAPH_W / 2 + (node.x - GRAPH_W / 2) / 2} ${GRAPH_H / 2}, ${GRAPH_W / 2 + (node.x - GRAPH_W / 2) / 2} ${node.y}, ${node.x} ${node.y}`} />)}
            {visibleNodes.filter((node) => node.kind === "dependency" || node.kind === "entry").map((node) => <path key={`dep-${node.key}`} className="kw-graph-edge is-soft" d={`M ${node.x} ${node.y} C ${(node.x + GRAPH_W / 2) / 2} ${node.y}, ${(node.x + GRAPH_W / 2) / 2} ${GRAPH_H / 2}, ${GRAPH_W / 2} ${GRAPH_H / 2}`} />)}
            {groupEdges.map(([key]) => {
              const [from, to] = key.split("→");
              const left = positioned.find((node) => node.kind === "module" && node.label === from);
              const right = positioned.find((node) => node.kind === "module" && node.label === to);
              if (!left || !right) return null;
              return <path key={`cross-${key}`} className="kw-graph-edge is-cross" d={`M ${left.x} ${left.y} Q ${(left.x + right.x) / 2} ${(left.y + right.y) / 2 - 40}, ${right.x} ${right.y}`} />;
            })}
          </svg>
          <button className={`kw-graph-node kw-graph-node--root ${selected === "root" ? "is-selected" : ""}`} style={{ left: "50%", top: "50%" }} onClick={() => setSelected("root")}>
            <span className="kw-graph-node__icon"><Sparkles size={16} /></span>
            <strong>{project.name}</strong>
            <small>Project root</small>
          </button>
          {visibleNodes.filter((node) => node.kind === "module").map((node) => <button key={node.key} className={`kw-graph-node kw-graph-node--module ${selected === node.key ? "is-selected" : ""} ${selectedHasMatch(node.key) ? "" : "is-dimmed"}`} style={{ left: `${(node.x / GRAPH_W) * 100}%`, top: `${(node.y / GRAPH_H) * 100}%` }} onClick={() => setSelected(node.key)} title={node.label}>
            <span className="kw-graph-node__icon"><Layers size={14} /></span>
            <strong>{node.label.split("/").at(-1)}</strong>
            <small>{node.meta}</small>
          </button>)}
          {visibleNodes.filter((node) => node.kind === "dependency").map((node) => <button key={node.key} className={`kw-graph-node kw-graph-node--dependency ${selected === node.key ? "is-selected" : ""} ${selectedHasMatch(node.key) ? "" : "is-dimmed"}`} style={{ left: `${(node.x / GRAPH_W) * 100}%`, top: `${(node.y / GRAPH_H) * 100}%` }} onClick={() => setSelected(node.key)} title={node.label}>
            <span className="kw-graph-node__icon"><Boxes size={13} /></span>
            <strong>{node.label}</strong>
            <small>{node.meta}</small>
          </button>)}
          {visibleNodes.filter((node) => node.kind === "entry").map((node) => <button key={node.key} className={`kw-graph-node kw-graph-node--entry ${selected === node.key ? "is-selected" : ""} ${selectedHasMatch(node.key) ? "" : "is-dimmed"}`} style={{ left: `${(node.x / GRAPH_W) * 100}%`, top: `${(node.y / GRAPH_H) * 100}%` }} onClick={() => setSelected(node.key)} title={node.path || node.label}>
            <span className="kw-graph-node__icon"><Route size={13} /></span>
            <strong>{node.label}</strong>
            <small>{node.meta}</small>
          </button>)}
          {!visibleNodes.length && !message ? <div className="kw-graph-empty">No module, dependency or entry-point node matched the active filters.</div> : null}
        </div>
        <footer className="kw-graph-foot">
          <span className="kw-graph-coverage" data-graph-coverage={coverage?.state || "UNKNOWN"}>Scan coverage {coverage?.state || "UNKNOWN"} · {coverage?.scannedCount ?? 0} of {coverage?.totalOrUnknown ?? "unknown"} files · limit {coverage?.limit ?? "unknown"} · {coverage?.source || "Local graph"} · cache {cache?.state || "UNKNOWN"}</span>
          <div className="kw-graph-toggles">
            <label><input type="checkbox" checked={filters.modules} onChange={(event) => setFilters({ ...filters, modules: event.target.checked })} />Project modules</label>
            <label><input type="checkbox" checked={filters.dependencies} onChange={(event) => setFilters({ ...filters, dependencies: event.target.checked })} />Dependencies</label>
            <label><input type="checkbox" checked={filters.entries} onChange={(event) => setFilters({ ...filters, entries: event.target.checked })} />Entry points</label>
          </div>
        </footer>
      </section>

      <aside className="kf-card kw-graph-side" aria-label="Graph insights">
        <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile"><Sparkles size={17} /></span><div><h2>Graph Insights</h2><p>Measured from local graph evidence.</p></div></div></header>
        <div className="kw-graph-insights">
          <article><span className="kf-eyebrow">Selected node</span>{selectedNode ? <><strong>{selectedNode.label}</strong><small>{selectedNode.meta} · {selectedConnections} connection(s){selectedNode.path ? ` · ${selectedNode.path}` : ""}</small></> : <><strong>{project.name}</strong><small>Project root · {nodes.length} nodes · {edges.length} edges</small></>}</article>
          <article><span className="kf-eyebrow">Largest module</span><strong>{highestModule?.group || "—"}</strong><small>{highestModule ? `${highestModule.total} indexed nodes` : "No module evidence"}</small></article>
          <article><span className="kf-eyebrow">Most connected</span><strong>{mostConnected?.label || "—"}</strong><small>{mostConnected ? mostConnected.meta : "No edges in scan"}</small></article>
          <article><span className="kf-eyebrow">Scan</span><strong>{coverage?.state || "UNKNOWN"}</strong><small>{data?.graph?.generatedAt ? `Generated ${new Date(data.graph.generatedAt).toLocaleString()}` : "No generation timestamp"}</small></article>
          {selectedNode ? <button className="kf-btn" onClick={() => { setImpactTarget(selectedNode.path || selectedNode.label); }}>Use as impact target<ChevronRight size={13} /></button> : null}
        </div>
        <div className="kw-graph-impact">
          <div className="kf-card__title"><span className="kf-tile kf-tile--amber"><Zap size={16} /></span><div><h3>Impact Analysis</h3><p>Static dependents and reverse dependencies.</p></div></div>
          <div className="kw-graph-impact__form">
            <label><Link2 size={14} /><input aria-label="Graph impact target" value={impactTarget} onChange={(event) => setImpactTarget(event.target.value)} placeholder="src/api/users.ts" /></label>
            <button className="kf-btn kf-btn--primary" disabled={!impactTarget.trim() || impactBusy} onClick={() => void runImpact()}>{impactBusy ? "Analyzing…" : "Analyze"}</button>
          </div>
          {impactError ? <p className="kw-message" role="alert">{impactError}</p> : null}
          {impactBody.target ? <div className="kw-impact-result">
            <div className="kw-impact-result__head"><strong>{String(impactBody.file || impactBody.target)}</strong><StatusBadge value={impactBody.risk || "UNKNOWN"} /></div>
            <div className="kw-impact-grid">
              <span><small>Direct</small><strong>{asList(impactBody.directDependents).length}</strong></span>
              <span><small>Transitive</small><strong>{asList(impactBody.transitiveDependents).length}</strong></span>
              <span><small>Symbols</small><strong>{asList(impactBody.affectedSymbols).length}</strong></span>
              <span><small>Tests</small><strong>{asList(impactBody.relatedTests).length}</strong></span>
            </div>
            <p>{String(impactBody.message || "Impact evidence returned.")}</p>
            <details><summary>Impact evidence</summary><pre>{JSON.stringify(impact, null, 2)}</pre></details>
          </div> : null}
        </div>
      </aside>
    </div>
  </section>;
}

function IntelligenceSurface({ view, project }: SurfaceProps) {
  if (!project) return <ProjectRequired detail={`${viewLabel("intelligence", view)} needs project context.`} />;
  if (view === "project-graph") return <ProjectGraphWorkbench project={project} />;
  if (view === "impact-analysis") return <ImpactAnalysis project={project} />;
  if (view === "ask-kforge") return <AskKForge project={project} />;
  if (view === "code-understanding") return <CodeUnderstanding project={project} />;
  const url = view === "dependencies" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/profile` : view === "architecture" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/architecture` : `/api/workspace/projects/${encodeURIComponent(project.id)}/graph`;
  return <SimpleFetchSurface url={url} title={viewLabel("intelligence", view)} />;
}

function CodeUnderstanding({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setMessage("");
    void fetchJson<GraphResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph`, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setData(next); })
      .catch((error: unknown) => { if (controller.signal.aborted) return; setMessage(error instanceof Error ? error.message : "Code understanding evidence unavailable."); });
    return () => controller.abort();
  }, [project.id]);

  const nodes = data?.graph?.nodes || [];
  const edges = data?.graph?.edges || [];
  const coverage = data?.graph?.coverage;
  const cache = data?.graph?.cache;
  const files = nodes.filter((node) => node.type === "file");
  const symbols = nodes.filter((node) => node.type === "symbol");
  const tests = nodes.filter((node) => node.type === "test");
  const entryPoints = nodes.filter((node) => node.type === "api");
  const imports = edges.filter((edge) => edge.type === "imports");

  return <section className="kw-form-surface" aria-label="Code Understanding evidence" data-code-understanding-state={message ? "UNAVAILABLE" : data ? "SCANNED" : "LOADING"}>
    <h2>Code Understanding</h2>
    <p>Structure evidence comes from the bounded local Project Graph scan of this project. Nothing here is inferred from a remote service.</p>
    {message && <p className="kw-message" role="status">{message}</p>}
    {!data && !message ? <p className="kw-message">Reading bounded local structure evidence…</p> : null}
    {data ? <>
      <div className="kw-inline-actions">
        <span className="kw-badge">Files {files.length}</span>
        <span className="kw-badge">Symbols {symbols.length}</span>
        <span className="kw-badge">Tests {tests.length}</span>
        <span className="kw-badge">Entry points {entryPoints.length}</span>
        <span className="kw-badge">Import edges {imports.length}</span>
      </div>
      <p className="text-xs text-muted-foreground" data-code-understanding-coverage={coverage?.state || "UNKNOWN"}>
        Scan coverage {coverage?.state || "UNKNOWN"} · {coverage?.scannedCount ?? 0} of {coverage?.totalOrUnknown ?? "unknown"} source file(s) indexed against a limit of {coverage?.limit ?? "unknown"} · evidence source {coverage?.source || "UNKNOWN"} · graph cache {cache?.state || "UNKNOWN"}{cache?.generatedAt ? ` at ${cache.generatedAt}` : ""}.
      </p>
      {coverage?.state === "LIMIT_REACHED" ? <p className="kw-message" role="status">This scan reached its explicit source-file safety limit, so unindexed files or symbols may exist. {coverage.reason || ""}</p> : null}
      {cache?.state === "CACHED" ? <p className="kw-message" role="status">These counts are cached graph evidence, not a live re-scan. {cache.fingerprint ? `Fingerprint ${cache.fingerprint}.` : ""}</p> : null}
      <section aria-label="Detected entry points">
        <h3>Entry points</h3>
        {entryPoints.length ? <ul className="ml-4 list-disc text-xs text-muted-foreground">{entryPoints.slice(0, 20).map((node) => <li key={node.id || node.path || node.label}>{node.path || node.label || node.id || "UNKNOWN"}</li>)}</ul> : <p>No API entry point was detected in the bounded scan.</p>}
      </section>
      <section aria-label="Largest symbol clusters">
        <h3>Most referenced files</h3>
        {(() => {
          const incoming = new Map<string, number>();
          imports.forEach((edge) => { if (edge.to) incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1); });
          const ranked = [...incoming.entries()].sort((left, right) => right[1] - left[1]).slice(0, 15);
          return ranked.length ? <ul className="ml-4 list-disc text-xs text-muted-foreground">{ranked.map(([node, count]) => <li key={node}>{node.replace(/^file:/, "")} · {count} importing file(s)</li>)}</ul> : <p>No import relationship was detected in the bounded scan.</p>;
        })()}
      </section>
      <details className="kw-advanced-evidence">
        <summary>Advanced evidence</summary>
        <pre tabIndex={0} aria-label="Code Understanding raw graph evidence">{JSON.stringify({ projectId: data.projectId, generatedAt: data.graph?.generatedAt, coverage, cache }, null, 2)}</pre>
      </details>
    </> : null}
  </section>;
}

function ImpactAnalysis({ project }: { project: ProjectSummary }) {
  const [target, setTarget] = useState(""); const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState("");
  const body = (data?.impact || {}) as RecordRow;
  const asList = (value: unknown) => Array.isArray(value) ? value : [];
  return <section className="kw-form-surface kw-impact-surface"><h2>Impact Analysis</h2><p>Static dependents, reverse dependencies and owned symbols from the bounded project graph. Runtime behavior is never inferred.</p><div className="kw-impact-form"><input aria-label="Impact target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="src/api/users.ts" /><button className="kf-btn kf-btn--primary" disabled={!target.trim()} onClick={() => void fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph/impact?target=${encodeURIComponent(target.trim())}`).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : "Impact analysis failed."))}>Analyze impact</button></div>{message && <p className="kw-message">{message}</p>}{body.target ? <div className="kw-impact-result"><div className="kw-impact-result__head"><strong>{String(body.file || body.target)}</strong><StatusBadge value={body.risk || "UNKNOWN"} /></div><div className="kw-impact-grid"><span><small>Direct</small><strong>{asList(body.directDependents).length}</strong></span><span><small>Transitive</small><strong>{asList(body.transitiveDependents).length}</strong></span><span><small>Symbols</small><strong>{asList(body.affectedSymbols).length}</strong></span><span><small>Tests</small><strong>{asList(body.relatedTests).length}</strong></span></div><p>{String(body.message || "Impact evidence returned.")}</p><pre>{JSON.stringify(data, null, 2)}</pre></div> : null}</section>;
}

function AskKForge({ project }: { project: ProjectSummary }) {
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<RecordRow | null>(null); const [message, setMessage] = useState("");
  return <section className="kw-form-surface"><h2>Ask KForge</h2><p>Answers are bounded to redacted project evidence; deterministic rules are used when no local model is available.</p><textarea aria-label="Ask KForge question" value={question} onChange={(e) => setQuestion(e.target.value)} /><button disabled={!question.trim()} onClick={() => void fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/ask`, jsonRequest({ question })).then(setAnswer).catch((error) => setMessage(error instanceof Error ? error.message : "Ask KForge failed."))}>Analyze project evidence</button>{message && <p className="kw-message">{message}</p>}{answer && <article className="kw-answer"><pre>{JSON.stringify(answer, null, 2)}</pre></article>}</section>;
}

export default IntelligenceSurface;
