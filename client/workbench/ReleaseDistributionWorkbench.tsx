import { useEffect, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
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
  sourceHead: string | null;
  baselineTag: string | null;
  version: string | null;
  commits: ReleaseCommit[];
  artifacts: string[];
  localEvidence: Record<string, LocalReleaseEvidence>;
  notes: string;
  notice: string;
};

type ReleaseArtifactEvidence = {
  path: string;
  kind: string;
  size: number;
  sha256: string;
  modifiedAt: string;
};

type ReleaseSigningEvidence = {
  state: string;
  match: string;
  source: string;
  detail: string;
  recordedSha256?: string;
  artifactPath?: string;
};

type ReleaseExecutionRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sourceSha: string;
  branch: string;
  version: string | null;
  versionChange: { manifestPath: string; from: string | null; to: string; snapshotId: string } | null;
  build: { mode: "build" | "package"; command: string; ok: boolean; exitCode?: number; startedAt: string; completedAt: string; outputTail: string };
  artifactState: "VERIFIED" | "BUILD_FAILED" | "NOT_FOUND";
  artifactScan: { roots: string[]; limit: number; truncated: boolean };
  artifacts: ReleaseArtifactEvidence[];
  artifactDigest: string | null;
  signing: ReleaseSigningEvidence;
  publication: { state: string; detail: string };
  recovery?: { rolledBack: boolean; snapshotId?: string; reason: string };
  createdAt: string;
};

type ReleasePublicationAsset = {
  path: string;
  name: string;
  size: number;
  sha256: string;
  state: "VERIFIED" | "UPLOADED_UNVERIFIED" | "MISSING";
  assetId?: number;
  downloadUrl?: string;
  remoteDigest?: string;
};

type ReleasePublication = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  releaseRecordId: string;
  sourceSha: string;
  tagName: string;
  releaseId: number | null;
  releaseUrl: string | null;
  outcome: string;
  assets: ReleasePublicationAsset[];
  verification: "VERIFIED" | "PARTIAL" | "UNVERIFIED";
  detail: string;
  createdAt: string;
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

function ArtifactRecord({ artifact }: { artifact: ReleaseArtifactEvidence }) {
  return <article className="rounded-md border p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto break-all">{artifact.path}</strong><StatusBadge value={artifact.kind} /></div>
    <dl className="mt-2 grid gap-1 sm:grid-cols-3">
      <div><dt className="text-muted-foreground">Bytes</dt><dd>{artifact.size.toLocaleString()}</dd></div>
      <div className="sm:col-span-2"><dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono">{artifact.sha256}</dd></div>
    </dl>
  </article>;
}

function ReleaseExecutionRecordView({ record }: { record: ReleaseExecutionRecord }) {
  return <section className="mt-3 space-y-3 rounded-md border p-3" aria-label="Verified release execution record">
    <div className="flex flex-wrap items-center gap-2">
      <strong className="mr-auto text-sm">Release execution {record.id.slice(0, 18)}…</strong>
      <StatusBadge value={record.artifactState} />
      <StatusBadge value={`SIGNING_${record.signing.state}`} />
      <StatusBadge value={`SIGNATURE_${record.signing.match}`} />
      <StatusBadge value={record.publication.state} />
    </div>
    <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-muted-foreground">Source SHA</dt><dd className="break-all font-mono">{record.sourceSha}</dd></div>
      <div><dt className="text-muted-foreground">Version</dt><dd>{record.version || "NOT_DECLARED"}</dd></div>
      <div><dt className="text-muted-foreground">Build</dt><dd className="break-all">{record.build.command}</dd></div>
      <div><dt className="text-muted-foreground">Exit code</dt><dd>{record.build.exitCode ?? "UNKNOWN"} · {record.build.ok ? "PASS" : "FAIL"}</dd></div>
    </dl>
    {record.versionChange ? <p className="rounded border p-2 text-xs text-muted-foreground">Manifest {record.versionChange.manifestPath}: {record.versionChange.from || "none"} → {record.versionChange.to}. Snapshot {record.versionChange.snapshotId}.</p> : null}
    {record.recovery ? <p className="rounded border p-2 text-xs text-muted-foreground">Recovery: {record.recovery.rolledBack ? "manifest rolled back" : "rollback not completed"} — {record.recovery.reason}</p> : null}
    <div>
      <h4 className="text-xs font-semibold">Artifact bytes and digests</h4>
      {record.artifactScan?.truncated ? <p className="mt-2 rounded border p-2 text-xs text-muted-foreground">The bounded inventory reached its {record.artifactScan.limit}-file limit. Additional artifact files exist outside this record and are not covered by the aggregate digest.</p> : null}
      {record.artifacts.length ? <div className="mt-2 grid gap-2">{record.artifacts.map((artifact) => <ArtifactRecord key={artifact.path} artifact={artifact} />)}</div> : <p className="mt-2 text-xs text-muted-foreground">No verified artifact file belongs to this failed or empty build. KForge does not attribute an older output to the current run.</p>}
    </div>
    <div className="rounded border p-2 text-xs text-muted-foreground">
      <p>Aggregate digest: <span className="break-all font-mono">{record.artifactDigest || "NOT_AVAILABLE"}</span></p>
      <p className="mt-1">Signing evidence: <StatusBadge value={record.signing.match} /> {record.signing.artifactPath ? <span className="break-all font-mono">{record.signing.artifactPath}</span> : null} {record.signing.detail}</p>
      <p className="mt-1">Publication: {record.publication.detail}</p>
    </div>
  </section>;
}

function ReleasePublicationPanel({ project, data, records }: { project: ProjectSummary; data: ReleasePreparation; records: ReleaseExecutionRecord[] }) {
  const verifiedRecords = records.filter((record) => record.artifactState === "VERIFIED" && record.artifacts.length);
  const [recordId, setRecordId] = useState("");
  const selected = verifiedRecords.find((record) => record.id === recordId) || verifiedRecords[0] || null;
  const selectedId = selected?.id || "";
  const [tagName, setTagName] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [prerelease, setPrerelease] = useState(false);
  const [acknowledgeUnsigned, setAcknowledgeUnsigned] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [publication, setPublication] = useState<ReleasePublication | null>(null);
  const [publications, setPublications] = useState<ReleasePublication[]>([]);

  useEffect(() => {
    if (!selected) return;
    const version = selected.version || selected.sourceSha.slice(0, 7);
    setTagName(`v${version}`);
    setReleaseName(`KNOuX Forge ${version}`);
  }, [selectedId]);

  const refreshPublications = async () => {
    const response = await fetchJson<{ publications: ReleasePublication[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/publications`).catch(() => null);
    if (response) setPublications(Array.isArray(response.publications) ? response.publications : []);
  };

  useEffect(() => {
    let active = true;
    void fetchJson<{ publications: ReleasePublication[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/publications`)
      .then((response) => { if (active) setPublications(Array.isArray(response.publications) ? response.publications : []); })
      .catch(() => { if (active) setPublications([]); });
    return () => { active = false; };
  }, [project.id]);

  const publish = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    setPublication(null);
    try {
      const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/publish`, jsonRequest({
        confirmed: true,
        expectedHead: data.sourceHead,
        releaseRecordId: selected.id,
        tagName: tagName.trim() || undefined,
        name: releaseName.trim() || undefined,
        body,
        draft,
        prerelease,
        acknowledgeUnsigned,
      }));
      const result = (response.data.publication || null) as ReleasePublication | null;
      setPublication(result);
      if (!response.ok) setMessage(String(response.data.error || `GitHub publication returned ${response.status}. No success was inferred.`));
      else setMessage(`GitHub publication ${result?.outcome || "RECORDED"}; independent read-back is ${result?.verification || "UNVERIFIED"}.`);
      setConfirmed(false);
      await refreshPublications();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Release publication request failed.");
    } finally {
      setBusy(false);
    }
  };

  const distributable = selected?.artifacts.filter((artifact) => artifact.kind === "INSTALLER" || artifact.kind === "PACKAGE") || [];

  return <section className="rounded-lg border bg-card p-4" aria-label="Authorized GitHub release publication">
    <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Publish a verified artifact to GitHub</h3><StatusBadge value="REMOTE_MUTATION" /><StatusBadge value="EXPLICIT_CONFIRMATION_REQUIRED" /></div>
    <p className="mt-1 text-xs text-muted-foreground">This creates a GitHub release, uploads only installer/package assets from the selected persisted record, re-hashes every recorded file first, and verifies the result through an independent GitHub read-back. Nothing is sent until the confirmed button is pressed.</p>
    {!verifiedRecords.length ? <p className="mt-3 rounded border p-2 text-xs text-muted-foreground">No verified release execution record exists yet. Build and verify an artifact first; preparation evidence alone cannot be published.</p> : <>
      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <label className="grid gap-1 sm:col-span-2"><span className="text-muted-foreground">Verified release record</span><select value={selectedId} onChange={(event) => setRecordId(event.target.value)}>{verifiedRecords.map((record) => <option key={record.id} value={record.id}>{record.createdAt} · {record.version || "no version"} · {record.sourceSha.slice(0, 12)}</option>)}</select></label>
        <label className="grid gap-1"><span className="text-muted-foreground">Tag name</span><input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="v1.2.3" /></label>
        <label className="grid gap-1"><span className="text-muted-foreground">Release name</span><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} /></label>
        <label className="grid gap-1 sm:col-span-2"><span className="text-muted-foreground">Release notes body</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} /></label>
      </div>
      <dl className="mt-3 grid gap-2 rounded border p-3 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Source SHA</dt><dd className="break-all font-mono">{selected?.sourceSha}</dd></div>
        <div><dt className="text-muted-foreground">Artifact digest</dt><dd className="break-all font-mono">{selected?.artifactDigest || "NOT_AVAILABLE"}</dd></div>
        <div><dt className="text-muted-foreground">Signing</dt><dd><StatusBadge value={selected?.signing.state} /> <StatusBadge value={selected?.signing.match} /></dd></div>
        <div><dt className="text-muted-foreground">Distributable assets</dt><dd>{distributable.length ? distributable.map((artifact) => artifact.path).join(", ") : "NONE"}</dd></div>
      </dl>
      {selected?.artifactScan?.truncated ? <p className="mt-2 rounded border p-2 text-xs text-muted-foreground">This record&apos;s artifact inventory was bounded at {selected.artifactScan.limit} files and is incomplete, so KForge will not publish it as a complete release.</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /><span>Keep as draft</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={prerelease} onChange={(event) => setPrerelease(event.target.checked)} /><span>Prerelease</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={acknowledgeUnsigned} onChange={(event) => setAcknowledgeUnsigned(event.target.checked)} /><span>I acknowledge the artifact is not proven signed</span></label>
      </div>
      <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the exact repository, tag, verified artifact digest, signing state, and source SHA <code className="break-all">{data.sourceHead || "UNAVAILABLE"}</code>. This performs a real GitHub mutation.</span></label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => void publish()} disabled={!confirmed || !selected || busy || !data.sourceHead || !distributable.length || selected.artifactScan?.truncated === true || !tagName.trim() || !releaseName.trim()}>{busy ? "Publishing to GitHub…" : draft ? "Create draft release with verified assets" : "Publish release with verified assets"}</button>
        <span className="text-xs text-muted-foreground">Requires project trust, Online Optional or Online mode, a GitHub origin remote, and an unchanged local artifact.</span>
      </div>
    </>}
    {message ? <p className="kw-message mt-3" role="status">{message}</p> : null}
    {publication ? <article className="mt-3 rounded-md border p-3 text-xs" aria-label="GitHub publication read-back">
      <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto">Publication {publication.outcome}</strong><StatusBadge value={publication.outcome} /><StatusBadge value={`READ_BACK_${publication.verification}`} /></div>
      <p className="mt-2 text-muted-foreground">{publication.detail}</p>
      <p className="mt-1 break-all font-mono">tag {publication.tagName} · release {publication.releaseId ?? "unknown"}</p>
      {publication.releaseUrl ? <p className="mt-1 break-all"><a className="text-primary underline-offset-2 hover:underline" href={publication.releaseUrl} target="_blank" rel="noreferrer">Open GitHub release</a></p> : null}
      <ul className="mt-2 space-y-1">{publication.assets.map((asset) => <li key={asset.path} className="flex flex-wrap items-center gap-2 rounded border p-2"><span className="mr-auto break-all font-mono">{asset.name}</span><StatusBadge value={asset.state} /><span className="text-muted-foreground">{asset.size.toLocaleString()} bytes</span>{asset.remoteDigest ? <span className="w-full break-all font-mono text-muted-foreground">{asset.remoteDigest}</span> : null}</li>)}</ul>
    </article> : null}
    {publications.length ? <div className="mt-3"><h4 className="text-xs font-semibold">Persisted GitHub publication records</h4><ul className="mt-2 space-y-1 text-xs">{publications.slice(0, 5).map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded border p-2"><span className="mr-auto break-all font-mono">{entry.tagName} · {entry.sourceSha.slice(0, 12)}</span><StatusBadge value={entry.outcome} /><StatusBadge value={`READ_BACK_${entry.verification}`} /><span className="text-muted-foreground">{entry.createdAt}</span></li>)}</ul></div> : null}
  </section>;
}


function ReleaseExecutionPanel({ project, data, records, setRecords }: { project: ProjectSummary; data: ReleasePreparation; records: ReleaseExecutionRecord[]; setRecords: (records: ReleaseExecutionRecord[]) => void }) {
  const [mode, setMode] = useState<"build" | "package">("build");
  const [version, setVersion] = useState(data.version || "");
  const [updateManifest, setUpdateManifest] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [record, setRecord] = useState<ReleaseExecutionRecord | null>(null);

  useEffect(() => { setVersion(data.version || ""); }, [data.version]);
  useEffect(() => {
    let active = true;
    void fetchJson<{ records: ReleaseExecutionRecord[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/records`)
      .then((response) => { if (active) setRecords(Array.isArray(response.records) ? response.records : []); })
      .catch(() => { if (active) setRecords([]); });
    return () => { active = false; };
  }, [project.id]);

  const execute = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/execute`, jsonRequest({
        confirmed: true,
        expectedHead: data.sourceHead,
        mode,
        version: version.trim() || undefined,
        updateManifest,
        rollbackOnFailure: true,
      }));
      const next = (response.data.record || null) as ReleaseExecutionRecord | null;
      setRecord(next);
      if (!response.ok) setMessage(String(response.data.error || "Release execution did not complete. No artifact or signature verdict was invented."));
      else setMessage(next?.artifactState === "VERIFIED" ? "Release artifact was built from the confirmed source SHA and hashed locally." : "The build completed but produced no verified artifact.");
      const refreshed = await fetchJson<{ records: ReleaseExecutionRecord[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/records`).catch(() => null);
      if (refreshed) setRecords(Array.isArray(refreshed.records) ? refreshed.records : []);
      setConfirmed(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Release execution request failed.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="rounded-lg border bg-card p-4" aria-label="Authorized local release execution">
    <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Build &amp; verify a real artifact</h3><StatusBadge value="AUTHORIZED_LOCAL_EXECUTION" /></div>
    <p className="mt-1 text-xs text-muted-foreground">This action runs the project&apos;s own detected build or package script, hashes the actual output bytes, persists provenance, and keeps signing and publication independent. It never creates a CI identity or a remote release.</p>
    <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
      <label className="grid gap-1"><span className="text-muted-foreground">Execution mode</span><select value={mode} onChange={(event) => setMode(event.target.value === "package" ? "package" : "build")}><option value="build">Build</option><option value="package">Package</option></select></label>
      <label className="grid gap-1"><span className="text-muted-foreground">Exact version (optional)</span><input value={version} onChange={(event) => setVersion(event.target.value)} placeholder={data.version || "1.2.3"} inputMode="text" /></label>
    </div>
    <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={updateManifest} onChange={(event) => setUpdateManifest(event.target.checked)} /><span>If the version above differs from the manifest, update package.json after a snapshot. A failed build rolls the manifest back.</span></label>
    <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed source SHA <code className="break-all">{data.sourceHead || "UNAVAILABLE"}</code>, the version, and the local output target.</span></label>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button onClick={() => void execute()} disabled={!confirmed || busy || !data.sourceHead}>{busy ? "Executing real build…" : "Build & verify artifact"}</button>
      <span className="text-xs text-muted-foreground">Requires project trust and explicit confirmation. Build execution is local and does not require network access. No tag, push, or publication is performed.</span>
    </div>
    {message ? <p className="kw-message mt-3" role="status">{message}</p> : null}
    {record ? <ReleaseExecutionRecordView record={record} /> : null}
    {records.length ? <div className="mt-3"><h4 className="text-xs font-semibold">Persisted release execution records</h4><ul className="mt-2 space-y-1 text-xs">{records.slice(0, 5).map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded border p-2"><span className="mr-auto break-all font-mono">{entry.sourceSha.slice(0, 12)}</span><StatusBadge value={entry.artifactState} /><span className="text-muted-foreground">{entry.artifacts.length} artifact(s)</span><span className="text-muted-foreground">{entry.createdAt}</span></li>)}</ul></div> : null}
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
  const [records, setRecords] = useState<ReleaseExecutionRecord[]>([]);

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
        <p className="mt-1 text-xs text-muted-foreground">Structured local release preparation, artifact identity boundaries, and versioning evidence. Opening or refreshing this surface performs no tag, commit, push, publish, registry mutation, or remote request. Authorized local build execution is a separate confirmed action.</p>
      </div>
      <StatusBadge value="PREPARATION_READ_ONLY" />
      <StatusBadge value="EXECUTION_GATED" />
      <button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh local release evidence"}</button>
    </header>

    {message ? <p className="kw-message" role="status">{message}</p> : null}
    {loading && !data ? <p className="kw-message" role="status">Loading bounded local release preparation evidence…</p> : null}
    {!loading && !data ? <EmptyState title="Release preparation unavailable" detail="KForge could not load current local release evidence. No release readiness, artifact identity, or version state was invented." /> : null}

    {data ? <>
      {view === "release-preparation" ? <ReleasePreparationView project={project} data={data} /> : null}
      {view === "artifacts" ? <ArtifactInventoryView project={project} data={data} /> : null}
      {view === "versioning" ? <VersioningView project={project} data={data} /> : null}
      <ReleaseExecutionPanel project={project} data={data} records={records} setRecords={setRecords} />
      <ReleasePublicationPanel project={project} data={data} records={records} />
      <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">{data.notice}</p>
      <AdvancedEvidence value={data} label="Advanced · Raw local release preparation evidence" />
    </> : null}
  </section>;
}
