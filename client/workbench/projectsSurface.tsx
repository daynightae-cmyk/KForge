import { useEffect, useMemo, useState } from "react";
import type { SurfaceProps } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { Search } from "lucide-react";
import { EmptyState, StatusBadge } from "./ui";

type PersistedHealthSummary = { path: string; scannedAt: string; score: number | null; releaseState: string; source: string };
type HealthEvidenceResponse = { summaries: PersistedHealthSummary[] };

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

  return <section className="kw-projects" aria-label="KForge Projects Workspace">
    <div className="kw-table-toolbar"><label><Search size={14} /><input aria-label="Search local projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, paths, types, branches…" /></label><select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="activity">Last activity</option><option value="name">Project</option><option value="health">Health</option></select><label className="kw-select-all"><input type="checkbox" aria-label="Select all filtered projects" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />Select all</label><span>{rows.length} project(s)</span></div>
    {selected.length > 0 && <div className="kw-bulk-bar"><strong>{selected.length} selected</strong><span>Workspace bulk selection is observational. Collection mutations live in their dedicated Workbench.</span><button onClick={() => setSelected([])}>Clear selection</button></div>}
    {rows.length ? <div className="kw-table-wrap" aria-label="Projects engineering table"><table className="kw-table" data-testid="project-table"><thead><tr><th>Bulk</th><th>Project</th><th>Type</th><th>Branch</th><th>Trust</th><th>Collections</th><th>Git</th><th>Health</th><th>Last Activity</th></tr></thead><tbody>{rows.map((entry) => { const persistedHealth = healthEvidence[entry.path]; return <tr key={entry.id} data-project-path={entry.path} data-project-id={entry.id} className={project?.id === entry.id ? "is-selected" : ""}><td><input type="checkbox" aria-label={`Select ${entry.name} for bulk actions`} checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, entry.id])] : current.filter((id) => id !== entry.id))} /></td><td><button className="kw-project-select" aria-label={`Select project ${entry.name}`} onClick={() => onProjectSelect(entry.id)}><strong>{entry.name}</strong><small>{entry.path}</small>{entry.tags.length ? <small>{entry.tags.join(" · ")}</small> : null}</button></td><td>{entry.projectType}</td><td><code>{entry.branch}</code></td><td><StatusBadge value={entry.trust} /></td><td><span>{entry.favorite ? "Favorite" : "Standard"}</span><small>{entry.pinned ? "Pinned" : "Not pinned"}</small></td><td><span>{entry.modifiedFiles + entry.untrackedFiles} changed</span><small>{entry.ahead} ahead · {entry.behind} behind</small></td><td>{persistedHealth ? <span data-health-evidence-source={persistedHealth.source}><strong>{persistedHealth.score ?? "UNKNOWN"}</strong><small>{persistedHealth.releaseState} · persisted {persistedHealth.scannedAt}</small></span> : <span>{entry.healthScore ?? "NOT_SCANNED"}<small>No persisted health summary</small></span>}</td><td>{new Date(entry.lastActivity).toLocaleString()}</td></tr>; })}</tbody></table></div> : <EmptyState title="No projects found" detail="Open or import a project to populate this engineering table." />}
  </section>;
}

export default ProjectsSurface;
