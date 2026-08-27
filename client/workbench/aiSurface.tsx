import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SurfaceProps, RecordRow, TaskRow, ExecutionSnapshot, MarketplaceData, MarketplaceItem } from "./surfaceContracts";
import { fetchJson, fetchEvidence, jsonRequest, waitForTask } from "./api";
import { EmptyState, StatusBadge, EvidenceRows, EvidenceCards, TaskTable, EvidenceTable } from "./ui";
import { viewLabel } from "./navigation";

function AISurface(props: SurfaceProps) {
  const { view, project } = props;
  if (view === "agents") return project ? <AgentMissionSurface project={project} /> : <SimpleFetchSurface url="/api/workspace/marketplace" title="Global agent catalog" />;
  if (view === "tasks") return <AITasks />;
  return <AISource view={view} />;
}

function AISource({ view }: { view: string }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState("Loading AI evidence…");
  useEffect(() => { void fetchJson<RecordRow>(view === "providers" ? "/api/workspace/ai/providers" : "/api/workspace/ai/models").then((next) => { setData(next); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "AI evidence unavailable.")); }, [view]);
  if (message) return <p className="kw-message">{message}</p>; if (!data) return null;
  if (view === "providers") return <section className="kw-surface-section"><h2>Provider runtime and configuration evidence</h2><p>Local project context stays on this machine. Opening Providers does not contact cloud providers or expose credentials.</p><EvidenceCards rows={(data.providers as RecordRow[] || [])} /></section>;
  return <section className="kw-surface-section"><h2>Local Model Center</h2><p>Installed runtime inventory is distinct from catalog recommendations. Unknown capabilities remain UNKNOWN.</p><h3>Provider evidence</h3><EvidenceCards rows={(data.providers as RecordRow[] || [])} /><h3>Recommended catalog models</h3><EvidenceCards rows={(data.recommendations as RecordRow[] || [])} /><details><summary>Hardware and model-family evidence</summary><pre>{JSON.stringify({ hardware: data.hardware, families: data.families, onboarding: data.onboarding, active: data.active }, null, 2)}</pre></details></section>;
}

function AgentMissionSurface({ project }: { project: ProjectSummary }) {
  const [tools, setTools] = useState<RecordRow[]>([]); const [message, setMessage] = useState(""); const [started, setStarted] = useState<TaskRow | null>(null);
  useEffect(() => { void fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`).then((data) => setTools(data.tools || [])).catch((error) => setMessage(error instanceof Error ? error.message : "Agent evidence unavailable.")); }, [project.id]);
  const start = async () => { setMessage("Starting typed audit mission…"); try { const data = await fetchJson<{ task: TaskRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/missions`, jsonRequest({ mission: "audit" })); setStarted(data.task); setMessage(`Mission task ${data.task.id} started. Open Tasks to follow its persisted event log.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Mission start failed."); } };
  return <section className="kw-agent-panel"><h2>KForge Engineer missions</h2><p>Read · Plan · Patch · Verify. Trust is enforced server-side; write-capable steps remain snapshot/confirmation gated.</p><h3>Agent permissions and tool eligibility</h3><EvidenceCards rows={tools} /><div className="kw-agent-actions"><button onClick={() => void start()}>Start mission</button></div>{message && <p className="kw-message" role="status">{message}</p>}{started && <details open><summary>Started mission evidence</summary><pre>{JSON.stringify(started, null, 2)}</pre></details>}</section>;
}

function AITasks() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  useEffect(() => { let active = true; const refresh = () => void fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks").then((data) => { if (active) setTasks((data.tasks || []).filter((task) => task.kind === "agent" || task.projectId === "ai-center")); }).catch(() => undefined); refresh(); const timer = window.setInterval(refresh, 700); return () => { active = false; window.clearInterval(timer); }; }, []);
  return <section className="kw-surface-section"><h2>Task Center</h2><TaskTable tasks={tasks} /></section>;
}
