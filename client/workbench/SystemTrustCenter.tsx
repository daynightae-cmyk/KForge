import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalPlatformStatus, ProjectSummary } from "@shared/workspace";
import type { RecordRow, SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type ToolEvidence = RecordRow & {
  name: string;
  permission?: string;
  status?: string;
  description?: string;
  unavailableReason?: string;
  evidence?: RecordRow;
};
type ToolsResponse = { tools: ToolEvidence[] };

function SystemTrustCenter({ project, onRefresh }: { project?: ProjectSummary; onRefresh: SurfaceProps["onRefresh"] }) {
  const [tools, setTools] = useState<ToolEvidence[]>([]);
  const [platform, setPlatform] = useState<LocalPlatformStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const projectId = project?.id || "";

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [toolData, platformData] = await Promise.all([
        fetchJson<ToolsResponse>(`/api/workspace/projects/${encodeURIComponent(projectId)}/agent/tools`),
        fetchJson<LocalPlatformStatus>("/api/workspace/platform"),
      ]);
      setTools(toolData.tools || []);
      setPlatform(platformData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Trust evidence unavailable.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    setTools([]);
    setPlatform(null);
    setMessage("");
    void load();
  }, [load, projectId]);

  const counts = useMemo(() => {
    const readOnly = tools.filter((tool) => tool.permission === "read-only").length;
    const executable = tools.filter((tool) => ["safe", "safe-write", "dangerous"].includes(String(tool.permission))).length;
    const available = tools.filter((tool) => ["AVAILABLE", "AVAILABLE_WITH_CONFIRMATION"].includes(String(tool.status))).length;
    const blocked = tools.filter((tool) => ["UNAVAILABLE", "BLOCKED", "ERROR"].includes(String(tool.status))).length;
    return { readOnly, executable, available, blocked };
  }, [tools]);

  const grantTrust = async () => {
    if (!project || project.trust === "trusted" || busy) return;
    if (!window.confirm(`Trust ${project.name}? This enables bounded local commands and write-capable KForge operations for this project. Remote writes remain separately confirmation-gated.`)) return;
    setBusy(true);
    setMessage("Applying confirmed local project trust…");
    try {
      await fetchJson(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, jsonRequest({ confirmed: true }));
      await onRefresh();
      await load();
      setMessage("Project trust granted. Remote writes and network operations remain governed by their own policy and confirmation gates.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project trust change failed.");
    } finally {
      setBusy(false);
    }
  };

  const revokeTrust = async () => {
    if (!project || project.trust !== "trusted" || busy) return;
    if (!window.confirm(`Revoke trust for ${project.name}? This disables bounded local execution and write-capable KForge operations for this project. It does not delete or modify project source.`)) return;
    setBusy(true);
    setMessage("Applying confirmed local project trust revocation…");
    try {
      await fetchJson(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust/revoke`, jsonRequest({ confirmed: true }));
      await onRefresh();
      await load();
      setMessage("Project trust revoked. Bounded execution/write authorities were re-evaluated; remote services were not contacted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project trust revocation failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!project) return <EmptyState title="No project selected" detail="Trust is project-scoped. Select a local project to inspect, grant, or revoke execution authority." />;
  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading project trust evidence…</div>;

  return <section className="space-y-4" aria-label="KForge Trust Center" data-project-trust={project.trust}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Trust Center</h2>
        <p className="mt-1 text-xs text-muted-foreground">Project trust is a reversible local execution boundary. It does not authorize Git push, cloud AI, registry access, remote transfers, or hidden network contact.</p>
      </div>
      <StatusBadge value={project.trust} />
      <button onClick={() => void load()} disabled={busy}>Refresh evidence</button>
      {project.trust !== "trusted" ? <button onClick={() => void grantTrust()} disabled={busy}>{busy ? "Applying…" : "Trust project with confirmation"}</button> : <button onClick={() => void revokeTrust()} disabled={busy}>{busy ? "Applying…" : "Revoke project trust"}</button>}
    </header>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.75fr)]">
      <section className="rounded-lg border bg-card p-4" aria-label="Trust boundary evidence">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Current authority boundary</h3><StatusBadge value={project.trust === "trusted" ? "LOCAL_EXECUTION_ENABLED" : "READ_MOSTLY"} /></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Project</dt><dd>{project.name}</dd></div>
          <div><dt className="text-muted-foreground">Path</dt><dd className="break-all"><code>{project.path}</code></dd></div>
          <div><dt className="text-muted-foreground">Trust state</dt><dd>{project.trust}</dd></div>
          <div><dt className="text-muted-foreground">Local read-only tools</dt><dd>{counts.readOnly}</dd></div>
          <div><dt className="text-muted-foreground">Execution/write-class tools registered</dt><dd>{counts.executable}</dd></div>
          <div><dt className="text-muted-foreground">Currently available tool authorities</dt><dd>{counts.available}</dd></div>
          <div><dt className="text-muted-foreground">Unavailable / blocked / error</dt><dd>{counts.blocked}</dd></div>
          <div><dt className="text-muted-foreground">Core network requirement</dt><dd>{platform?.networkRequiredForCore === false ? "NOT_REQUIRED" : "UNKNOWN"}</dd></div>
        </dl>
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <article className="rounded-md border p-3"><strong>Trust may enable</strong><p className="mt-1 text-muted-foreground">Detected tests, builds, lint, runtime verification, snapshots, reviewed fixes, and other bounded local handlers when their own prerequisites are satisfied.</p></article>
          <article className="rounded-md border p-3"><strong>Trust never implies</strong><p className="mt-1 text-muted-foreground">Remote Git writes, cloud-provider requests, model downloads, registry transfers, or arbitrary shell execution.</p></article>
        </div>
      </section>

      <aside className="rounded-lg border bg-card p-4" aria-label="Trust safety invariants">
        <h3 className="text-sm font-semibold">Safety invariants</h3>
        <dl className="mt-4 grid gap-2 text-xs">
          <div><dt className="text-muted-foreground">Remote writes</dt><dd>SEPARATE_CONFIRMATION_REQUIRED</dd></div>
          <div><dt className="text-muted-foreground">Opening remote surfaces</dt><dd>NO_IMPLICIT_NETWORK_CONTACT</dd></div>
          <div><dt className="text-muted-foreground">Secret redaction</dt><dd>ENFORCED</dd></div>
          <div><dt className="text-muted-foreground">Arbitrary shell</dt><dd>NOT_EXPOSED</dd></div>
          <div><dt className="text-muted-foreground">Trust persistence</dt><dd>LOCAL_WORKSPACE_EVIDENCE</dd></div>
          <div><dt className="text-muted-foreground">Trust revocation authority</dt><dd>EXPLICIT_CONFIRMED_LOCAL_REVOCATION</dd></div>
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">Grant and revoke both persist only local trust metadata. Revocation disables trust-gated execution without deleting source, changing Git state, or contacting a remote service.</p>
      </aside>
    </div>

    <section className="rounded-lg border bg-card p-4" aria-label="Trust affected tool authorities">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Registered project tool authorities</h3><span className="text-xs text-muted-foreground">{tools.length} tool definitions</span></div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{tools.map((tool) => <article key={tool.name} className="rounded-md border p-3 text-xs"><div className="flex items-start gap-2"><strong className="mr-auto">{tool.name}</strong><StatusBadge value={tool.status || "UNKNOWN"} /></div><p className="mt-2 text-muted-foreground">{tool.description || "No description."}</p><div className="mt-2 flex flex-wrap gap-2"><span>permission · {tool.permission || "UNKNOWN"}</span><span>handler · {String((tool.evidence as RecordRow | undefined)?.handler || "UNKNOWN")}</span></div>{tool.unavailableReason ? <p className="mt-2 text-muted-foreground">{tool.unavailableReason}</p> : null}</article>)}</div>
      <div className="mt-4"><AdvancedEvidence value={{ project: { id: project.id, trust: project.trust, path: project.path }, platform, tools }} label="Advanced · Raw trust boundary evidence" /></div>
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default SystemTrustCenter;
