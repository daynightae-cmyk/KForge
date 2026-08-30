import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary, WorkspaceResponse } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

type CollectionView = "recent" | "favorites" | "pinned" | "archive";
type CollectionPatch = { favorite?: boolean; pinned?: boolean; archived?: boolean; tags?: string[] };
type CollectionResponse = { project: ProjectSummary; collection: { favorite: boolean; pinned: boolean; archived: boolean; tags: string[] } };
type PersistedHealthSummary = { path: string; scannedAt: string; score: number | null; releaseState: string; source: string };
type HealthEvidenceResponse = { summaries: PersistedHealthSummary[] };

const VIEW_COPY: Record<CollectionView, { title: string; detail: string }> = {
  recent: { title: "Recent Projects", detail: "Projects with persisted last-opened evidence. Recent membership is observational and changes only when a project is actually opened." },
  favorites: { title: "Favorites", detail: "Persisted local favorites. Favorite state is workspace metadata and never contacts a remote provider." },
  pinned: { title: "Pinned Projects", detail: "Persisted local pins for projects you want to keep prominent in KForge." },
  archive: { title: "Archive", detail: "Locally archived projects remain registered and can be restored without deleting source files." },
};

function matchesView(project: ProjectSummary, view: CollectionView) {
  if (view === "recent") return project.categories.recent && !project.archived;
  if (view === "favorites") return project.favorite && !project.archived;
  if (view === "pinned") return project.pinned && !project.archived;
  return project.archived;
}

function ProjectCollectionsWorkbench({ view, workspace, project, onProjectSelect, onRefresh }: {
  view: CollectionView;
  workspace?: WorkspaceResponse;
  project?: ProjectSummary;
  onProjectSelect: SurfaceProps["onProjectSelect"];
  onRefresh: SurfaceProps["onRefresh"];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"activity" | "name" | "health">("activity");
  const [selected, setSelected] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(project?.id || null);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [healthEvidence, setHealthEvidence] = useState<Record<string, PersistedHealthSummary>>({});

  useEffect(() => {
    void fetchJson<HealthEvidenceResponse>("/api/workspace/projects/health-evidence")
      .then((response) => setHealthEvidence(Object.fromEntries(response.summaries.map((entry) => [entry.path, entry]))))
      .catch(() => setHealthEvidence({}));
  }, [workspace]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const result = (workspace?.projects || []).filter((entry) => matchesView(entry, view)).filter((entry) => !normalized || `${entry.name} ${entry.path} ${entry.projectType} ${entry.branch} ${entry.tags.join(" ")}`.toLowerCase().includes(normalized));
    result.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "health" ? (healthEvidence[b.path]?.score ?? b.healthScore ?? -1) - (healthEvidence[a.path]?.score ?? a.healthScore ?? -1) : b.lastActivity.localeCompare(a.lastActivity));
    return result;
  }, [healthEvidence, query, sort, view, workspace]);

  const focused = (workspace?.projects || []).find((entry) => entry.id === focusedId) || rows[0] || null;
  const focusedHealth = focused ? healthEvidence[focused.path] : undefined;
  const allSelected = rows.length > 0 && rows.every((entry) => selected.includes(entry.id));

  const patchOne = async (entry: ProjectSummary, patch: CollectionPatch, success: string) => {
    const response = await fetchJson<CollectionResponse>(`/api/workspace/projects/${encodeURIComponent(entry.id)}/collection`, jsonRequest(patch));
    setMessage(`${response.project.name}: ${success}`);
  };

  const mutateOne = async (entry: ProjectSummary, patch: CollectionPatch, success: string, confirmMessage?: string) => {
    if (busy) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    try {
      await patchOne(entry, patch, success);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Collection update failed.");
    } finally {
      setBusy(false);
    }
  };

  const mutateSelected = async (patch: CollectionPatch, label: string, confirmMessage?: string) => {
    if (busy || !selected.length) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const targets = (workspace?.projects || []).filter((entry) => selected.includes(entry.id));
    setBusy(true);
    setMessage(`Applying ${label} to ${targets.length} selected project(s)…`);
    try {
      for (const entry of targets) await patchOne(entry, patch, label);
      setSelected([]);
      await onRefresh();
      setMessage(`${label} persisted for ${targets.length} project(s). No source files or remote services were touched.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk collection update failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveTags = async () => {
    if (!focused || busy) return;
    const tags = tagDraft.split(",").map((entry) => entry.trim()).filter(Boolean);
    await mutateOne(focused, { tags }, `tags saved (${tags.length})`);
  };

  return <section className="space-y-4" aria-label="KForge Project Collections Workbench" data-collection-view={view}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{VIEW_COPY[view].title}</h2><p className="mt-1 text-xs text-muted-foreground">{VIEW_COPY[view].detail}</p></div>
      <StatusBadge value="LOCAL_PERSISTED_METADATA" />
      <button onClick={() => void onRefresh()} disabled={busy}>Refresh workspace</button>
    </header>

    <section className="rounded-lg border bg-card p-3" aria-label="Project collection controls">
      <div className="flex flex-wrap items-center gap-2"><input className="min-w-52 flex-1" aria-label="Search project collection" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project, path, branch or tag…" /><select aria-label="Sort project collection" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="activity">Last activity</option><option value="name">Project name</option><option value="health">Persisted health score</option></select><label className="text-xs"><input type="checkbox" aria-label="Select all collection projects" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? rows.map((entry) => entry.id) : [])} /> Select all</label><span className="text-xs text-muted-foreground">{rows.length} project(s)</span></div>
      {selected.length ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs" aria-label="Collection bulk actions"><strong>{selected.length} selected</strong><button onClick={() => void mutateSelected({ favorite: true }, "Favorite")}>Favorite</button><button onClick={() => void mutateSelected({ pinned: true }, "Pin")}>Pin</button><button onClick={() => void mutateSelected({ archived: true }, "Archive", `Archive ${selected.length} selected project(s)? Source directories will not be deleted.`)}>Archive</button><button onClick={() => void mutateSelected({ archived: false }, "Restore")}>Restore</button><button onClick={() => setSelected([])}>Clear</button></div> : null}
    </section>

    {!rows.length ? <EmptyState title={`No ${VIEW_COPY[view].title.toLowerCase()}`} detail={view === "recent" ? "Open a local project to create real recent-project evidence." : "Use collection actions from Recent or another populated collection to persist this state."} /> : <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <div className="overflow-auto rounded-lg border bg-card" aria-label="Project collection table"><table className="kw-table"><thead><tr><th>Select</th><th>Project</th><th>State</th><th>Git</th><th>Health</th><th>Activity</th><th>Actions</th></tr></thead><tbody>{rows.map((entry) => { const persistedHealth = healthEvidence[entry.path]; return <tr key={entry.id} data-project-id={entry.id} data-project-path={entry.path} className={focused?.id === entry.id ? "is-selected" : ""}><td><input type="checkbox" aria-label={`Select ${entry.name} collection row`} checked={selected.includes(entry.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, entry.id])] : current.filter((id) => id !== entry.id))} /></td><td><button className="kw-project-select" aria-label={`Focus collection project ${entry.name}`} onClick={() => { setFocusedId(entry.id); setTagDraft(entry.tags.join(", ")); onProjectSelect(entry.id); }}><strong>{entry.name}</strong><small>{entry.path}</small>{entry.tags.length ? <small>{entry.tags.join(" · ")}</small> : null}</button></td><td><div className="flex flex-wrap gap-1"><StatusBadge value={entry.favorite ? "FAVORITE" : "STANDARD"} /><StatusBadge value={entry.pinned ? "PINNED" : "UNPINNED"} />{entry.archived ? <StatusBadge value="ARCHIVED" /> : null}</div></td><td><span>{entry.modifiedFiles + entry.untrackedFiles} changed</span><small>{entry.ahead} ahead · {entry.behind} behind</small></td><td>{persistedHealth ? <span data-health-evidence-source={persistedHealth.source}><strong>{persistedHealth.score ?? "UNKNOWN"}</strong><small>{persistedHealth.releaseState} · persisted {persistedHealth.scannedAt}</small></span> : <span>NOT_SCANNED<small>No persisted health summary</small></span>}</td><td>{new Date(entry.lastActivity).toLocaleString()}</td><td><div className="flex flex-wrap gap-1"><button disabled={busy} aria-label={`${entry.favorite ? "Remove favorite from" : "Favorite"} ${entry.name}`} onClick={() => void mutateOne(entry, { favorite: !entry.favorite }, entry.favorite ? "favorite removed" : "favorite saved")}>{entry.favorite ? "Unfavorite" : "Favorite"}</button><button disabled={busy} aria-label={`${entry.pinned ? "Unpin" : "Pin"} ${entry.name}`} onClick={() => void mutateOne(entry, { pinned: !entry.pinned }, entry.pinned ? "pin removed" : "pin saved")}>{entry.pinned ? "Unpin" : "Pin"}</button><button disabled={busy} aria-label={`${entry.archived ? "Restore" : "Archive"} ${entry.name}`} onClick={() => void mutateOne(entry, { archived: !entry.archived }, entry.archived ? "restored" : "archived", entry.archived ? undefined : `Archive ${entry.name}? Source files will remain untouched.`)}>{entry.archived ? "Restore" : "Archive"}</button></div></td></tr>; })}</tbody></table></div>

      <aside className="min-w-0 rounded-lg border bg-card p-4" aria-label="Collection project details">{focused ? <><div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">{focused.name}</h3><StatusBadge value={focused.trust} /></div><dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-muted-foreground">Path</dt><dd className="break-all"><code>{focused.path}</code></dd></div><div><dt className="text-muted-foreground">Last opened</dt><dd>{focused.lastOpenedAt || "NEVER"}</dd></div><div><dt className="text-muted-foreground">Last scanned metadata</dt><dd>{focused.lastScannedAt || "NEVER"}</dd></div><div><dt className="text-muted-foreground">Persisted health summary</dt><dd>{focusedHealth ? `${focusedHealth.score ?? "UNKNOWN"} · ${focusedHealth.releaseState}` : "NOT_SCANNED"}</dd></div><div><dt className="text-muted-foreground">Health evidence at</dt><dd>{focusedHealth?.scannedAt || "NEVER"}</dd></div><div><dt className="text-muted-foreground">Last task</dt><dd>{focused.lastTaskAt || "NEVER"}</dd></div><div><dt className="text-muted-foreground">Branch</dt><dd>{focused.branch}</dd></div></dl><label className="mt-4 block text-xs">Tags<input className="mt-1 w-full" aria-label="Project collection tags" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder={focused.tags.join(", ") || "frontend, release, client"} /></label><button className="mt-2" disabled={busy} onClick={() => void saveTags()}>Save local tags</button><p className="mt-3 text-[11px] text-muted-foreground">Collection mutations update only KForge local metadata. Health summaries are persisted scan evidence, not live state. Archive does not delete, move, modify, commit, push, or upload the project source.</p></> : <p className="text-xs text-muted-foreground">Select a project row to inspect collection metadata.</p>}</aside>
    </div>}

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default ProjectCollectionsWorkbench;
