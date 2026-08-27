import { useState, useEffect } from "react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, fetchEvidence } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import { viewLabel } from "./navigation";

function ReleaseSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Release evidence is project scoped." />;
  if (view === "release-gate") return <ReleaseGate project={project} onExecution={onExecution} />;
  return <ReleasePreparation project={project} view={view} />;
}

function ReleaseGate({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState(""); const order = ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"];
  const run = async () => { onExecution({ label: "Release Gate", state: "RUNNING", source: "KForge release evidence engine" }); const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/release-gate`, { method: "POST" }); if (response.data.verdicts) { setData(response.data); setMessage(response.ok ? "" : "Release Gate is blocked; independent source verdicts remain visible."); onExecution({ label: "Release Gate", state: String(response.data.readiness || "UNKNOWN"), source: "KForge release evidence engine" }); } else setMessage(String(response.data.error || "Release Gate failed.")); };
  const verdicts = (data?.verdicts || {}) as Record<string, RecordRow>;
  return <section className="kw-release-gate"><div className="kw-toolbar"><h2>Release Gate</h2><button onClick={() => void run()}>Run Release Gate</button></div>{message && <p className="kw-message">{message}</p>}{data ? <div className="kw-release-grid">{order.map((kind) => { const verdict = verdicts[kind] || {}; return <article key={kind}><strong>{kind}</strong><StatusBadge value={verdict.state} /><p>{String(verdict.source || "No source evidence")}</p><small>{String(verdict.timestamp || "NO_TIMESTAMP")} · {String(verdict.freshness || "UNKNOWN")}</small><details><summary>Domain evidence</summary><pre>{JSON.stringify(verdict, null, 2)}</pre></details></article>; })}</div> : <EmptyState title="No release verification loaded" detail="Run the gate to collect independent evidence domains. A Windows PASS never implies CI PASS." />}</section>;
}

function ReleasePreparation({ project, view }: { project: ProjectSummary; view: string }) {
  const [data, setData] = useState<RecordRow | null>(null); useEffect(() => { void fetchJson<{ preparation: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`).then((result) => setData(result.preparation)); }, [project.id]); if (!data) return <p className="kw-message">Loading release preparation evidence…</p>; if (view === "artifacts") { const artifacts = (data.artifacts || []) as string[]; return <section className="kw-surface-section"><h2>Structured artifacts</h2>{artifacts.length ? <div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>Artifact</th><th>Type</th><th>Source</th><th>Version</th><th>Git SHA</th><th>Created</th><th>Size</th><th>SHA-256</th><th>Signature</th><th>Verification</th></tr></thead><tbody>{artifacts.map((artifact) => <tr key={artifact}><td>{artifact}</td><td>directory</td><td>Local release preparation</td><td>{String(data.version || "UNKNOWN")}</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td><StatusBadge value="NOT_VERIFIED" /></td></tr>)}</tbody></table></div> : <EmptyState title="No release artifacts detected" detail="Raw JSON is not treated as a verified artifact." />}</section>; } return <section className="kw-surface-section"><h2>{viewLabel("release", view)}</h2><pre>{JSON.stringify(data, null, 2)}</pre></section>;
}

export default ReleaseSurface;
