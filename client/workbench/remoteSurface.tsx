import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCode2, GitBranch, GitCommit, RefreshCw, ShieldCheck, Tag, Archive, Plus, Minus } from "lucide-react";
import type { SurfaceProps } from "./surfaceContracts";
import { EmptyState, StatusBadge } from "./ui";
import GitHubRemoteWorkbench from "./GitHubRemoteWorkbench";
import { fetchJson, jsonRequest } from "./api";
import { ProjectRequired } from "./ProjectStartActions";

type GitFileChange = {
  file: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

type GitCommitRow = {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
};

type GitCenterData = {
  projectId: string;
  branch: string;
  remoteUrl?: string;
  status: string;
  changes: GitFileChange[];
  diffStat: string;
  stagedDiffStat: string;
  branches: string[];
  commits: GitCommitRow[];
  stashes: string[];
  tags: string[];
};

type GitMutationResponse = {
  ok: boolean;
  action: string;
  output?: string;
  message?: string;
  remotePush?: string;
};

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
const primaryButtonClass = `${buttonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;

function RemoteSurface({ view, project, onExecution, onRefresh }: SurfaceProps) {
  if (!project) return <ProjectRequired detail="Git and GitHub evidence requires project context." />;
  if (["git", "branches", "commits"].includes(view)) return <GitWorkbench view={view} project={project} onExecution={onExecution} onRefresh={onRefresh} />;
  if (["github", "pull-requests", "issues", "actions", "releases"].includes(view)) return <GitHubRemoteWorkbench view={view} project={project} onExecution={onExecution} />;
  return <EmptyState title="Unknown Remote / Git view" detail={`No verified Remote / Git surface is registered for '${view}'.`} />;
}

function GitWorkbench({ view, project, onExecution, onRefresh }: Pick<SurfaceProps, "view" | "project" | "onExecution" | "onRefresh">) {
  const [data, setData] = useState<GitCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const endpoint = `/api/workspace/projects/${encodeURIComponent(project!.id)}/git`;
  const trusted = project?.trust === "trusted";

  const load = useCallback(async () => {
    const next = await fetchJson<GitCenterData>(endpoint);
    setData(next);
    setSelected((current) => current.filter((file) => next.changes.some((change) => change.file === file)));
    return next;
  }, [endpoint]);

  useEffect(() => {
    setLoading(true);
    setNotice("");
    setSelected([]);
    setCommitMessage("");
    void load().catch((error) => setNotice(error instanceof Error ? error.message : "Git evidence unavailable.")).finally(() => setLoading(false));
  }, [load, project?.id]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const stageable = (data?.changes || []).filter((change) => selectedSet.has(change.file) && (change.unstaged || change.untracked)).map((change) => change.file);
  const unstageable = (data?.changes || []).filter((change) => selectedSet.has(change.file) && change.staged).map((change) => change.file);
  const stagedCount = (data?.changes || []).filter((change) => change.staged).length;
  const workingCount = (data?.changes || []).filter((change) => change.unstaged || change.untracked).length;

  const toggle = (file: string) => setSelected((current) => current.includes(file) ? current.filter((entry) => entry !== file) : [...current, file]);

  const mutate = async (action: "stage" | "unstage" | "commit") => {
    if (!trusted) {
      setNotice("Project trust is required before local Git mutations.");
      return;
    }
    const files = action === "stage" ? stageable : unstageable;
    if (action !== "commit" && !files.length) return;
    if (action === "commit" && !commitMessage.trim()) {
      setNotice("Enter a commit message before creating a local commit.");
      return;
    }
    const label = action === "commit" ? "Commit staged changes" : `${action === "stage" ? "Stage" : "Unstage"} ${files.length} selected file${files.length === 1 ? "" : "s"}`;
    if (!window.confirm(`${label}? KForge will modify only the selected local repository and will not push to a remote.`)) return;
    setBusy(action);
    setNotice("");
    onExecution({ label, state: "RUNNING", source: "Local Git repository" });
    try {
      const result = await fetchJson<GitMutationResponse>(`${endpoint}/${action}`, jsonRequest(action === "commit" ? { message: commitMessage.trim(), confirmed: true } : { files, confirmed: true }));
      await load();
      if (action === "commit") setCommitMessage("");
      setSelected([]);
      await onRefresh();
      onExecution({ label, state: result.ok ? "PASS" : "FAILED", source: "Local Git repository", output: result.output, message: action === "commit" ? `Local commit created. Remote push: ${result.remotePush || "NOT_PERFORMED"}.` : result.message || result.output });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Git operation failed.";
      setNotice(message);
      onExecution({ label, state: "FAILED", source: "Local Git repository", message });
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading canonical local Git evidence…</div>;
  if (!data) return <EmptyState title="Git evidence unavailable" detail={notice || "KForge could not read the selected repository."} />;

  return (
    <section className="kf-stack" aria-label="KForge Git Workbench">
      <section className="kf-stat-grid kw-git-stats" aria-label="Git repository summary">
        <article className="kf-stat"><span className="kf-tile"><GitBranch size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Current branch</span><strong className="kf-stat__value" style={{ fontSize: 17 }}>{data.branch || "detached"}</strong><span className="kf-stat__foot"><StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} /> · local repository</span></div></article>
        <article className="kf-stat"><span className="kf-tile kf-tile--blue"><Archive size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Remote</span><strong className="kf-stat__value" style={{ fontSize: 15 }}>{data.remoteUrl ? "origin" : "No remote"}</strong><span className="kf-stat__foot" title={data.remoteUrl || "No remote configured"}>{data.remoteUrl || "No remote configured · local Git operations only"}</span></div></article>
        <article className="kf-stat"><span className="kf-tile kf-tile--amber"><FileCode2 size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Working tree</span><strong className="kf-stat__value">{data.changes.length}<small> changes</small></strong><span className="kf-stat__foot">{stagedCount} staged · {workingCount} working</span></div></article>
        <article className="kf-stat"><span className="kf-tile kf-tile--green"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Repository status</span><strong className="kf-stat__value" style={{ fontSize: 17 }}>{data.changes.length ? "Changes pending" : "Clean"}</strong><span className="kf-stat__foot">{project?.ahead ?? 0} ahead · {project?.behind ?? 0} behind</span></div></article>
      </section>

      <div className="kw-git-toolbar">
        <span>Mutations are restricted to the selected local repository and always require trust plus confirmation.</span>
        <button className="kf-btn" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw size={13} />Refresh evidence</button>
      </div>

      {notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="alert">{notice}</div>}

      {view === "git" && <>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="kf-card kw-git-card" aria-label="Working tree changes">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3"><FileCode2 size={15} /><h2 className="text-sm font-semibold">Working tree</h2><span className="text-xs text-muted-foreground">{data.changes.length} change{data.changes.length === 1 ? "" : "s"}</span><div className="ml-auto flex gap-2"><button className={buttonClass} disabled={!trusted || !stageable.length || Boolean(busy)} onClick={() => void mutate("stage")}><Plus size={13} />Stage selected</button><button className={buttonClass} disabled={!trusted || !unstageable.length || Boolean(busy)} onClick={() => void mutate("unstage")}><Minus size={13} />Unstage selected</button></div></div>
            {data.changes.length ? <div className="divide-y">
              {data.changes.map((change) => <label key={change.file} className="grid cursor-pointer grid-cols-[24px_72px_minmax(0,1fr)_110px] items-center gap-2 px-4 py-2 text-xs hover:bg-muted/40" data-git-file={change.file}>
                <input type="checkbox" aria-label={`Select ${change.file}`} checked={selectedSet.has(change.file)} onChange={() => toggle(change.file)} />
                <span className="font-mono text-[11px] text-muted-foreground">{change.indexStatus || "·"}{change.worktreeStatus || "·"}</span>
                <span className="min-w-0 truncate font-mono" title={change.file}>{change.file}</span>
                <span className="justify-self-end"><StatusBadge value={change.staged && change.unstaged ? "PARTIAL" : change.staged ? "STAGED" : change.untracked ? "UNTRACKED" : "MODIFIED"} /></span>
              </label>)}
            </div> : <p className="p-5 text-sm text-muted-foreground">Working tree is clean.</p>}
          </section>

          <aside className="kf-card kw-git-commit" aria-label="Local commit composer">
            <div className="flex items-center gap-2 border-b px-4 py-3"><GitCommit size={15} /><h2 className="text-sm font-semibold">Commit staged changes</h2></div>
            <div className="kw-git-commit__body">
              <p className="text-xs text-muted-foreground">Creates a local commit only. KForge never pushes from this action.</p>
              <textarea aria-label="Git commit message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} rows={4} className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="feat(scope): describe the verified change" />
              <button className={`${primaryButtonClass} w-full`} disabled={!trusted || stagedCount === 0 || !commitMessage.trim() || Boolean(busy)} onClick={() => void mutate("commit")}><GitCommit size={13} />Commit staged</button>
              {!trusted && <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"><ShieldCheck size={13} className="mt-0.5 shrink-0" />Trust the selected project before staging, unstaging, or committing.</p>}
              <div className="rounded-md bg-muted/50 p-2"><strong className="text-[11px] uppercase tracking-wide">Staged diff</strong><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{data.stagedDiffStat || "No staged diff."}</pre></div>
            </div>
          </aside>
        </div>
        <details className="rounded-lg border bg-card px-4 py-3"><summary className="cursor-pointer text-xs font-medium">Raw Git status evidence</summary><pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{data.status || "No status output."}</pre></details>

        <div className="kw-git-lower">
          <section className="kf-card" aria-label="Recent commits">
            <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile"><GitCommit size={17} /></span><div><h2>Recent commits</h2><p>Latest local repository history.</p></div></div><span className="kf-chip">{data.commits.length} commits</span></header>
            {data.commits.length ? <div className="kf-list">{data.commits.slice(0, 5).map((commit) => <div className="kf-row" key={commit.sha}><span className="kw-git-avatar" aria-hidden="true">K</span><div className="kf-row__main"><strong>{commit.subject}</strong><small><code>{commit.shortSha}</code> · {commit.committedAt ? new Date(commit.committedAt).toLocaleString() : "UNKNOWN"}</small></div></div>)}</div> : <p className="kf-card__body text-xs text-muted-foreground">No commit history is available.</p>}
          </section>
          <section className="kf-card" aria-label="Branches">
            <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile kf-tile--blue"><GitBranch size={17} /></span><div><h2>Branches</h2><p>Local references in this repository.</p></div></div><span className="kf-chip">{data.branches.length}</span></header>
            {data.branches.length ? <div className="kf-list">{data.branches.slice(0, 6).map((branch) => <div className="kf-row" key={branch}><span className="kw-git-branch-icon" aria-hidden="true"><GitBranch size={13} /></span><div className="kf-row__main"><strong>{branch}</strong><small>{branch === data.branch ? "current branch" : "local branch"}</small></div>{branch === data.branch ? <StatusBadge value="CURRENT" /> : null}</div>)}</div> : <p className="kf-card__body text-xs text-muted-foreground">No local branch evidence.</p>}
          </section>
        </div>
      </>}

      {view === "branches" && <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card" aria-label="Local branches"><div className="flex items-center gap-2 border-b px-4 py-3"><GitBranch size={15} /><h2 className="text-sm font-semibold">Local branches</h2><span className="text-xs text-muted-foreground">{data.branches.length}</span></div><div className="divide-y">{data.branches.map((branch) => <div key={branch} className="flex items-center gap-2 px-4 py-2 text-sm"><GitBranch size={13} /><span className="min-w-0 flex-1 truncate font-mono">{branch}</span>{branch === data.branch && <StatusBadge value="CURRENT" />}</div>)}</div></section>
        <div className="space-y-4"><section className="rounded-lg border bg-card p-4" aria-label="Git tags"><div className="mb-3 flex items-center gap-2"><Tag size={15} /><h2 className="text-sm font-semibold">Tags</h2></div>{data.tags.length ? <div className="flex flex-wrap gap-2">{data.tags.slice(0, 50).map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-1 font-mono text-[11px]">{tag}</span>)}</div> : <p className="text-xs text-muted-foreground">No local tags.</p>}</section><section className="rounded-lg border bg-card p-4" aria-label="Git stashes"><div className="mb-3 flex items-center gap-2"><Archive size={15} /><h2 className="text-sm font-semibold">Stashes</h2></div>{data.stashes.length ? <ul className="space-y-2 text-xs">{data.stashes.map((stash) => <li key={stash} className="rounded-md bg-muted/50 p-2 font-mono">{stash}</li>)}</ul> : <p className="text-xs text-muted-foreground">No local stashes.</p>}</section></div>
      </div>}

      {view === "commits" && <section className="rounded-lg border bg-card" aria-label="Local commit history"><div className="flex items-center gap-2 border-b px-4 py-3"><GitCommit size={15} /><h2 className="text-sm font-semibold">Recent commits</h2><span className="text-xs text-muted-foreground">Local repository evidence</span></div>{data.commits.length ? <ol className="divide-y">{data.commits.map((commit) => <li key={commit.sha} className="grid gap-1 px-4 py-3 sm:grid-cols-[90px_minmax(0,1fr)_180px] sm:items-center"><code className="text-xs font-semibold">{commit.shortSha}</code><span className="min-w-0 truncate text-sm" title={commit.subject}>{commit.subject}</span><time className="text-xs text-muted-foreground" dateTime={commit.committedAt}>{commit.committedAt ? new Date(commit.committedAt).toLocaleString() : "UNKNOWN"}</time></li>)}</ol> : <p className="p-5 text-sm text-muted-foreground">No commit history is available.</p>}</section>}
    </section>
  );
}

export default RemoteSurface;
