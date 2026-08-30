import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalPlatformMode, LocalPlatformStatus, ProjectSummary, SelfAuditRecord, WorkspaceResponse } from "@shared/workspace";
import type { RecordRow } from "./surfaceContracts";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type SystemControlView = "online-offline" | "self-audit" | "system-diagnostics";
type DiagnosticsRow = RecordRow & { id: string; name: string; state: string; source?: string };

const MODE_COPY: Record<LocalPlatformMode, { label: string; detail: string }> = {
  offline: { label: "Offline", detail: "Core local engineering only. External metadata reads, remote transfers and provider refresh are blocked." },
  "local-first": { label: "Local First", detail: "Local engineering remains primary; optional metadata reads may be allowed, while remote transfers stay blocked." },
  "online-optional": { label: "Online Optional", detail: "Explicit remote transfers become eligible, but provider refresh remains off until requested by a stronger mode." },
  online: { label: "Online", detail: "External metadata reads, remote transfers and provider refresh are eligible under their own explicit operation gates." },
};

function SystemControlCenter({ view, project }: { view: SystemControlView; project?: ProjectSummary }) {
  if (view === "online-offline") return <OperatingModeCenter />;
  if (view === "self-audit") return project ? <SelfAuditCenter project={project} /> : <EmptyState title="No project selected" detail="Self Audit is project-scoped. Select the KForge repository itself to run the full persisted audit sequence." />;
  return <DiagnosticsCenter />;
}

function OperatingModeCenter() {
  const [platform, setPlatform] = useState<LocalPlatformStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMode, setBusyMode] = useState<LocalPlatformMode | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setPlatform(await fetchJson<LocalPlatformStatus>("/api/workspace/platform"));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operating policy unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const changeMode = async (mode: LocalPlatformMode) => {
    if (!platform || mode === platform.mode || busyMode) return;
    const next = MODE_COPY[mode];
    if (!window.confirm(`Switch KForge operating mode to ${next.label}? This changes network eligibility policy only; it does not itself contact a remote service.`)) return;
    setBusyMode(mode);
    setMessage(`Applying ${next.label} policy locally…`);
    try {
      const updated = await fetchJson<LocalPlatformStatus>("/api/workspace/platform/mode", jsonRequest({ mode }));
      setPlatform(updated);
      setMessage(`${next.label} policy persisted locally. No remote request is implied by this mode change.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operating mode change failed.");
    } finally {
      setBusyMode(null);
    }
  };

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading local platform policy…</div>;
  if (!platform) return <EmptyState title="Operating policy unavailable" detail={message || "KForge could not read the local platform status."} action={<button onClick={() => void refresh()}>Retry</button>} />;

  return <section className="space-y-4" aria-label="KForge Operating Mode Control Center" data-platform-mode={platform.mode}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Operating Mode Control Center</h2><p className="mt-1 text-xs text-muted-foreground">Mode changes alter eligibility policy only. Opening this surface and changing policy do not themselves perform a remote metadata read, transfer, provider request, or write.</p></div>
      <StatusBadge value={platform.mode} />
      <StatusBadge value={platform.coreReady ? "CORE_READY" : "CORE_LIMITED"} />
      <button onClick={() => void refresh()} disabled={Boolean(busyMode)}>Refresh policy</button>
    </header>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Operating mode choices">{(Object.keys(MODE_COPY) as LocalPlatformMode[]).map((mode) => { const active = platform.mode === mode; return <article key={mode} className={`rounded-lg border p-4 ${active ? "bg-card shadow-sm" : "bg-card/60"}`}><div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold">{MODE_COPY[mode].label}</h3><StatusBadge value={active ? "ACTIVE" : "AVAILABLE_POLICY"} /></div><p className="mt-2 min-h-16 text-xs text-muted-foreground">{MODE_COPY[mode].detail}</p><button className="mt-3" disabled={active || Boolean(busyMode)} onClick={() => void changeMode(mode)}>{busyMode === mode ? "Applying…" : active ? "Current mode" : `Switch to ${MODE_COPY[mode].label}`}</button></article>; })}</section>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <section className="rounded-lg border bg-card p-4" aria-label="Network policy matrix">
        <h3 className="text-sm font-semibold">Network policy matrix</h3>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">External metadata reads</dt><dd><StatusBadge value={platform.policy.externalMetadataReads ? "ELIGIBLE" : "BLOCKED"} /></dd></div>
          <div><dt className="text-muted-foreground">Remote transfers</dt><dd><StatusBadge value={platform.policy.remoteTransfers ? "ELIGIBLE" : "BLOCKED"} /></dd></div>
          <div><dt className="text-muted-foreground">Provider refresh</dt><dd><StatusBadge value={platform.policy.providerRefresh ? "ELIGIBLE" : "BLOCKED"} /></dd></div>
          <div><dt className="text-muted-foreground">Remote writes</dt><dd>ALWAYS_CONFIRMATION_GATED</dd></div>
          <div><dt className="text-muted-foreground">Opening remote surface</dt><dd>NO_IMPLICIT_NETWORK_CONTACT</dd></div>
          <div><dt className="text-muted-foreground">Network required for core</dt><dd>{platform.networkRequiredForCore ? "YES" : "NO"}</dd></div>
          <div><dt className="text-muted-foreground">Local evidence storage</dt><dd className="break-all"><code>{platform.storagePath}</code></dd></div>
          <div><dt className="text-muted-foreground">Checked</dt><dd>{platform.checkedAt}</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Local capability matrix">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Local capability matrix</h3><span className="text-xs text-muted-foreground">{platform.capabilities.length} capabilities</span></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{platform.capabilities.map((capability) => <article key={capability.id} className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto">{capability.label}</strong><StatusBadge value={capability.state} /></div><p className="mt-2 text-muted-foreground">{capability.detail}</p></article>)}</div>
      </section>
    </div>

    <section className="rounded-lg border bg-card p-4" aria-label="Optional online feature policy">
      <h3 className="text-sm font-semibold">Optional online features</h3>
      <p className="mt-1 text-xs text-muted-foreground">Enabled means policy-eligible, not contacted, authenticated, downloaded, synchronized, or completed.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">{platform.optionalOnlineFeatures.map((feature) => <article key={feature.id} className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto">{feature.label}</strong><StatusBadge value={feature.enabled ? "ELIGIBLE" : "BLOCKED"} /></div><p className="mt-2 text-muted-foreground">{feature.detail}</p></article>)}</div>
      <div className="mt-4"><AdvancedEvidence value={platform} label="Advanced · Raw local platform evidence" /></div>
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

function SelfAuditCenter({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<SelfAuditRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("No persisted Self Audit evidence loaded.");

  const read = useCallback(async () => {
    const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/self-audit`);
    if (response.ok) {
      setData((response.data.selfAudit || response.data) as unknown as SelfAuditRecord);
      setMessage("");
    } else if (response.status === 404) {
      setData(null);
      setMessage("No valid persisted Self Audit evidence exists yet for this project.");
    } else {
      setMessage(String(response.data.error || "Self Audit evidence unavailable."));
    }
    setLoading(false);
  }, [project.id]);

  useEffect(() => { setLoading(true); setData(null); setMessage("No persisted Self Audit evidence loaded."); void read(); }, [read, project.id]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setMessage("Running observational KForge Self Audit…");
    const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/self-audit`, { method: "POST" });
    if (response.ok) {
      setData((response.data.selfAudit || response.data) as unknown as SelfAuditRecord);
      setMessage("Self Audit evidence persisted. The server restart boundary remains explicit and cannot be satisfied by a renderer refresh.");
    } else {
      setMessage(String(response.data.error || "Self Audit failed."));
    }
    setRunning(false);
  };

  const stageCounts = useMemo(() => {
    const counts = { passed: 0, failed: 0, blocked: 0, waiting: 0, queued: 0 };
    for (const stage of data?.stages || []) {
      if (stage.state === "PASSED") counts.passed += 1;
      else if (stage.state === "FAILED") counts.failed += 1;
      else if (stage.state === "BLOCKED" || stage.state === "UNAVAILABLE") counts.blocked += 1;
      else if (stage.state === "WAITING_RESTART") counts.waiting += 1;
      else counts.queued += 1;
    }
    return counts;
  }, [data]);

  return <section className="kw-self-audit space-y-4" aria-label="KForge Self Audit Control Center" data-self-audit-state={data?.status || "NOT_AVAILABLE"}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">KForge Self Audit</h2><p className="mt-1 text-xs text-muted-foreground">This sequence is observational: it never applies a fix, starts Preview implicitly, or contacts a remote provider. Source mutation is NONE unless the audit detects evidence to the contrary.</p></div><StatusBadge value={data?.status || "NOT_AVAILABLE"} /><StatusBadge value={data?.outcome || "PENDING"} /><button onClick={() => void read()} disabled={running}>Reload persisted evidence</button><button onClick={() => void run()} disabled={running}>{running ? "Running…" : "Run KForge Self Audit"}</button></header>

    {loading ? <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground" role="status">Loading persisted Self Audit evidence…</p> : null}
    {!loading && !data ? <EmptyState title="No persisted Self Audit run" detail="A run is created only after explicit execution. KForge does not synthesize a completed audit from unrelated health evidence." /> : null}

    {data ? <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Self Audit summary">
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Passed</span><strong className="mt-1 block text-lg">{stageCounts.passed}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Failed</span><strong className="mt-1 block text-lg">{stageCounts.failed}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Blocked</span><strong className="mt-1 block text-lg">{stageCounts.blocked}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Waiting restart</span><strong className="mt-1 block text-lg">{stageCounts.waiting}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Queued</span><strong className="mt-1 block text-lg">{stageCounts.queued}</strong></article>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Self Audit stage timeline">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Ordered audit timeline</h3><span className="text-xs text-muted-foreground">{data.stages.length} stages</span></div>
        <ol className="mt-4 grid gap-2">{data.stages.map((stage, index) => <li key={stage.id} className="grid gap-2 rounded-md border p-3 text-xs md:grid-cols-[36px_minmax(140px,0.45fr)_120px_minmax(0,1fr)]"><span className="font-mono text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><strong>{stage.label}</strong><StatusBadge value={stage.state} /><div className="min-w-0"><p className="break-words text-muted-foreground">{stage.completedAt || stage.startedAt || "No execution timestamp"}</p>{stage.evidence !== null && stage.evidence !== undefined ? <details className="mt-1"><summary>Stage evidence</summary><pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(stage.evidence, null, 2)}</pre></details> : null}</div></li>)}</ol>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Self Audit persistence boundary"><h3 className="text-sm font-semibold">Persistence & restart boundary</h3><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">Evidence file</dt><dd className="break-all"><code>{data.evidenceFile}</code></dd></div><div><dt className="text-muted-foreground">Source mutation detected</dt><dd>{data.sourceMutationDetected ? "YES" : "NO"}</dd></div><div><dt className="text-muted-foreground">Origin server instance</dt><dd className="break-all">{data.originInstanceId}</dd></div><div><dt className="text-muted-foreground">Reloaded by instance</dt><dd className="break-all">{data.reloadedByInstanceId || "NOT_VERIFIED_AFTER_RESTART"}</dd></div></dl><p className="mt-3 text-[11px] text-muted-foreground">WAITING_RESTART is not a failure and is not auto-promoted to PASS. A different KForge server instance must load the persisted record before restart/reload stages can become verified.</p><div className="mt-4"><AdvancedEvidence value={data} label="Advanced · Raw persisted Self Audit record" /></div></section>
    </> : null}

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

function DiagnosticsCenter() {
  const [rows, setRows] = useState<DiagnosticsRow[]>([]);
  const [raw, setRaw] = useState<RecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading measured diagnostics…");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [workspace, platform, providers, models] = await Promise.all([
        fetchJson<WorkspaceResponse>("/api/workspace/projects"),
        fetchJson<LocalPlatformStatus>("/api/workspace/platform"),
        fetchJson<{ providers: RecordRow[] }>("/api/workspace/ai/providers"),
        fetchJson<RecordRow>("/api/workspace/ai/models"),
      ]);
      const modelProviders = Array.isArray(models.providers) ? models.providers as RecordRow[] : [];
      const next: DiagnosticsRow[] = [
        { id: "projects", name: "Projects & repositories", state: workspace.projects.length ? "AVAILABLE" : "NOT_CONFIGURED", count: workspace.projects.length, source: "Workspace project inventory" },
        { id: "search", name: "Search & file inspection", state: "AVAILABLE", source: "Registered bounded local adapters" },
        { id: "commands", name: "Tests, build & terminal", state: "EVIDENCE_DEPENDENT", source: "Project action descriptors and local toolchain" },
        { id: "platform", name: "Local platform", state: platform.coreReady ? "AVAILABLE" : "LIMITED", mode: platform.mode, source: "Local platform policy" },
        ...providers.providers.map((provider, index) => ({ id: String(provider.id || `provider-${index}`), name: String(provider.name || provider.id || `Provider ${index + 1}`), state: String(provider.state || provider.status || "UNKNOWN"), source: String(provider.source || "AI provider inventory"), ...provider })),
        ...modelProviders.map((provider, index) => ({ id: String(provider.id || `model-provider-${index}`), name: String(provider.name || provider.id || `Model provider ${index + 1}`), state: String(provider.state || provider.status || "UNKNOWN"), source: String(provider.source || "Model provider inventory"), ...provider })),
        { id: "models", name: "Local models", state: String((models.ollama as RecordRow | undefined)?.serviceReachable ? "REACHABLE" : "NOT_DETECTED"), source: "Local provider inventory" },
      ];
      setRows(next);
      setRaw({ platform, providers: providers.providers, models, projectCount: workspace.projects.length });
      setMessage("");
    } catch (error) {
      setRows([]);
      setRaw(null);
      setMessage(error instanceof Error ? error.message : "Diagnostics unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const grouped = useMemo(() => ({ available: rows.filter((row) => ["AVAILABLE", "READY", "REACHABLE", "CONNECTED"].includes(row.state.toUpperCase())).length, limited: rows.filter((row) => ["LIMITED", "EVIDENCE_DEPENDENT", "UNKNOWN"].includes(row.state.toUpperCase())).length, unavailable: rows.filter((row) => /UNAVAILABLE|NOT_DETECTED|NOT_CONFIGURED|BLOCKED|ERROR/.test(row.state.toUpperCase())).length }), [rows]);

  return <section className="space-y-4" aria-label="KForge System Diagnostics Control Center">
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">System Diagnostics</h2><p className="mt-1 text-xs text-muted-foreground">Measured capability inventory only. Missing tools remain UNAVAILABLE / NOT_DETECTED and evidence-dependent capabilities are never converted into success.</p></div><button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh diagnostics"}</button></header>

    <section className="grid gap-3 sm:grid-cols-3" aria-label="System diagnostics summary"><article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Available / reachable</span><strong className="mt-1 block text-lg">{grouped.available}</strong></article><article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Limited / evidence-dependent</span><strong className="mt-1 block text-lg">{grouped.limited}</strong></article><article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Unavailable / not detected</span><strong className="mt-1 block text-lg">{grouped.unavailable}</strong></article></section>

    <div className="kw-system-grid">{rows.map((row) => <article key={row.id}><div className="flex items-start gap-2"><strong className="mr-auto">{row.name}</strong><StatusBadge value={row.state} /></div><p className="mt-2 text-xs text-muted-foreground">{String(row.source || "Measured local evidence")}</p><dl className="mt-3 grid gap-1 text-xs">{Object.entries(row).filter(([key, value]) => !["id", "name", "state", "source"].includes(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))).slice(0, 6).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd>{value === null || value === "" ? "UNKNOWN" : String(value)}</dd></div>)}</dl><details className="mt-3"><summary>Diagnostic evidence</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></article>)}</div>

    {raw ? <AdvancedEvidence value={raw} label="Advanced · Raw system diagnostic sources" /> : null}
    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default SystemControlCenter;
