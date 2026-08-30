import { useEffect, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type ReleaseDistributionView = "release-preparation" | "artifacts" | "versioning";

type ReleaseCommit = {
  shortSha: string;
  subject: string;
  committedAt: string;
};

type LocalReleaseEvidence = {
  state: string;
  source: string;
  timestamp: string | null;
  freshness: string;
  evidence: string[];
  reason?: string;
};

type ReleasePreparation = {
  generatedAt: string;
  baselineTag: string | null;
  version: string | null;
  commits: ReleaseCommit[];
  artifacts: string[];
  localEvidence: Record<string, LocalReleaseEvidence>;
  notes: string;
  notice: string;
};

const evidenceKinds = ["DESKTOP", "WINDOWS_PACKAGE", "INSTALLER"] as const;

function EvidenceCard({ kind, evidence }: { kind: string; evidence?: LocalReleaseEvidence }) {
  if (!evidence) {
    return <article className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto">{kind}</strong><StatusBadge value="NOT_RECORDED" /></div><p className="mt-2 text-muted-foreground">No local verification record was returned for this evidence domain.</p></article>;
  }
  return <article className="rounded-md border p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto">{kind}</strong><StatusBadge value={evidence.state} /><StatusBadge value={evidence.freshness} /></div>
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Evidence source</dt><dd className="break-all">{evidence.source}</dd></div>
      <div><dt className="text-muted-foreground">Recorded</dt><dd>{evidence.timestamp || "NOT_RECORDED"}</dd></div>
    </dl>
    {evidence.evidence?.length ? <ul className="mt-3 list-disc space-y-1 pl-4 text-muted-foreground">{evidence.evidence.map((entry, index) => <li key={`${entry}:${index}`} className="break-all">{entry}</li>)}</ul> : <p className="mt-3 text-muted-foreground">No positive verification evidence was recorded.</p>}
    {evidence.reason ? <p className="mt-3 rounded border p-2 text-muted-foreground">{evidence.reason}</p> : null}
  </article>;
}

function ReleaseSummary({ project, data }: { project: ProjectSummary; data: ReleasePreparation }) {
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" role="region" aria-label="Release preparation summary">
    <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Detected version</span><strong className="mt-1 block text-sm">{data.version || "NOT_DECLARED"}</strong><small className="text-muted-foreground">Local manifest evidence</small></article>
    <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Baseline tag</span><strong className="mt-1 block text-sm">{data.baselineTag || "NO_BASELINE_TAG"}</strong><small className="text-muted-foreground">Local Git evidence</small></article>
    <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Commits since baseline</span><strong className="mt-1 block text-sm">{data.commits.length}</strong><small className="text-muted-foreground">Bounded local history</small></article>
    <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Artifact directories</span><strong className="mt-1 block text-sm">{data.artifacts.length}</strong><small className="text-muted-foreground">Presence only</small></article>
    <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Branch</span><strong className="mt-1 block text-sm break-all">{project.branch || "UNKNOWN"}</strong><small className="text-muted-foreground">No mutation performed</small></article>
  </section>;
}

function ReleasePreparationView({ project, data }: { project: ProjectSummary; data: ReleasePreparation }) {
  return <section className="space-y-4" role="region" aria-label="Release preparation workspace">
    <ReleaseSummary project={project} data={data} />

    <section className="rounded-lg border bg-card p-4" aria-label="Release notes proposal">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Release notes proposal</h3><StatusBadge value="PREVIEW_ONLY" /></div>
      <p className="mt-2 text-xs text-muted-foreground">Generated only from the bounded local commit history returned by Release Preparation. KForge does not create a tag, commit, GitHub Release, or remote request here.</p>
      <div className="mt-3 whitespace-pre-wrap rounded-md border bg-muted/20 p-3 font-mono text-xs">{data.notes || "No commit-backed release-note proposal is available."}</div>
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Release commit history">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Commits since baseline</h3><StatusBadge value={`${data.commits.length} COMMITS`} /></div>
      {data.commits.length ? <div className="mt-3 space-y-2">{data.commits.map((commit, index) => <article key={`${commit.shortSha}:${index}`} className="grid gap-1 rounded-md border p-3 text-xs sm:grid-cols-[7rem_1fr_auto]"><code>{commit.shortSha || "NO_SHA"}</code><strong className="min-w-0 break-words">{commit.subject || "No commit subject"}</strong><span className="text-muted-foreground">{commit.committedAt || "NO_TIMESTAMP"}</span></article>)}</div> : <EmptyState title="No commit delta available" detail="No local commits were returned for the current baseline. KForge does not invent release changes." />}
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Local release verification evidence">
      <h3 className="text-sm font-semibold">Local verification evidence</h3>
      <p className="mt-1 text-xs text-muted-foreground">Desktop, Windows package, and installer evidence remain independent. A local package digest is never promoted to a CI artifact identity.</p>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">{evidenceKinds.map((kind) => <EvidenceCard key={kind} kind={kind} evidence={data.localEvidence?.[kind]} />)}</div>
    </section>
  </section>;
}

function ArtifactInventoryView({ project, data }: { project: ProjectSummary; data: ReleasePreparation }) {
  return <section className="space-y-4" role="region" aria-label="Artifact evidence inventory">
    <ReleaseSummary project={project} data={data} />

    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Artifact Evidence Inventory</h3><StatusBadge value="LOCAL_EVIDENCE_ONLY" /></div>
      <p className="mt-2 text-xs text-muted-foreground">Detected build directories prove local presence only. KForge does not claim file size, digest, signature, CI provenance, or distributable identity from a directory name.</p>
      {data.artifacts.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.artifacts.map((artifact) => <article key={artifact} className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto break-all">{artifact}</strong><StatusBadge value="PRESENCE_ONLY" /></div><dl className="mt-3 grid gap-1"><div><dt className="text-muted-foreground">Identity</dt><dd>NOT_MEASURED</dd></div><div><dt className="text-muted-foreground">Digest</dt><dd>NOT_MEASURED</dd></div><div><dt className="text-muted-foreground">Signature</dt><dd>NOT_MEASURED</dd></div><div><dt className="text-muted-foreground">CI provenance</dt><dd>NOT_EVALUATED_HERE</dd></div></dl></article>)}</div> : <EmptyState title="No local artifact directory detected" detail="No dist/build/out/target/release/artifacts directory was reported. Absence is shown directly rather than converted into a verified PASS." />}
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Verified local package records">
      <h3 className="text-sm font-semibold">Verification records</h3>
      <p className="mt-1 text-xs text-muted-foreground">These records may contain a real local package filename, SHA-256, lifecycle result, or signature state. Their evidence source remains visible so it cannot be confused with GitHub Actions artifact provenance.</p>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">{evidenceKinds.map((kind) => <EvidenceCard key={kind} kind={kind} evidence={data.localEvidence?.[kind]} />)}</div>
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Artifact identity boundaries">
      <h3 className="text-sm font-semibold">Artifact identity boundaries</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-3 text-xs">
        <article className="rounded-md border p-3"><strong>Local presence</strong><p className="mt-2 text-muted-foreground">Directory/file presence belongs to this project checkout only.</p></article>
        <article className="rounded-md border p-3"><strong>Local verification</strong><p className="mt-2 text-muted-foreground">Package verification records may establish a local digest or lifecycle result when explicitly recorded.</p></article>
        <article className="rounded-md border p-3"><strong>CI artifact identity</strong><p className="mt-2 text-muted-foreground">Not inferred here. CI run/artifact IDs and digests remain independent evidence in Release Gate and GitHub Actions.</p></article>
      </div>
    </section>
  </section>;
}

function VersioningView({ project, data }: { project: ProjectSummary; data: ReleasePreparation }) {
  const versionState = data.version ? "VERSION_DETECTED" : "VERSION_NOT_DECLARED";
  const baselineState = data.baselineTag ? "BASELINE_DETECTED" : "NO_BASELINE_TAG";
  return <section className="space-y-4" role="region" aria-label="Versioning readiness workspace">
    <ReleaseSummary project={project} data={data} />

    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Versioning Readiness</h3><StatusBadge value={versionState} /><StatusBadge value={baselineState} /></div>
      <p className="mt-2 text-xs text-muted-foreground">This is evidence and planning only. No version, tag, commit, branch, push, GitHub Release, or remote registry state is modified.</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        <div className="rounded-md border p-3"><dt className="text-muted-foreground">Manifest version</dt><dd className="mt-1 font-semibold">{data.version || "NOT_DECLARED"}</dd></div>
        <div className="rounded-md border p-3"><dt className="text-muted-foreground">Baseline tag</dt><dd className="mt-1 font-semibold">{data.baselineTag || "NO_BASELINE_TAG"}</dd></div>
        <div className="rounded-md border p-3"><dt className="text-muted-foreground">Local commit delta</dt><dd className="mt-1 font-semibold">{data.commits.length}</dd></div>
        <div className="rounded-md border p-3"><dt className="text-muted-foreground">Current branch</dt><dd className="mt-1 break-all font-semibold">{project.branch || "UNKNOWN"}</dd></div>
      </dl>
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Versioning decision inputs">
      <h3 className="text-sm font-semibold">Decision inputs</h3>
      <p className="mt-1 text-xs text-muted-foreground">KForge exposes the inputs required for a human/versioning policy decision but does not invent semantic-version intent from commit subjects.</p>
      {data.commits.length ? <div className="mt-3 space-y-2">{data.commits.slice(0, 20).map((commit, index) => <article key={`${commit.shortSha}:${index}`} className="flex flex-wrap items-start gap-2 rounded-md border p-3 text-xs"><code>{commit.shortSha || "NO_SHA"}</code><span className="min-w-0 flex-1 break-words">{commit.subject || "No subject"}</span><span className="text-muted-foreground">{commit.committedAt || "NO_TIMESTAMP"}</span></article>)}</div> : <EmptyState title="No versioning delta" detail="No commit delta was returned. KForge does not manufacture a major/minor/patch recommendation." />}
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Distribution readiness evidence">
      <h3 className="text-sm font-semibold">Distribution readiness evidence</h3>
      <p className="mt-1 text-xs text-muted-foreground">Use Release Gate for the independent SOURCE / LOCAL / PREVIEW / DESKTOP / WINDOWS_PACKAGE / INSTALLER / GITHUB / CI / REMOTE verdicts. This view never collapses those domains into one fabricated status.</p>
      <div className="mt-3 grid gap-3 xl:grid-cols-3">{evidenceKinds.map((kind) => <EvidenceCard key={kind} kind={kind} evidence={data.localEvidence?.[kind]} />)}</div>
    </section>
  </section>;
}

export default function ReleaseDistributionWorkbench({ project, view }: { project: ProjectSummary; view: ReleaseDistributionView }) {
  const [data, setData] = useState<ReleasePreparation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetchJson<{ preparation: ReleasePreparation }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`);
      setData(response.preparation);
    } catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : "Release preparation evidence is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [project.id]);

  return <section className="space-y-4" role="region" aria-label="KForge Release and Distribution Center">
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Release &amp; Distribution Center 2.0</h2>
        <p className="mt-1 text-xs text-muted-foreground">Structured local release preparation, artifact identity boundaries, and versioning evidence. Opening or refreshing this surface performs no tag, commit, push, publish, registry mutation, or remote request.</p>
      </div>
      <StatusBadge value="READ_ONLY_PREPARATION" />
      <button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh local release evidence"}</button>
    </header>

    {message ? <p className="kw-message" role="status">{message}</p> : null}
    {loading && !data ? <p className="kw-message" role="status">Loading bounded local release preparation evidence…</p> : null}
    {!loading && !data ? <EmptyState title="Release preparation unavailable" detail="KForge could not load current local release evidence. No release readiness, artifact identity, or version state was invented." /> : null}

    {data ? <>
      {view === "release-preparation" ? <ReleasePreparationView project={project} data={data} /> : null}
      {view === "artifacts" ? <ArtifactInventoryView project={project} data={data} /> : null}
      {view === "versioning" ? <VersioningView project={project} data={data} /> : null}
      <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">{data.notice}</p>
      <AdvancedEvidence value={data} label="Advanced · Raw local release preparation evidence" />
    </> : null}
  </section>;
}
