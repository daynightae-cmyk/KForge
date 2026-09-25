import { useState, useEffect } from "react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState } from "./ui";
import { viewLabel } from "./navigation";
import { SimpleFetchSurface } from "./surfaceShared";

function IntelligenceSurface({ view, project }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("intelligence", view)} needs project context.`} />;
  if (view === "impact-analysis") return <ImpactAnalysis project={project} />;
  if (view === "ask-kforge") return <AskKForge project={project} />;
  if (view === "code-understanding") return <CodeUnderstanding project={project} />;
  const url = view === "dependencies" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/profile` : view === "architecture" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/architecture` : `/api/workspace/projects/${encodeURIComponent(project.id)}/graph`;
  return <SimpleFetchSurface url={url} title={viewLabel("intelligence", view)} />;
}

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
  return <section className="kw-form-surface"><h2>Impact Analysis</h2><input aria-label="Impact target" value={target} onChange={(e) => setTarget(e.target.value)} /><button disabled={!target.trim()} onClick={() => void fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph/impact?target=${encodeURIComponent(target.trim())}`).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : "Impact analysis failed."))}>Analyze impact</button>{message && <p className="kw-message">{message}</p>}{data && <pre>{JSON.stringify(data, null, 2)}</pre>}</section>;
}

function AskKForge({ project }: { project: ProjectSummary }) {
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<RecordRow | null>(null); const [message, setMessage] = useState("");
  return <section className="kw-form-surface"><h2>Ask KForge</h2><p>Answers are bounded to redacted project evidence; deterministic rules are used when no local model is available.</p><textarea aria-label="Ask KForge question" value={question} onChange={(e) => setQuestion(e.target.value)} /><button disabled={!question.trim()} onClick={() => void fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/ask`, jsonRequest({ question })).then(setAnswer).catch((error) => setMessage(error instanceof Error ? error.message : "Ask KForge failed."))}>Analyze project evidence</button>{message && <p className="kw-message">{message}</p>}{answer && <article className="kw-answer"><pre>{JSON.stringify(answer, null, 2)}</pre></article>}</section>;
}

export default IntelligenceSurface;
