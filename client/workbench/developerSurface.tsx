import { useEffect, useState } from "react";
import { LockKeyhole, Play, ScrollText, ShieldCheck, Terminal } from "lucide-react";
import type { ProjectSummary, WorkspaceActionDescriptor, CommandResult } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import { ProjectRequired } from "./ProjectStartActions";

function DeveloperSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <ProjectRequired detail="Developer execution requires explicit project context." />;
  if (view === "terminal") return <CommandTerminal project={project} onExecution={onExecution} />;
  return <EmptyState title="Specialized developer surface unavailable" detail={`${view} must be routed through its dedicated Workbench implementation. KForge does not fall back to a duplicate generic executor.`} />;
}

function CommandTerminal({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`)
      .then((data) => { setActions(data.actions); setMessage(""); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Action evidence unavailable."))
      .finally(() => setLoaded(true));
  }, [project.id]);

  const run = async (descriptor: WorkspaceActionDescriptor) => {
    if (!descriptor.enabled) return;
    const confirmed = descriptor.requiresConfirmation ? window.confirm(`${descriptor.label} requires confirmation.`) : false;
    if (descriptor.requiresConfirmation && !confirmed) return;
    onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source });
    try {
      const data = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, jsonRequest({ action: descriptor.id, confirmed }));
      onExecution({ label: descriptor.label, command: descriptor.command, state: data.ok ? "PASS" : "FAILED", source: descriptor.source, startedAt: data.startedAt, completedAt: data.completedAt, output: data.output, message: data.message, exitCode: data.exitCode });
    } catch (error) {
      onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Execution failed." });
    }
  };

  const executable = actions.filter((action) => action.enabled).length;
  const gated = actions.filter((action) => action.requiresConfirmation).length;

  return <div className="kf-stack" aria-label="KForge Command Terminal">
    <section className="kf-stat-grid" aria-label="Command terminal summary">
      <article className="kf-stat"><span className="kf-tile"><Terminal size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Registered actions</span><strong className="kf-stat__value">{loaded ? actions.length : "…"}</strong><span className="kf-stat__foot">Canonical project actions</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--green"><Play size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Executable now</span><strong className="kf-stat__value">{loaded ? executable : "…"}</strong><span className="kf-stat__foot">Eligibility checked server-side</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--amber"><LockKeyhole size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Confirmation gated</span><strong className="kf-stat__value">{loaded ? gated : "…"}</strong><span className="kf-stat__foot">Explicit confirmation required</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--blue"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Shell access</span><strong className="kf-stat__value" style={{ fontSize: 17 }}>NONE</strong><span className="kf-stat__foot">No unrestricted shell input</span></div></article>
    </section>

    <section className="kw-terminal" aria-label="KForge registered command terminal">
      <div className="kw-terminal-header"><span className="kw-terminal-mark"><Terminal size={19} /></span><div><strong>KForge Command Terminal</strong><small>Working directory · {project.path}</small></div><span className="kw-terminal-live"><i />LOCAL</span></div>
      <div className="kw-terminal-notes">
        <span><ShieldCheck size={13} />Only registered KForge actions are executable. There is no unrestricted shell input.</span>
        <span><ScrollText size={13} />Tests, Build, Runtime, Lint and Preview have dedicated Workbenches and are not duplicated here.</span>
      </div>
      {message && <p className="kw-message" role="status">{message}</p>}
      {!loaded ? <div className="kw-terminal-loading" role="status">Reading registered project actions…</div> : actions.length ? <div className="kw-command-table"><div className="kw-command-head"><span>Command</span><span>State</span><span>Permission</span><span>Evidence source</span><span /></div>{actions.map((descriptor) => <div key={descriptor.id}><span><strong>{descriptor.label}</strong><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></span><StatusBadge value={descriptor.state} /><span>{descriptor.requiredPermission}</span><span>{descriptor.source}<small>{descriptor.unavailableReason}</small></span><button disabled={!descriptor.enabled} onClick={() => void run(descriptor)}><Play size={11} />Run</button></div>)}</div> : <div className="kw-terminal-loading">No registered command is available for this project. KForge does not create an unrestricted shell fallback.</div>}
    </section>
  </div>;
}

export default DeveloperSurface;
