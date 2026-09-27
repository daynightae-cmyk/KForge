import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, BrainCircuit, Bug, GitBranch, Play, ShieldCheck, TerminalSquare, TestTube2, Wrench } from "lucide-react";
import type { ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import type { RecordRow } from "./surfaceContracts";
import { fetchJson } from "./api";
import { StatusBadge } from "./ui";

type Props = { project: ProjectSummary; onNavigate: (target: string) => void };
type PreviewResponse = { preview?: RecordRow };
type ActionResponse = { actions: WorkspaceActionDescriptor[] };

type ToolCard = {
  label: string;
  target: string;
  state: string;
  detail: string;
  icon: ReactNode;
};

function actionState(actions: WorkspaceActionDescriptor[], id: string) {
  const action = actions.find((entry) => entry.id === id);
  if (!action) return { state: "UNAVAILABLE", detail: "No registered project action." };
  return { state: action.state, detail: action.command || action.unavailableReason || action.source };
}
export default function ProjectToolGrid({ project, onNavigate }: Props) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = `/api/workspace/projects/${encodeURIComponent(project.id)}`;
    void Promise.all([
      fetchJson<ActionResponse>(`${base}/actions`).catch(() => ({ actions: [] })),
      fetchJson<PreviewResponse>(`${base}/preview`).catch(() => null),
    ]).then(([actionData, previewData]) => {
      if (cancelled) return;
      setActions(actionData.actions);
      setPreview(previewData);
    });
    return () => { cancelled = true; };
  }, [project.id]);

  const groups = useMemo(() => {
    const tests = actionState(actions, "test");
    const build = actionState(actions, "build");
    const runtime = actionState(actions, "runtime");
    const previewState = String(preview?.preview?.state || "IDLE").toUpperCase();
    const changed = project.modifiedFiles + project.untrackedFiles;
    const health = project.healthScore == null ? "NOT_SCANNED" : `HEALTH_${project.healthScore}`;
    return [
      { name: "DEVELOPMENT", cards: [
        { label: "Project Commands", target: "Project commands", state: actions.some((entry) => entry.enabled) ? "AVAILABLE" : "BLOCKED", detail: `${actions.filter((entry) => entry.enabled).length}/${actions.length} registered actions available`, icon: <TerminalSquare size={16} /> },
        { label: "Tests", target: "Tests", ...tests, icon: <TestTube2 size={16} /> },
        { label: "Build", target: "Build", ...build, icon: <Wrench size={16} /> },
        { label: "Runtime", target: "Runtime", ...runtime, icon: <Play size={16} /> },
        { label: "Preview", target: "Preview", state: previewState, detail: "KForge-owned local Preview runtime", icon: <Play size={16} /> },
      ] satisfies ToolCard[] },
      { name: "INTELLIGENCE", cards: [
        { label: "Project Graph", target: "Project graph", state: "ON_DEMAND", detail: "Bounded local static analysis runs when opened.", icon: <BrainCircuit size={16} /> },
        { label: "Dependencies", target: "Dependencies", state: "ON_DEMAND", detail: "Derived from detected local manifests and project graph.", icon: <BrainCircuit size={16} /> },
        { label: "Architecture", target: "Architecture", state: "ON_DEMAND", detail: "Static project architecture evidence, never invented runtime truth.", icon: <BrainCircuit size={16} /> },
      ] satisfies ToolCard[] },
      { name: "QUALITY", cards: [
        { label: "KForge Sonar", target: "KForge Sonar", state: health, detail: project.healthScore == null ? "No persisted scan result." : "Persisted project health evidence.", icon: <ShieldCheck size={16} /> },
        { label: "Problems", target: "Problems", state: health, detail: "Opening Problems runs the explicit bounded diagnostic scan.", icon: <Bug size={16} /> },
      ] satisfies ToolCard[] },
      { name: "AI", cards: [
        { label: "Providers", target: "Providers", state: "OPEN", detail: "Provider connectivity is evaluated only inside Provider Studio.", icon: <Bot size={16} /> },
        { label: "Agents", target: "Agents", state: project.trust === "trusted" ? "CONTEXT_READY" : "BLOCKED", detail: project.trust === "trusted" ? "Selected project context is available to the agent workflow." : "Execution requires explicit project trust.", icon: <Bot size={16} /> },
        { label: "Tasks", target: "Tasks", state: "OPEN", detail: "Persistent task lifecycle and evidence.", icon: <Bot size={16} /> },
      ] satisfies ToolCard[] },
      { name: "DELIVERY", cards: [
        { label: "Git", target: "Git", state: project.branch === "—" ? "NOT_CONFIGURED" : changed ? "CHANGES" : "CLEAN", detail: `${project.branch} · ${changed} change(s) · ${project.ahead} ahead · ${project.behind} behind`, icon: <GitBranch size={16} /> },
        { label: "GitHub", target: "GitHub", state: project.provider === "GitHub" ? "AVAILABLE" : "NOT_CONFIGURED", detail: project.provider === "GitHub" ? "Remote evidence is loaded only when opened." : "No GitHub remote detected.", icon: <GitBranch size={16} /> },
        { label: "Release Gate", target: "Release Gate", state: "ON_DEMAND", detail: "Independent local, desktop, package, installer, CI and remote evidence.", icon: <ShieldCheck size={16} /> },
      ] satisfies ToolCard[] },
    ];
  }, [actions, preview, project]);
  return <section className="kw-tool-grid" aria-label="Active project tool grid">
    <div className="kw-tool-grid__heading">
      <div><small>ACTIVE PROJECT</small><h2>{project.name}</h2></div>
      <div><StatusBadge value={project.trust} /><code>{project.branch}</code></div>
    </div>
    {groups.map((group) => <section key={group.name} className="kw-tool-grid__group">
      <h3>{group.name}</h3>
      <div className="kw-tool-grid__cards">
        {group.cards.map((card) => <button key={card.label} className="kw-tool-card" onClick={() => onNavigate(card.target)}>
          <span className="kw-tool-card__icon">{card.icon}</span>
          <span className="kw-tool-card__body"><strong>{card.label}</strong><small>{card.detail}</small></span>
          <StatusBadge value={card.state} />
        </button>)}
      </div>
    </section>)}
  </section>;
}
