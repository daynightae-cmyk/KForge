import { useEffect, useState } from "react";
import type { SurfaceProps, RecordRow, TaskRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { EvidenceCards, TaskTable } from "./ui";
import ProviderStudio from "./ProviderStudio";
import { ProjectRequired } from "./ProjectStartActions";
import { Activity, Bot, CheckCircle2, Clock3, ListChecks, PlayCircle, ShieldCheck, Wrench } from "lucide-react";

function AISurface(props: SurfaceProps) {
  const { view, project } = props;
  if (view === "agents") return project ? <AgentMissionSurface project={project} /> : <ProjectRequired detail="Select a project to inspect agent permissions and start a mission. Discover agent catalog records in Online / Agents." />;
  if (view === "tasks") return <AITasks />;
  return <ProviderStudio view={view} project={project} />;
}

function taskStats(tasks: TaskRow[]) {
  const running = tasks.filter((task) => /RUNNING|QUEUED|STARTING/i.test(String(task.status))).length;
  const completed = tasks.filter((task) => /COMPLETE|PASS|SUCCESS/i.test(String(task.status))).length;
  const failed = tasks.filter((task) => /FAIL|ERROR|BLOCK/i.test(String(task.status))).length;
  return { running, completed, failed };
}

function AgentMissionSurface({ project }: { project: ProjectSummary }) {
  const [tools, setTools] = useState<RecordRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [message, setMessage] = useState("");
  const [started, setStarted] = useState<TaskRow | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`),
      fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks"),
    ]).then(([toolData, taskData]) => {
      if (!active) return;
      setTools(toolData.tools || []);
      setTasks((taskData.tasks || []).filter((task) => task.kind === "agent" || /agent|mission/i.test(JSON.stringify(task))).slice(0, 8));
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Agent evidence unavailable."); });
    return () => { active = false; };
  }, [project.id]);

  const blocked = tools.filter((tool) => tool.allowed === false || tool.permitted === false || String(tool.state || "").toUpperCase() === "BLOCKED").length;
  const stats = taskStats(tasks);

  const start = async () => {
    setMessage("Starting typed audit mission…");
    try {
      const data = await fetchJson<{ task: TaskRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/missions`, jsonRequest({ mission: "audit" }));
      setStarted(data.task);
      setTasks((current) => [data.task, ...current]);
      setMessage(`Mission task ${data.task.id} started. Open Tasks to follow its persisted event log.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mission start failed.");
    }
  };

  return <div className="kf-stack kw-agent-surface">
    <section className="kf-stat-grid" aria-label="Agent mission summary">
      <article className="kf-stat"><span className="kf-tile"><Wrench size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Tool permissions</span><strong className="kf-stat__value">{tools.length}</strong><span className="kf-stat__foot">Server-enforced eligibility</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--amber"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Blocked tools</span><strong className="kf-stat__value">{blocked}</strong><span className="kf-stat__foot">Never invoked without eligibility</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--green"><PlayCircle size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Agent tasks running</span><strong className="kf-stat__value">{stats.running}</strong><span className="kf-stat__foot">{stats.completed} completed · {stats.failed} failed</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--blue"><ListChecks size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Recent agent runs</span><strong className="kf-stat__value">{tasks.length}</strong><span className="kf-stat__foot">Persisted execution evidence</span></div></article>
    </section>

    <div className="kw-agent-layout">
      <section className="kf-card kw-agent-mission kw-agent-panel" aria-label="KForge Engineer missions">
        <header className="kf-card__head">
          <div className="kf-card__title"><span className="kf-tile"><Bot size={18} /></span><div><h2>KForge Engineer missions</h2><p>Read · Plan · Patch · Verify. Trust is enforced server-side; write-capable steps remain snapshot/confirmation gated.</p></div></div>
        </header>
        <div className="kw-agent-mission__body">
          <div className="kw-agent-steps">
            {["Read", "Plan", "Patch", "Verify"].map((step, index) => <span key={step}><i>{index + 1}</i>{step}</span>)}
          </div>
          <p>This typed audit mission reads bounded project scan and graph evidence, produces a plan, and records each step in the canonical Tasks ledger. A write-capable step does not execute without the existing snapshot and confirmation contract.</p>
          <div className="kw-agent-mission__actions">
            <button className="kf-btn kf-btn--primary" onClick={() => void start()} aria-label="Start mission"><PlayCircle size={14} />Start mission</button>
            <span className="kf-chip">Project · {project.name}</span>
          </div>
          {message && <p className="kw-message" role="status">{message}</p>}
          {started ? <details className="kw-agent-started" open><summary>Started mission evidence · {started.id}</summary><pre>{JSON.stringify(started, null, 2)}</pre></details> : null}
        </div>
      </section>

      <section className="kf-card kw-agent-tools" aria-label="Agent tool eligibility">
        <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile kf-tile--green"><ShieldCheck size={17} /></span><div><h2>Tool eligibility</h2><p>Permissions and blocked reasons for this project.</p></div></div></header>
        <div className="kf-card__body">
          {tools.length ? <div className="kw-agent-tool-list">{tools.map((tool, index) => <article key={String(tool.id || tool.name || index)}><span className={`kw-agent-tool-dot ${tool.allowed === false || tool.permitted === false ? "is-blocked" : ""}`} /><div><strong>{String(tool.name || tool.id || `Tool ${index + 1}`)}</strong><small>{String(tool.detail || tool.reason || tool.state || "Eligibility evidence returned")}</small></div></article>)}</div> : <p className="kw-agent-empty">No tool eligibility rows were returned for this project. KForge does not invent an agent capability.</p>}
          <details><summary>Raw tool evidence</summary><EvidenceCards rows={tools} /></details>
        </div>
      </section>
    </div>

    <section className="kf-card" aria-label="Recent agent task runs">
      <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile"><Activity size={17} /></span><div><h2>Recent runs</h2><p>Every agent task is persisted by the canonical task ledger.</p></div></div><span className="kf-chip">{tasks.length} runs</span></header>
      <div className="kf-card__body">{tasks.length ? <TaskTable tasks={tasks} /> : <p className="kw-agent-empty"><Clock3 size={14} /> No agent mission has run for this project yet. Start an audit mission to create the first persisted task.</p>}</div>
    </section>
  </div>;
}

function AITasks() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  useEffect(() => { let active = true; const refresh = () => void fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks").then((data) => { if (active) setTasks((data.tasks || []).filter((task) => task.kind === "agent" || task.projectId === "ai-center")); }).catch(() => undefined); refresh(); const timer = window.setInterval(refresh, 700); return () => { active = false; window.clearInterval(timer); }; }, []);
  const stats = taskStats(tasks);
  return <div className="kf-stack">
    <section className="kf-stat-grid" aria-label="Task center summary">
      <article className="kf-stat"><span className="kf-tile"><ListChecks size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Tracked tasks</span><strong className="kf-stat__value">{tasks.length}</strong><span className="kf-stat__foot">Agent mission ledger</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--blue"><PlayCircle size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Running / queued</span><strong className="kf-stat__value">{stats.running}</strong><span className="kf-stat__foot">Live process evidence</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--green"><CheckCircle2 size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Completed</span><strong className="kf-stat__value">{stats.completed}</strong><span className="kf-stat__foot">Recorded outcomes</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--amber"><Clock3 size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Failed / blocked</span><strong className="kf-stat__value">{stats.failed}</strong><span className="kf-stat__foot">Never hidden</span></div></article>
    </section>
    <section className="kf-card" aria-label="Task Center">
      <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile"><Activity size={17} /></span><div><h2>Task Center</h2><p>Persisted agent and AI tasks with their evidence.</p></div></div></header>
      <div className="kf-card__body"><TaskTable tasks={tasks} /></div>
    </section>
  </div>;
}

export default AISurface;
