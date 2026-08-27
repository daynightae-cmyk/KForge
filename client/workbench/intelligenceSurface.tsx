import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SurfaceProps, RecordRow, TaskRow, ExecutionSnapshot, MarketplaceData, MarketplaceItem } from "./surfaceContracts";
import { fetchJson, fetchEvidence, jsonRequest, waitForTask } from "./api";
import { EmptyState, StatusBadge, EvidenceRows, EvidenceCards, TaskTable, EvidenceTable } from "./ui";
import { viewLabel } from "./navigation";

function IntelligenceSurface({ view, project }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("intelligence", view)} needs project context.`} />;
  if (view === "impact-analysis") return <ImpactAnalysis project={project} />;
  if (view === "ask-kforge") return <AskKForge project={project} />;
  const url = view === "dependencies" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/profile` : view === "architecture" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/architecture` : `/api/workspace/projects/${encodeURIComponent(project.id)}/graph`;
  return <SimpleFetchSurface url={url} title={viewLabel("intelligence", view)} />;
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
