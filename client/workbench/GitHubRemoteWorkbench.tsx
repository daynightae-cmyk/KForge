import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDot, ExternalLink, GitBranch, GitCommit, Github, GitPullRequest, PackageOpen, PlayCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import type { SurfaceProps } from "./surfaceContracts";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";
import { ProjectRequired } from "./ProjectStartActions";

type JsonRecord = Record<string, unknown>;

type GitHubSource = {
  label?: string;
  endpoint?: string | null;
  state?: string;
  reason?: string;
  fetchedAt?: string;
  pagination?: { page?: number; perPage?: number; boundedFirstPage?: boolean; detail?: string };
};

type GitHubTransparency = {
  execution?: string;
  network?: string;
  dataClasses?: string[];
  provider?: string;
  destination?: string;
  purpose?: string;
  confirmation?: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  reason?: string;
};

type GitHubRemoteData = {
  slug?: string;
  connection?: { state?: string; authenticated?: boolean; reason?: string };
  repository?: JsonRecord;
  branches?: JsonRecord[];
  commits?: JsonRecord[];
  issues?: JsonRecord[];
  pullRequests?: JsonRecord[];
  actions?: JsonRecord;
  checks?: {
    state?: string;
    commitSha?: string | null;
    reason?: string;
    checkRuns?: JsonRecord;
    status?: JsonRecord;
  };
  releases?: JsonRecord[];
  sources?: Record<string, GitHubSource>;
  rateLimit?: {
    state?: string;
    limit?: number;
    remaining?: number;
    reset?: number;
    resetInSeconds?: number;
    detail?: string;
    classification?: { limited?: boolean; kind?: string; detail?: string };
  };
  transparency?: GitHubTransparency;
  error?: string;
};

type Props = Pick<SurfaceProps, "view" | "project" | "onExecution">;

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
const linkClass = "inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline";

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((entry): entry is JsonRecord => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
}

function text(value: unknown, fallback = "UNKNOWN") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value) return "UNKNOWN";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function shortSha(value: unknown) {
  const sha = text(value, "");
  return sha ? sha.slice(0, 8) : "UNKNOWN";
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? value : "";
  } catch {
    return "";
  }
}

function ExternalLinkText({ href, children }: { href: string; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return <a className={linkClass} href={href} target="_blank" rel="noreferrer"><span className="min-w-0 truncate">{children}</span><ExternalLink size={12} className="shrink-0" /></a>;
}

function SourceGrid({ sources }: { sources?: Record<string, GitHubSource> }) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return <p className="text-xs text-muted-foreground">No remote source evidence is available.</p>;
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{entries.map(([id, source]) => <article key={id} className="rounded-md border bg-background/60 p-3">
    <div className="flex items-center justify-between gap-2"><strong className="text-xs">{source.label || id}</strong><StatusBadge value={source.state} /></div>
    <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">{source.reason || "No diagnostic reason was returned."}</p>
    {typeof source.pagination?.perPage === "number" && <p className="mt-1 text-[10px] text-muted-foreground">First-page bound: per_page={source.pagination.perPage}. Further pages need an explicit follow-up.</p>}
    {source.fetchedAt && <time className="mt-2 block text-[10px] text-muted-foreground" dateTime={source.fetchedAt}>{dateValue(source.fetchedAt)}</time>}
  </article>)}</div>;
}

function RepositoryOverview({ data }: { data: GitHubRemoteData }) {
  const repo = record(data.repository);
  const workflows = rows(record(data.actions).workflow_runs);
  const checkRuns = rows(record(data.checks?.checkRuns).check_runs);
  const combinedStatus = record(data.checks?.status);
  const latestRun = workflows[0] || {};
  const latestCheck = checkRuns[0] || {};
  const repoUrl = safeUrl(repo.html_url);

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4" aria-label="GitHub repository overview">
        <div className="flex flex-wrap items-start gap-3">
          <Github size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold"><ExternalLinkText href={repoUrl}>{text(repo.full_name, data.slug || "GitHub repository")}</ExternalLinkText></h2>
            <p className="mt-1 text-xs text-muted-foreground">{text(repo.description, "No repository description is published.")}</p>
          </div>
          <StatusBadge value={repo.private === true ? "PRIVATE" : text(repo.visibility, repo.private === false ? "PUBLIC" : "UNKNOWN")} />
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-muted-foreground">Default branch</dt><dd className="mt-1 font-mono">{text(repo.default_branch)}</dd></div>
          <div><dt className="text-muted-foreground">Open issues</dt><dd className="mt-1 font-semibold">{numberValue(repo.open_issues_count)}</dd></div>
          <div><dt className="text-muted-foreground">Forks</dt><dd className="mt-1 font-semibold">{numberValue(repo.forks_count)}</dd></div>
          <div><dt className="text-muted-foreground">Stars</dt><dd className="mt-1 font-semibold">{numberValue(repo.stargazers_count)}</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="GitHub evidence sources">
        <div className="mb-3 flex items-center gap-2"><ShieldCheck size={15} /><h2 className="text-sm font-semibold">Remote evidence sources</h2></div>
        <SourceGrid sources={data.sources} />
      </section>
    </div>

    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4" aria-label="GitHub checks and CI evidence">
        <div className="flex items-center gap-2"><PlayCircle size={15} /><h2 className="text-sm font-semibold">Checks & CI</h2><span className="ml-auto"><StatusBadge value={data.checks?.state} /></span></div>
        <div className="mt-3 space-y-3 text-xs">
          <div className="rounded-md bg-muted/50 p-3"><span className="text-muted-foreground">Local HEAD</span><code className="mt-1 block break-all">{text(data.checks?.commitSha)}</code></div>
          <div className="rounded-md bg-muted/50 p-3"><span className="text-muted-foreground">Combined commit status</span><div className="mt-1"><StatusBadge value={combinedStatus.state || data.checks?.state} /></div></div>
          <div className="rounded-md border p-3"><strong>Latest workflow</strong><p className="mt-1">{text(latestRun.name, "No workflow run returned")}</p><div className="mt-2 flex flex-wrap gap-2"><StatusBadge value={latestRun.conclusion || latestRun.status} /><code>{shortSha(latestRun.head_sha)}</code><span className="text-muted-foreground">Run #{text(latestRun.run_number, "?")}</span></div></div>
          <div className="rounded-md border p-3"><strong>Latest check run</strong><p className="mt-1">{text(latestCheck.name, "No check run returned")}</p><div className="mt-2"><StatusBadge value={latestCheck.conclusion || latestCheck.status} /></div></div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="GitHub network transparency">
        <div className="flex items-center gap-2"><ShieldCheck size={15} /><h2 className="text-sm font-semibold">Network transparency</h2><span className="ml-auto"><StatusBadge value={data.transparency?.result} /></span></div>
        <dl className="mt-3 space-y-2 text-xs">
          <div><dt className="text-muted-foreground">Provider</dt><dd>{text(data.transparency?.provider)}</dd></div>
          <div><dt className="text-muted-foreground">Destination</dt><dd className="break-all font-mono">{text(data.transparency?.destination)}</dd></div>
          <div><dt className="text-muted-foreground">Purpose</dt><dd>{text(data.transparency?.purpose)}</dd></div>
          <div><dt className="text-muted-foreground">Network</dt><dd><StatusBadge value={data.transparency?.network} /></dd></div>
          <div><dt className="text-muted-foreground">API quota</dt><dd>{data.rateLimit?.state === "AVAILABLE" ? `${text(data.rateLimit?.remaining)}/${text(data.rateLimit?.limit)} remaining${typeof data.rateLimit?.resetInSeconds === "number" ? ` · resets in ${data.rateLimit.resetInSeconds}s` : ""}` : text(data.rateLimit?.detail, "Rate-limit evidence unavailable.")}{data.rateLimit?.classification && (data.rateLimit.classification as { limited?: boolean }).limited === true && <span className="mt-1 block">{text((data.rateLimit.classification as { detail?: string }).detail, "Rate limit detected.")}</span>}</dd></div>
        </dl>
      </section>
    </div>
  </div>;
}

function PullRequestsView({ data }: { data: GitHubRemoteData }) {
  const pulls = rows(data.pullRequests);
  return <section className="rounded-lg border bg-card" aria-label="GitHub pull requests">
    <div className="flex items-center gap-2 border-b px-4 py-3"><GitPullRequest size={15} /><h2 className="text-sm font-semibold">Open pull requests</h2><span className="text-xs text-muted-foreground">{pulls.length}</span></div>
    {pulls.length ? <ol className="divide-y">{pulls.map((pull, index) => {
      const user = record(pull.user);
      const head = record(pull.head);
      const base = record(pull.base);
      return <li key={text(pull.id, String(index))} className="grid gap-2 px-4 py-3 lg:grid-cols-[80px_minmax(0,1fr)_220px] lg:items-center">
        <div className="flex items-center gap-2"><span className="font-mono text-xs">#{text(pull.number)}</span><StatusBadge value={pull.draft === true ? "DRAFT" : pull.state} /></div>
        <div className="min-w-0"><strong className="block truncate text-sm"><ExternalLinkText href={safeUrl(pull.html_url)}>{text(pull.title)}</ExternalLinkText></strong><p className="mt-1 truncate text-xs text-muted-foreground">{text(user.login, "unknown author")} · {text(head.ref)} → {text(base.ref)}</p></div>
        <time className="text-xs text-muted-foreground" dateTime={text(pull.updated_at, "")}>{dateValue(pull.updated_at)}</time>
      </li>;
    })}</ol> : <p className="p-5 text-sm text-muted-foreground">No open pull requests were returned by GitHub.</p>}
  </section>;
}

function IssuesView({ data }: { data: GitHubRemoteData }) {
  const issues = rows(data.issues).filter((issue) => !issue.pull_request);
  return <section className="rounded-lg border bg-card" aria-label="GitHub issues">
    <div className="flex items-center gap-2 border-b px-4 py-3"><CircleDot size={15} /><h2 className="text-sm font-semibold">Open issues</h2><span className="text-xs text-muted-foreground">{issues.length}</span></div>
    {issues.length ? <ol className="divide-y">{issues.map((issue, index) => {
      const user = record(issue.user);
      const labels = rows(issue.labels).map((label) => text(label.name, "")).filter(Boolean).slice(0, 4);
      return <li key={text(issue.id, String(index))} className="grid gap-2 px-4 py-3 lg:grid-cols-[80px_minmax(0,1fr)_220px] lg:items-center">
        <div className="flex items-center gap-2"><span className="font-mono text-xs">#{text(issue.number)}</span><StatusBadge value={issue.state} /></div>
        <div className="min-w-0"><strong className="block truncate text-sm"><ExternalLinkText href={safeUrl(issue.html_url)}>{text(issue.title)}</ExternalLinkText></strong><p className="mt-1 truncate text-xs text-muted-foreground">{text(user.login, "unknown author")}{labels.length ? ` · ${labels.join(" · ")}` : ""}</p></div>
        <time className="text-xs text-muted-foreground" dateTime={text(issue.updated_at, "")}>{dateValue(issue.updated_at)}</time>
      </li>;
    })}</ol> : <p className="p-5 text-sm text-muted-foreground">No open issues were returned by GitHub.</p>}
  </section>;
}

function ActionsView({ data }: { data: GitHubRemoteData }) {
  const workflows = rows(record(data.actions).workflow_runs);
  return <section className="rounded-lg border bg-card" aria-label="GitHub Actions runs">
    <div className="flex items-center gap-2 border-b px-4 py-3"><PlayCircle size={15} /><h2 className="text-sm font-semibold">Recent workflow runs</h2><span className="text-xs text-muted-foreground">{workflows.length}</span></div>
    {workflows.length ? <ol className="divide-y">{workflows.map((run, index) => <li key={text(run.id, String(index))} className="grid gap-2 px-4 py-3 lg:grid-cols-[110px_minmax(0,1fr)_170px_180px] lg:items-center">
      <div><span className="font-mono text-xs">Run #{text(run.run_number, "?")}</span><div className="mt-1"><StatusBadge value={run.conclusion || run.status} /></div></div>
      <div className="min-w-0"><strong className="block truncate text-sm"><ExternalLinkText href={safeUrl(run.html_url)}>{text(run.name, text(run.display_title, "Workflow"))}</ExternalLinkText></strong><p className="mt-1 truncate text-xs text-muted-foreground">{text(run.event)} · {text(run.head_branch)} · {shortSha(run.head_sha)}</p></div>
      <span className="text-xs text-muted-foreground">{text(run.actor && record(run.actor).login, "unknown actor")}</span>
      <time className="text-xs text-muted-foreground" dateTime={text(run.updated_at, "")}>{dateValue(run.updated_at)}</time>
    </li>)}</ol> : <p className="p-5 text-sm text-muted-foreground">No workflow runs were returned by GitHub.</p>}
  </section>;
}

function ReleasesView({ data }: { data: GitHubRemoteData }) {
  const releases = rows(data.releases);
  return <section className="rounded-lg border bg-card" aria-label="GitHub releases">
    <div className="flex items-center gap-2 border-b px-4 py-3"><PackageOpen size={15} /><h2 className="text-sm font-semibold">Releases</h2><span className="text-xs text-muted-foreground">{releases.length}</span></div>
    {releases.length ? <ol className="divide-y">{releases.map((release, index) => <li key={text(release.id, String(index))} className="grid gap-2 px-4 py-3 md:grid-cols-[150px_minmax(0,1fr)_220px] md:items-center">
      <div><code className="text-xs font-semibold">{text(release.tag_name)}</code><div className="mt-1 flex gap-1">{release.draft === true && <StatusBadge value="DRAFT" />}{release.prerelease === true && <StatusBadge value="PRERELEASE" />}{release.draft !== true && release.prerelease !== true && <StatusBadge value="PUBLISHED" />}</div></div>
      <strong className="min-w-0 truncate text-sm"><ExternalLinkText href={safeUrl(release.html_url)}>{text(release.name, text(release.tag_name))}</ExternalLinkText></strong>
      <time className="text-xs text-muted-foreground" dateTime={text(release.published_at, "")}>{dateValue(release.published_at)}</time>
    </li>)}</ol> : <p className="p-5 text-sm text-muted-foreground">No GitHub releases were returned.</p>}
  </section>;
}

function GitHubActionPanel({ view, project, data, onRefresh, onExecution }: { view: string; project: NonNullable<Props["project"]>; data: GitHubRemoteData; onRefresh: () => void; onExecution: Props["onExecution"] }) {
  const repository = record(data.repository);
  const sourceHead = typeof data.checks?.commitSha === "string" ? data.checks.commitSha : "";
  const [expectedHead, setExpectedHead] = useState(sourceHead);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [title, setTitle] = useState("");
  const [head, setHead] = useState(project.branch || "main");
  const [base, setBase] = useState(text(repository.default_branch, "main"));
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [tagName, setTagName] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [prerelease, setPrerelease] = useState(false);
  const [workflowId, setWorkflowId] = useState("");
  const [ref, setRef] = useState(project.branch || "main");
  const [inputs, setInputs] = useState("{}");
  const [runId, setRunId] = useState("");

  useEffect(() => { setExpectedHead(sourceHead); }, [sourceHead]);
  useEffect(() => { setBase(text(repository.default_branch, "main")); }, [repository.default_branch]);
  useEffect(() => { setHead(project.branch || "main"); setRef(project.branch || "main"); }, [project.branch]);

  if (view === "issues") return null;

  const submit = async (endpoint: string, payload: Record<string, unknown>, label: string, urlValue?: unknown) => {
    if (!confirmed || !expectedHead) return;
    setBusy(true);
    setMessage("");
    setResultUrl("");
    onExecution({ label, state: "RUNNING", source: "GitHub authorized action contract" });
    try {
      const response = await fetchEvidence(endpoint, jsonRequest({ ...payload, expectedHead, confirmed: true }));
      const payloadData = response.data as Record<string, unknown>;
      const error = typeof payloadData.error === "string" ? payloadData.error : "";
      if (!response.ok) {
        setMessage(error || `GitHub action returned ${response.status}. No success was inferred.`);
        onExecution({ label, state: "FAILED", source: "GitHub authorized action contract", message: error });
      } else {
        const pullUrl = record(payloadData.pullRequest).htmlUrl;
        const releaseUrl = record(payloadData.release).htmlUrl;
        const url = typeof urlValue === "string" ? urlValue : typeof pullUrl === "string" ? pullUrl : typeof releaseUrl === "string" ? releaseUrl : "";
        setResultUrl(url);
        setMessage(`Authorized action accepted: ${String(payloadData.state || "OK")}. Verification: ${String(record(payloadData.verification).state || "RECORDED")}.`);
        onExecution({ label, state: "PASS", source: "GitHub authorized action contract", message: String(payloadData.state || "OK") });
        setConfirmed(false);
        onRefresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub action request failed.");
      onExecution({ label, state: "FAILED", source: "GitHub authorized action contract", message: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const dispatchWorkflow = async () => {
    let parsed: unknown = {};
    try { parsed = inputs.trim() ? JSON.parse(inputs) : {}; } catch { setMessage("Workflow inputs must be a valid flat JSON object."); return; }
    await submit(`/api/workspace/projects/${encodeURIComponent(project.id)}/github/actions/${encodeURIComponent(workflowId)}/dispatches`, { ref, inputs: parsed }, `Dispatch workflow ${workflowId}`);
  };

  const rerun = async () => {
    await submit(`/api/workspace/projects/${encodeURIComponent(project.id)}/github/actions/runs/${encodeURIComponent(runId)}/rerun`, {}, `Rerun workflow run ${runId}`);
  };

  return <section className="rounded-lg border bg-card p-4" aria-label="Authorized GitHub action contracts">
    <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-semibold">Authorized GitHub actions</h2><StatusBadge value="EXPLICIT_CONFIRMATION_REQUIRED" /></div>
    <p className="mt-1 text-xs text-muted-foreground">These actions use the existing GitHub CLI transport. KForge derives the repository from the project origin remote, requires project trust and Online mode, binds the action to the reviewed local HEAD, and refuses stale plans. Reads above stay independent from these mutations.</p>
    <label className="mt-3 grid gap-1 text-xs"><span className="text-muted-foreground">Reviewed source SHA</span><input value={expectedHead} onChange={(event) => setExpectedHead(event.target.value)} placeholder="40-character local HEAD" className="font-mono" /></label>

    {view === "pull-requests" ? <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
      <label className="grid gap-1 sm:col-span-2"><span className="text-muted-foreground">Pull request title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={256} /></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Head branch</span><input value={head} onChange={(event) => setHead(event.target.value)} /></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Base branch</span><input value={base} onChange={(event) => setBase(event.target.value)} /></label>
      <label className="grid gap-1 sm:col-span-2"><span className="text-muted-foreground">Body</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /><span>Create as draft</span></label>
    </div> : null}

    {view === "releases" ? <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
      <label className="grid gap-1"><span className="text-muted-foreground">Tag name</span><input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="v1.2.3" /></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Release name</span><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} /></label>
      <label className="grid gap-1 sm:col-span-2"><span className="text-muted-foreground">Release notes body</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} /></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Target commitish (optional)</span><input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="main" /></label>
      <div className="flex items-center gap-3"><label className="flex items-center gap-2"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /><span>Draft</span></label><label className="flex items-center gap-2"><input type="checkbox" checked={prerelease} onChange={(event) => setPrerelease(event.target.checked)} /><span>Prerelease</span></label></div>
    </div> : null}

    {view === "actions" ? <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
      <label className="grid gap-1"><span className="text-muted-foreground">Workflow ID or filename</span><input value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} placeholder="kforge-verification.yml" /></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Ref</span><input value={ref} onChange={(event) => setRef(event.target.value)} /></label>
      <label className="grid gap-1 sm:col-span-2"><span className="text-muted-foreground">Inputs (flat JSON object)</span><textarea value={inputs} onChange={(event) => setInputs(event.target.value)} rows={2} className="font-mono" /></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Run ID to rerun</span><input value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="123456789" /></label>
    </div> : null}

    <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the exact repository, action, branch/tag, and source SHA. This performs a real remote GitHub mutation.</span></label>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {view === "pull-requests" ? <button className={buttonClass} disabled={!confirmed || !expectedHead || busy} onClick={() => void submit(`/api/workspace/projects/${encodeURIComponent(project.id)}/github/pull-requests`, { title, head, base, body, draft }, "Create authorized pull request")}>Create pull request</button> : null}
      {view === "releases" ? <button className={buttonClass} disabled={!confirmed || !expectedHead || busy} onClick={() => void submit(`/api/workspace/projects/${encodeURIComponent(project.id)}/github/releases`, { tagName, name: releaseName, body, draft, prerelease, targetCommitish: ref || undefined }, "Create authorized GitHub release", undefined)}>Create release</button> : null}
      {view === "actions" ? <button className={buttonClass} disabled={!confirmed || !expectedHead || !workflowId || busy} onClick={() => void dispatchWorkflow()}>Dispatch workflow</button> : null}
      {view === "actions" ? <button className={buttonClass} disabled={!confirmed || !expectedHead || !runId || busy} onClick={() => void rerun()}>Rerun selected run</button> : null}
      <span className="text-xs text-muted-foreground">{busy ? "Contacting GitHub with the confirmed action…" : "No request is sent until this button is pressed."}</span>
    </div>
    {message ? <p className="kw-message mt-3" role="status">{message}</p> : null}
    {resultUrl ? <p className="mt-2 text-xs"><a className={linkClass} href={safeUrl(resultUrl)} target="_blank" rel="noreferrer">Open the verified GitHub result<ExternalLink size={12} /></a></p> : null}
  </section>;
}

export default function GitHubRemoteWorkbench({ view, project, onExecution }: Props) {
  const [data, setData] = useState<GitHubRemoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const endpoint = project ? `/api/workspace/projects/${encodeURIComponent(project.id)}/github` : "";

  const load = useCallback(async (explicit = false) => {
    if (!endpoint) return null;
    if (explicit) {
      setRefreshing(true);
      onExecution({ label: "Refresh GitHub remote evidence", state: "RUNNING", source: "GitHub read-only adapter" });
    }
    try {
      const next = await fetchJson<GitHubRemoteData>(endpoint);
      setData(next);
      setNotice(next.error || "");
      if (explicit) onExecution({ label: "Refresh GitHub remote evidence", state: next.connection?.state === "AVAILABLE" ? "PASS" : "UNAVAILABLE", source: "GitHub read-only adapter", message: next.connection?.reason || next.error });
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub remote evidence unavailable.";
      setNotice(message);
      setData(null);
      if (explicit) onExecution({ label: "Refresh GitHub remote evidence", state: "FAILED", source: "GitHub read-only adapter", message });
      return null;
    } finally {
      if (explicit) setRefreshing(false);
    }
  }, [endpoint, onExecution]);

  useEffect(() => {
    setLoading(true);
    setNotice("");
    void load(false).finally(() => setLoading(false));
  }, [load, project?.id]);

  const counts = useMemo(() => ({
    branches: rows(data?.branches).length,
    commits: rows(data?.commits).length,
    pulls: rows(data?.pullRequests).length,
    issues: rows(data?.issues).filter((issue) => !issue.pull_request).length,
    runs: rows(record(data?.actions).workflow_runs).length,
    releases: rows(data?.releases).length,
  }), [data]);

  if (!project) return <ProjectRequired detail="GitHub evidence requires project context." />;
  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Contacting the configured GitHub read-only adapter…</div>;
  if (!data) return <EmptyState title="GitHub evidence unavailable" detail={notice || "KForge could not retrieve remote GitHub metadata."} action={<button className={buttonClass} onClick={() => void load(true)}>Retry GitHub read</button>} />;

  return <section className="space-y-4" aria-label="KForge GitHub Remote Workbench">
    <header className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <Github size={16} />
      <div className="mr-auto min-w-0"><strong className="block truncate text-sm">{data.slug || project.name}</strong><p className="mt-1 text-xs text-muted-foreground">Authenticated GitHub read evidence plus separate, explicitly confirmed action contracts. Reads never trigger a mutation.</p></div>
      <StatusBadge value={data.connection?.state} />
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{counts.pulls} PR</span>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{counts.issues} issues</span>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{counts.runs} runs</span>
      <button className={buttonClass} onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Refresh remote</button>
    </header>

    {notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" role="alert">{notice}</div>}

    {view === "github" && <RepositoryOverview data={data} />}
    {view === "pull-requests" && <PullRequestsView data={data} />}
    {view === "issues" && <IssuesView data={data} />}
    {view === "actions" && <ActionsView data={data} />}
    {view === "releases" && <ReleasesView data={data} />}
    {["pull-requests", "releases", "actions"].includes(view) ? <GitHubActionPanel view={view} project={project} data={data} onRefresh={() => void load(true)} onExecution={onExecution} /> : null}

    <details className="rounded-lg border bg-card px-4 py-3"><summary className="cursor-pointer text-xs font-medium">Advanced · GitHub raw evidence</summary><div className="mt-3"><AdvancedEvidence value={data} label="Raw remote evidence" /></div></details>
  </section>;
}
