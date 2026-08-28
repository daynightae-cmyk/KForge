import { useState, useEffect } from "react";
import { Terminal } from "lucide-react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary, WorkspaceAction, WorkspaceActionDescriptor, CommandResult } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge, EvidenceRows } from "./ui";
import { KForgeServiceCard } from "@/components/ui/KForgeServiceCard";
import { viewLabel } from "./navigation";
import { SimpleFetchSurface } from "./surfaceShared";

function DeveloperSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Developer execution requires explicit project context." />;
  if (view === "terminal") return <CommandTerminal project={project} onExecution={onExecution} />;
  if (["tests", "build", "runtime"].includes(view)) return <ActionSurface project={project} action={view === "tests" ? "test" : view as WorkspaceAction} onExecution={onExecution} />;
  if (view === "lint") return <LintSurface project={project} onExecution={onExecution} />;
  if (view === "preview") return <PreviewSurface project={project} onExecution={onExecution} />;
  return <SimpleFetchSurface url={view === "logs" ? `/api/workspace/tasks?projectId=${encodeURIComponent(project.id)}` : `/api/workspace/projects/${encodeURIComponent(project.id)}/problems`} title={viewLabel("developer-tools", view)} />;
}

function CommandTerminal({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]); const [message, setMessage] = useState("Loading registered commands…");
  useEffect(() => { void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`).then((data) => { setActions(data.actions); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Action evidence unavailable.")); }, [project.id]);
  const run = async (descriptor: WorkspaceActionDescriptor) => { if (!descriptor.enabled) return; const confirmed = descriptor.requiresConfirmation ? window.confirm(`${descriptor.label} requires confirmation.`) : false; if (descriptor.requiresConfirmation && !confirmed) return; onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source }); try { const data = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, jsonRequest({ action: descriptor.id, confirmed })); onExecution({ label: descriptor.label, command: descriptor.command, state: data.ok ? "PASS" : "FAILED", source: descriptor.source, startedAt: data.startedAt, completedAt: data.completedAt, output: data.output, message: data.message, exitCode: data.exitCode }); } catch (error) { onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Execution failed." }); } };
  return <section className="kw-terminal"><div className="kw-terminal-header"><Terminal size={18} /><div><strong>KForge Command Terminal</strong><small>Working directory · {project.path}</small></div></div><p>Only registered KForge actions are executable. There is no unrestricted shell input.</p>{message && <p className="kw-message">{message}</p>}<div className="kw-command-table"><div className="kw-command-head"><span>Command</span><span>State</span><span>Permission</span><span>Evidence source</span><span /></div>{actions.map((descriptor) => <div key={descriptor.id}><span><strong>{descriptor.label}</strong><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></span><StatusBadge value={descriptor.state} /><span>{descriptor.requiredPermission}</span><span>{descriptor.source}<small>{descriptor.unavailableReason}</small></span><button disabled={!descriptor.enabled} onClick={() => void run(descriptor)}>Run</button></div>)}</div></section>;
}

function ActionSurface({ project, action, onExecution }: { project: ProjectSummary; action: WorkspaceAction; onExecution: SurfaceProps["onExecution"] }) {
  const [descriptor, setDescriptor] = useState<WorkspaceActionDescriptor | null>(null);
  useEffect(() => { void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`).then((data) => setDescriptor(data.actions.find((entry) => entry.id === action) || null)); }, [project.id, action]);
  if (!descriptor) return <p className="kw-message">Loading action eligibility…</p>;
  const run = async () => { if (!descriptor.enabled) return; onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source }); try { const data = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, jsonRequest({ action })); onExecution({ label: descriptor.label, command: descriptor.command, state: data.ok ? "PASS" : "FAILED", source: descriptor.source, output: data.output, message: data.message, exitCode: data.exitCode }); } catch (error) { onExecution({ label: descriptor.label, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Action failed." }); } };
  return (
    <KForgeServiceCard
      title={descriptor.label}
      subtitle={descriptor.command ? `Detected executable` : descriptor.source || "Project profile evidence"}
      status={String(descriptor.enabled ? (descriptor.state || "AVAILABLE") : "UNAVAILABLE")}
      command={String(descriptor.command || "No executable evidence detected")}
      lastRun={undefined}
      durationMs={undefined}
      available={descriptor.enabled}
      reason={descriptor.unavailableReason || (!descriptor.enabled ? descriptor.unavailableReason || "Not available for current project profile." : undefined)}
      disabled={!descriptor.enabled}
      onRun={descriptor.enabled ? () => void run() : undefined}
      onHealth={descriptor.enabled ? () => void onExecution?.({ label: descriptor.label + " Health", state: "RUNNING", source: descriptor.source }) : undefined}
      onConfigure={undefined}
    />
  );
}

function LintSurface({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [tool, setTool] = useState<RecordRow | null>(null); useEffect(() => { void fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`).then((data) => setTool(data.tools.find((entry) => entry.name === "lint") || null)); }, [project.id]); const enabled = ["AVAILABLE", "AVAILABLE_WITH_CONFIRMATION"].includes(String(tool?.status));
  const run = async () => { onExecution({ label: "Lint", state: "RUNNING", source: "Agent tool registry" }); try { const data = await fetchJson<{ ok: boolean; message: string; output: unknown }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools/lint`, jsonRequest({})); onExecution({ label: "Lint", state: data.ok ? "PASS" : "FAILED", source: "Agent tool registry", message: data.message, output: typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2) }); } catch (error) { onExecution({ label: "Lint", state: "FAILED", source: "Agent tool registry", message: error instanceof Error ? error.message : "Lint failed." }); } };
  return (
    <KForgeServiceCard
      title="Lint"
      subtitle={String(tool?.command || "No lint command detected")}
      status={String(tool ? (tool.status || "NOT_EVALUATED") : "NOT_EVALUATED")}
      command={String(tool?.command || "No executable evidence")}
      available={enabled}
      reason={!enabled ? (String(tool?.unavailableReason || "No lint script found in package.json")) : undefined}
      disabled={!enabled}
      onRun={enabled ? () => void run() : undefined}
    />
  );
}

function PreviewSurface({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<RecordRow | null>(null); const refresh = () => fetchJson<{ preview: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview`).then((result) => setData(result.preview)); useEffect(() => { void refresh(); }, [project.id]); const op = async (name: string) => { onExecution({ label: `Preview ${name}`, state: "RUNNING", source: "Shared Preview runtime" }); try { const result = await fetchJson<{ preview: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview/${name}`, { method: "POST" }); setData(result.preview); onExecution({ label: `Preview ${name}`, state: String(result.preview.state || "COMPLETED"), source: "Shared Preview runtime", output: String(result.preview.stdout || result.preview.output || "") }); } catch (error) { onExecution({ label: `Preview ${name}`, state: "FAILED", source: "Shared Preview runtime", message: error instanceof Error ? error.message : "Preview failed." }); } };
  return (
    <KForgeServiceCard
      title="KNOuX Forge Preview Engine"
      subtitle="Shared preview runtime. One engine. No second engine created."
      status={data ? String(data.state || "READY") : "NOT_EVALUATED"}
      command="Shared Preview runtime"
      available={true}
      disabled={false}
      onRun={() => void op("start")}
      onHealth={() => void op("health")}
      onConfigure={undefined}
    />
  );
}

export default DeveloperSurface;
