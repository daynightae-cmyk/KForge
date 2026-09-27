import { useEffect, useMemo, useState } from "react";
import type { SurfaceProps } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { GitBranch, Hammer, Play, Search, TerminalSquare, TestTube2 } from "lucide-react";
import { EmptyState, StatusBadge } from "./ui";
import ProjectToolGrid from "./ProjectToolGrid";
import { ProjectStartActions } from "./ProjectStartActions";

type PersistedHealthSummary = { path: string; scannedAt: string; score: number | null; releaseState: string; source: string };
type HealthEvidenceResponse = { summaries: PersistedHealthSummary[] };

function ProjectCenterCards({ projects, activeProjectId, onProjectSelect, onNavigate }: {
  projects: ProjectSummary[];
  activeProjectId?: string;
  onProjectSelect: (id: string) => void;
  onNavigate: (target: string) => void;
}) {
  const ordered = [...projects].filter((entry) => !entry.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivity.localeCompare(a.lastActivity));
  const activate = (entry: ProjectSummary, target?: string) => {
    onProjectSelect(entry.id);
    if (target) onNavigate(target);
  };
  return <section className="kw-project-center" aria-label="Project Center">
    <header className="kw-project-center__hero">
      <div><small>PROJECT CENTER</small><h2>Open a project and KForge surrounds it.</h2><p>Every status below comes from local project evidence. Actions open the real KForge workbench that owns the capability.</p></div>
      <ProjectStartActions compact />
    </header>
    <div className="kw-project-card-grid">
      {ordered.slice(0, 8).map((entry) => {
        const changed = entry.modifiedFiles + entry.untrackedFiles;
        return <article key={entry.id} className={`kw-project-card ${activeProjectId === entry.id ? "is-active" : ""}`}>
          <header><div><strong>{entry.name}</strong><small title={entry.path}>{entry.path}</small></div><StatusBadge value={entry.trust} /></header>
          <div className="kw-project-card__meta"><StatusBadge value={entry.projectType || "UNKNOWN"} /><code>{entry.branch || "NO_GIT"}</code>{entry.pinned ? <span>PINNED</span> : null}</div>
          <div className="kw-project-card__evidence">
            <span><small>Git</small><strong>{changed ? `${changed} changed` : "CLEAN"}</strong><em>{entry.ahead} ahead · {entry.behind} behind</em></span>
            <span><small>Tests</small><strong>{String(entry.testStatus).toUpperCase()}</strong><em>local evidence</em></span>
            <span><small>Build</small><strong>{String(entry.buildStatus).toUpperCase()}</strong><em>local evidence</em></span>
            <span><small>Health</small><strong>{entry.healthScore ?? "NOT_SCANNED"}</strong><em>{entry.lastScan ? "persisted scan" : "no scan yet"}</em></span>
          </div>
          <div className="kw-project-card__actions">
            <button className="is-primary" onClick={() => activate(entry)}>Open</button>
            <button onClick={() => activate(entry, "Preview")}><Play size={12} />Preview</button>
            <button onClick={() => activate(entry, "Project commands")}><TerminalSquare size={12} />Commands</button>
            <button onClick={() => activate(entry, "Tests")}><TestTube2 size={12} />Tests</button>
            <button onClick={() => activate(entry, "Build")}><Hammer size={12} />Build</button>
            <button title="Open Git Center for fetch, pull, commit and push workflows" onClick={() => activate(entry, "Git")}><GitBranch size={12} />Git</button>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function ProjectsSurface({ view, workspace, project, onProjectSelect, onRefresh }: SurfaceProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"activity" | "name" | "health">("activity");
  const [selected, setSelected] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [message, setMessage] = useState("");
  const [healthEvidence, setHealthEvidence] = useState<Record<string, PersistedHealthSummary>>({});

  useEffect(() => {
    void fetchJson<HealthEvidenceResponse>("/api/workspace/projects/health-evidence")
      .then((response) => setHealthEvidence(Object.fromEntries(response.summaries.map((entry) => [entry.path, entry]))))
      .catch(() => setHealthEvidence({}));
  }, [workspace]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = (workspace?.projects || []).filter((entry) => !entry.archived).filter((entry) => !normalized || `${entry.name} ${entry.path} ${entry.projectType} ${entry.branch} ${entry.tags.join(" ")}`.toLowerCase().includes(normalized));
    list.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "health" ? (healthEvidence[b.path]?.score ?? b.healthScore ?? -1) - (healthEvidence[a.path]?.score ?? a.healthScore ?? -1) : b.lastActivity.localeCompare(a.lastActivity));
    return list;
  }, [healthEvidence, query, sort, workspace]);
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  if (view === "open-project") return <section className="kw-form-surface"><h2>Open Project</h2><p>Register an existing local directory without remote contact.</p><input aria-label="Local project path" value={pathInput} onChange={(event) => setPathInput(event.target.value)} /><button onClick={() => void fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/open", jsonRequest({ path: pathInput.trim() })).then(async (data) => { onProjectSelect(data.project.id); await onRefresh(); setMessage(`Opened ${data.project.name}.`); }).catch((error) => setMessage(error instanceof Error ? error.message : "Open project failed."))}>Open project</button>{message && <p>{message}</p>}</section>;
  if (view === "import-project") return <section className="kw-form-surface"><h2>Import Repository</h2><p>Clone is policy-controlled and always requires explicit confirmation.</p><input aria-label="Repository HTTPS URL" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} /><input aria-label="Destination folder" value={targetName} onChange={(event) => setTargetName(event.target.value)} /><button onClick={() => void (async () => { if (!window.confirm(`Clone ${remoteUrl}?`)) return; try { const data = await fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/clone", jsonRequest({ remoteUrl, targetName, confirmed: true })); onProjectSelect(data.project.id); await onRefresh(); setMessage(`Imported ${data.project.name}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); } })()}>Clone with confirmation</button>{message && <p>{message}</p>}</section>;
  if (view !== "workspace") return <EmptyState title="Specialized Projects surface unavailable" detail={`${view} must be routed through its dedicated Projects Workbench. KForge does not fall back to a duplicate shared collection implementation.`} />;

  const openTool = (target: string) => window.dispatchEvent(new CustomEvent("kforge:navigate", { detail: { target } }));

  return <section className="kw-projects" aria-label="KForge Projects Workspace">
    <ProjectCenterCards projects={workspace?.projects || []} activeProjectId={project?.id} onProjectSelect={onProjectSelect} onNavigate={openTool} />
    {project ? <ProjectToolGrid project={project} onNavigate={openTool} /> : null}
    <div className="kw-projects__table-heading"><div><small>ALL LOCAL PROJECTS</small><h2>Engineering table</h2></div><span>Search, sort and inspect the same real project evidence.</span></div>
    <div className="kw-table-toolbar"><label><Search size={14} /><input aria-label="Search local projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, paths, types, branches…" /></label><select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="activity">Last activity</option><option value="name">Project</option><option value="health">Health</option></select><label className="kw-select-all"><input type="checkbox" aria-label="Select all filtered projects" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />Select all</label><span>{rows.length} project(s)</span></div>
    {selected.length > 0 && <div className="kw-bulk-bar"><strong>{selected.length} selected</strong><span>Workspace bulk selection is observational. Collection mutations live in their dedicated Workbench.</span><button onClick={() => setSelected([])}>Clear selection</button></div>}
    {rows.length ? <div className="kw-table-wrap" aria-label="Projects engineering table"><table className="kw-table" data-testid="project-table"><thead><tr><th>Bulk</th><th>Project</th><th>Type</th><th>Branch</th><th>Trust</th><th>Collections</th><th>Git</th><th>Health</th><th>Last Activity</th></tr></thead><tbody>{rows.map((entry) => { const persistedHealth = healthEvidence[entry.path]; return <tr key={entry.id} data-project-path={entry.path} data-project-id={entry.id} className={project?.id === entry.id ? "is-selected" : ""}><td><input type="checkbox" aria-label={`Select ${entry.name} for bulk actions`} checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, entry.id])] : current.filter((id) => id !== entry.id))} /></td><td><button className="kw-project-select" aria-label={`Select project ${entry.name}`} onClick={() => onProjectSelect(entry.id)}><strong>{entry.name}</strong><small>{entry.path}</small>{entry.tags.length ? <small>{entry.tags.join(" · ")}</small> : null}</button></td><td>{entry.projectType}</td><td><code>{entry.branch}</code></td><td><StatusBadge value={entry.trust} /></td><td><span>{entry.favorite ? "Favorite" : "Standard"}</span><small>{entry.pinned ? "Pinned" : "Not pinned"}</small></td><td><span>{entry.modifiedFiles + entry.untrackedFiles} changed</span><small>{entry.ahead} ahead · {entry.behind} behind</small></td><td>{persistedHealth ? <span data-health-evidence-source={persistedHealth.source}><strong>{persistedHealth.score ?? "UNKNOWN"}</strong><small>{persistedHealth.releaseState} · persisted {persistedHealth.scannedAt}</small></span> : <span>{entry.healthScore ?? "NOT_SCANNED"}<small>No persisted health summary</small></span>}</td><td>{new Date(entry.lastActivity).toLocaleString()}</td></tr>; })}</tbody></table></div> : <EmptyState title="No projects found" detail="Open or import a project to populate this engineering table." />}
  </section>;
}

export default ProjectsSurface;
