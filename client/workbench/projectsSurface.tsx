import { useEffect, useMemo, useState } from "react";
import type { SurfaceProps } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { ArrowRight, GitBranch, Hammer, Play, Search, TerminalSquare, TestTube2 } from "lucide-react";
import { EmptyState, StatusBadge } from "./ui";
import ServiceCatalogue from "./ServiceCatalogue";
import { ProjectStartActions } from "./ProjectStartActions";

type PersistedHealthSummary = { path: string; scannedAt: string; score: number | null; releaseState: string; source: string };
type HealthEvidenceResponse = { summaries: PersistedHealthSummary[] };

function formatTimestamp(value?: string) {
  if (!value) return "UNKNOWN";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function projectTypeLabel(value: string) {
  const parts = value.split("+").map((part) => part.replace(/_/g, " ").trim()).filter(Boolean);
  const label = (part: string) => part.charAt(0) + part.slice(1).toLowerCase();
  if (!parts.length) return value;
  return parts.length === 1 ? label(parts[0]) : `${label(parts[0])} +${parts.length - 1}`;
}

function quickActions(entry: ProjectSummary) {
  return [
    { label: "Preview", target: "Preview", icon: Play },
    { label: "Commands", target: "Project commands", icon: TerminalSquare },
    { label: "Tests", target: "Tests", icon: TestTube2 },
    { label: "Build", target: "Build", icon: Hammer },
    { label: "Git", target: "Git", icon: GitBranch },
  ];
}

/**
 * Quick-access cards remain a real projection of the same project evidence as the
 * engineering table. Actions open the canonical workbench that owns the capability;
 * nothing here starts a process by itself.
 */
function ProjectQuickAccess({ projects, activeProjectId, onProjectSelect, onNavigate }: {
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
  if (!ordered.length) return null;
  return <section className="kw-project-quick" aria-label="Project quick access">
    <div className="kw-project-quick__heading"><div><small>QUICK ACCESS</small><h2>Project actions</h2></div><span>Open a project and every capability below acts on that same verified local context.</span></div>
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
            {quickActions(entry).map((action) => <button key={action.target} title={`Open ${action.label} for ${entry.name}`} onClick={() => activate(entry, action.target)}><action.icon size={12} />{action.label}</button>)}
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function ProjectsSurface({ view, workspace, project, onProjectSelect, onRefresh }: SurfaceProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"activity" | "name" | "health">("activity");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
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

  const allProjects = useMemo(() => (workspace?.projects || []).filter((entry) => !entry.archived), [workspace]);
  const types = useMemo(() => [...new Set(allProjects.map((entry) => entry.projectType).filter(Boolean))].sort(), [allProjects]);
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = allProjects
      .filter((entry) => typeFilter === "all" || entry.projectType === typeFilter)
      .filter((entry) => statusFilter === "all" || (statusFilter === "trusted" ? entry.trust === "trusted" : entry.trust !== "trusted"))
      .filter((entry) => !normalized || `${entry.name} ${entry.path} ${entry.projectType} ${entry.branch} ${entry.tags.join(" ")}`.toLowerCase().includes(normalized));
    list.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "health" ? (healthEvidence[b.path]?.score ?? b.healthScore ?? -1) - (healthEvidence[a.path]?.score ?? a.healthScore ?? -1) : b.lastActivity.localeCompare(a.lastActivity));
    return list;
  }, [allProjects, healthEvidence, query, sort, statusFilter, typeFilter]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visibleRows = rows.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  if (view === "open-project") return <section className="kw-form-surface"><h2>Open Project</h2><p>Register an existing local directory without remote contact.</p><input aria-label="Local project path" value={pathInput} onChange={(event) => setPathInput(event.target.value)} /><button onClick={() => void fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/open", jsonRequest({ path: pathInput.trim() })).then(async (data) => { onProjectSelect(data.project.id); await onRefresh(); setMessage(`Opened ${data.project.name}.`); }).catch((error) => setMessage(error instanceof Error ? error.message : "Open project failed."))}>Open project</button>{message && <p>{message}</p>}</section>;
  if (view === "import-project") return <section className="kw-form-surface"><h2>Import Repository</h2><p>Clone is policy-controlled and always requires explicit confirmation.</p><input aria-label="Repository HTTPS URL" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} /><input aria-label="Destination folder" value={targetName} onChange={(event) => setTargetName(event.target.value)} /><button onClick={() => void (async () => { if (!window.confirm(`Clone ${remoteUrl}?`)) return; try { const data = await fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/clone", jsonRequest({ remoteUrl, targetName, confirmed: true })); onProjectSelect(data.project.id); await onRefresh(); setMessage(`Imported ${data.project.name}.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); } })()}>Clone with confirmation</button>{message && <p>{message}</p>}</section>;
  if (view !== "workspace") return <EmptyState title="Specialized Projects surface unavailable" detail={`${view} must be routed through its dedicated Projects Workbench. KForge does not fall back to a duplicate shared collection implementation.`} />;

  const openTool = (target: string) => window.dispatchEvent(new CustomEvent("kforge:navigate", { detail: { target } }));

  return <section className="kw-projects" aria-label="KForge Projects Workspace">
    {!project ? <section className="kw-project-center" aria-label="Project Center">
      <div className="kw-project-center__hero">
        <div className="kw-project-center__copy"><small>PROJECT CENTER</small><h2>Open a project and KForge surrounds it.</h2><p>Every status below comes from local project evidence. Actions open the real KForge workbench that owns the capability.</p></div>
        <div className="kw-project-center__actions">
          <ProjectStartActions compact />
          <button className="kw-project-center__import" onClick={() => openTool("Import Project")}>Import project<ArrowRight size={13} /></button>
        </div>
      </div>
    </section> : null}
    {project ? <ServiceCatalogue project={project} workspace={workspace} onNavigate={openTool} /> : null}
    <section className="kf-card kw-projects__table" aria-label="Local projects engineering table">
      <header className="kw-projects__table-heading">
        <div><small>LOCAL PROJECTS</small><h2>Engineering table</h2><span>Search, sort and inspect the same real project evidence.</span></div>
        <div className="kw-projects__table-count"><strong>{rows.length}</strong><span>project(s)</span></div>
      </header>
      <div className="kw-projects__table-body">
        <div className="kw-table-toolbar">
          <label><Search size={14} /><input aria-label="Search local projects" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search projects, paths, types, branches…" /></label>
          <select aria-label="Filter project type" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}><option value="all">All types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select>
          <select aria-label="Filter project trust" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="trusted">Trusted</option><option value="untrusted">Untrusted</option></select>
          <select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="activity">Last activity</option><option value="name">Project</option><option value="health">Health</option></select>
          <label className="kw-select-all"><input type="checkbox" aria-label="Select all filtered projects" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />Select all</label>
          <span>{rows.length} project(s)</span>
        </div>
        {selected.length > 0 && <div className="kw-bulk-bar"><strong>{selected.length} selected</strong><span>Workspace bulk selection is observational. Collection mutations live in their dedicated Workbench.</span><button onClick={() => setSelected([])}>Clear selection</button></div>}
        {rows.length ? <div className="kw-table-wrap" aria-label="Projects engineering table"><table className="kw-table" data-testid="project-table"><thead><tr><th>Bulk</th><th>Project</th><th>Type</th><th>Branch</th><th>Status</th><th>Health</th><th>Last activity</th><th>Actions</th></tr></thead><tbody>{visibleRows.map((entry) => { const persistedHealth = healthEvidence[entry.path]; return <tr key={entry.id} data-project-path={entry.path} data-project-id={entry.id} className={project?.id === entry.id ? "is-selected" : ""}><td><input type="checkbox" aria-label={`Select ${entry.name} for bulk actions`} checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, entry.id])] : current.filter((id) => id !== entry.id))} /></td><td><button className="kw-project-select" aria-label={`Select project ${entry.name}`} onClick={() => onProjectSelect(entry.id)}><strong>{entry.name}</strong><small>{entry.path}</small><small>{entry.modifiedFiles + entry.untrackedFiles} changed · {entry.ahead} ahead · {entry.behind} behind{entry.tags.length ? ` · ${entry.tags.join(" · ")}` : ""}</small></button></td><td><span className="kw-type-label" title={entry.projectType}>{projectTypeLabel(entry.projectType)}</span></td><td><code title={entry.branch || "NO_GIT"}>{entry.branch || "NO_GIT"}</code></td><td><StatusBadge value={entry.trust} /></td><td>{persistedHealth ? <span data-health-evidence-source={persistedHealth.source}><strong>{persistedHealth.score ?? "—"}</strong><small>{persistedHealth.releaseState} · persisted {new Date(persistedHealth.scannedAt).toLocaleDateString()}</small></span> : <span><strong>{entry.healthScore ?? "—"}</strong><small>{entry.healthScore === null ? "no persisted scan" : "project score"}</small></span>}</td><td>{formatTimestamp(entry.lastActivity)}</td><td><button className="kw-project-open" onClick={() => onProjectSelect(entry.id)}>Open<ArrowRight size={12} /></button></td></tr>; })}</tbody></table></div> : <EmptyState title="No projects found" detail="Open or import a project to populate this engineering table." />}
        <footer className="kw-projects__table-footer">
          <span>{selected.length ? `${selected.length} of ${rows.length} selected` : `${rows.length} local project(s) · page ${Math.min(page, pageCount)} of ${pageCount}`}</span>
          <div className="kw-projects__pager">
            <button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
            <span>{Math.min(page, pageCount)} / {pageCount}</span>
            <button aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>›</button>
            <span className="kw-projects__page-size">10 / page</span>
          </div>
        </footer>
      </div>
    </section>
    <ProjectQuickAccess projects={workspace?.projects || []} activeProjectId={project?.id} onProjectSelect={onProjectSelect} onNavigate={openTool} />
  </section>;
}

export default ProjectsSurface;
