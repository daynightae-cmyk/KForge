import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import type { ProjectSummary, WorkspaceActionDescriptor, CommandResult } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

function DeveloperSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Developer execution requires explicit project context." />;
  if (view === "terminal") return <CommandTerminal project={project} onExecution={onExecution} />;
  return <EmptyState title="Specialized developer surface unavailable" detail={`${view} must be routed through its dedicated Workbench implementation. KForge does not fall back to a duplicate generic executor.`} />;
}

function CommandTerminal({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]);
  const [message, setMessage] = useState("Loading registered commands…");

  useEffect(() => {
    void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`)
      .then((data) => { setActions(data.actions); setMessage(""); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Action evidence unavailable."));
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

  return <section className="kw-terminal" aria-label="KForge Command Terminal">
    <div className="kw-terminal-header"><Terminal size={18} /><div><strong>KForge Command Terminal</strong><small>Working directory · {project.path}</small></div></div>
    <p>Only registered KForge actions are executable. There is no unrestricted shell input. Tests, Build, Runtime, Lint and Preview have dedicated Workbenches and are not duplicated here.</p>
    {message && <p className="kw-message" role="status">{message}</p>}
    <div className="kw-command-table"><div className="kw-command-head"><span>Command</span><span>State</span><span>Permission</span><span>Evidence source</span><span /></div>{actions.map((descriptor) => <div key={descriptor.id}><span><strong>{descriptor.label}</strong><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></span><StatusBadge value={descriptor.state} /><span>{descriptor.requiredPermission}</span><span>{descriptor.source}<small>{descriptor.unavailableReason}</small></span><button disabled={!descriptor.enabled} onClick={() => void run(descriptor)}>Run</button></div>)}</div>
  </section>;
}

export default DeveloperSurface;
