import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import type { RecordRow } from "./surfaceContracts";
import { fetchJson } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type PermissionClass = "read-only" | "safe" | "safe-write" | "dangerous" | "blocked";
type ToolStatus = "AVAILABLE" | "AVAILABLE_WITH_CONFIRMATION" | "UNAVAILABLE" | "BLOCKED" | "ERROR";

type ToolEvidence = {
  name: string;
  permission?: PermissionClass | string;
  status?: ToolStatus | string;
  description?: string;
  requiresConfirmation?: boolean;
  unavailableReason?: string;
  runtimeError?: string;
  evidence?: {
    definition?: string;
    handler?: string;
    permission?: string;
    runtime?: string;
    projectPrerequisite?: string;
    actionEligibility?: string;
  };
};

type ToolsResponse = {
  projectId: string;
  tools: ToolEvidence[];
  permissions?: RecordRow;
};

const permissionOrder: PermissionClass[] = ["read-only", "safe", "safe-write", "dangerous", "blocked"];

function SystemPermissionsCenter({ project }: { project?: ProjectSummary }) {
  const [data, setData] = useState<ToolsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [permission, setPermission] = useState("all");
  const [status, setStatus] = useState("all");
  const projectId = project?.id || "";

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetchJson<ToolsResponse>(`/api/workspace/projects/${encodeURIComponent(projectId)}/agent/tools`);
      setData(response);
    } catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : "Permission evidence unavailable.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setData(null);
    setQuery("");
    setPermission("all");
    setStatus("all");
    void load();
  }, [load, projectId]);

  const tools = data?.tools || [];
  const counts = useMemo(() => {
    const byPermission = Object.fromEntries(permissionOrder.map((entry) => [entry, tools.filter((tool) => tool.permission === entry).length])) as Record<PermissionClass, number>;
    return {
      byPermission,
      available: tools.filter((tool) => tool.status === "AVAILABLE").length,
      confirmation: tools.filter((tool) => tool.status === "AVAILABLE_WITH_CONFIRMATION").length,
      unavailable: tools.filter((tool) => tool.status === "UNAVAILABLE").length,
      blocked: tools.filter((tool) => tool.status === "BLOCKED").length,
      error: tools.filter((tool) => tool.status === "ERROR").length,
    };
  }, [tools]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (permission !== "all" && tool.permission !== permission) return false;
      if (status !== "all" && tool.status !== status) return false;
      if (!needle) return true;
      return [tool.name, tool.permission, tool.status, tool.description, tool.unavailableReason, tool.runtimeError, tool.evidence?.handler, tool.evidence?.runtime]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [permission, query, status, tools]);

  if (!project) return <EmptyState title="No project selected" detail="Permissions are derived from the selected project, its trust state, detected commands, and registered KForge handlers." />;
  if (loading && !data) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading project permission evidence…</div>;

  return <section className="space-y-4" aria-label="KForge Permissions Center" data-project-trust={project.trust} data-tool-count={tools.length}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Permissions Center</h2>
        <p className="mt-1 text-xs text-muted-foreground">Observed authority only. KForge derives each tool state from its verified definition, registered handler, project trust, and detected runtime prerequisites. This surface never grants authority or executes a tool.</p>
      </div>
      <StatusBadge value={project.trust} />
      <button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh evidence"}</button>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Permission class summary">
      {permissionOrder.map((entry) => <article key={entry} className="rounded-lg border bg-card p-3 text-xs" data-permission-summary={entry}>
        <div className="flex items-center gap-2"><strong className="mr-auto">{entry}</strong><span>{counts.byPermission[entry]}</span></div>
        <p className="mt-2 text-muted-foreground">{entry === "read-only" ? "Bounded local inspection; remains usable without project execution trust when its handler exists." : entry === "safe" ? "Local bounded execution; project trust and runtime prerequisites still apply." : entry === "safe-write" ? "May modify project state and requires explicit review/confirmation plus a registered handler." : entry === "dangerous" ? "High-impact authority; confirmation is mandatory and autonomous execution is not implied." : "Explicitly denied by KForge policy."}</p>
      </article>)}
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Permission eligibility summary">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Current eligibility</h3><span className="text-xs text-muted-foreground">{tools.length} verified definition(s)</span></div>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
        <div><dt className="text-muted-foreground">Available now</dt><dd>{counts.available}</dd></div>
        <div><dt className="text-muted-foreground">Confirmation-gated</dt><dd>{counts.confirmation}</dd></div>
        <div><dt className="text-muted-foreground">Unavailable</dt><dd>{counts.unavailable}</dd></div>
        <div><dt className="text-muted-foreground">Policy blocked</dt><dd>{counts.blocked}</dd></div>
        <div><dt className="text-muted-foreground">Runtime errors</dt><dd>{counts.error}</dd></div>
      </dl>
      <p className="mt-3 text-[11px] text-muted-foreground">A permission class is not the same as present eligibility. For example, a safe tool can still be UNAVAILABLE because the project is untrusted or no matching command was detected.</p>
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Permission matrix">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_190px_210px]">
        <label className="text-xs">Search tools<input aria-label="Search permission tools" className="mt-1 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="name, status, handler, runtime…" /></label>
        <label className="text-xs">Permission<select aria-label="Permission class filter" className="mt-1 w-full" value={permission} onChange={(event) => setPermission(event.target.value)}><option value="all">All classes</option>{permissionOrder.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
        <label className="text-xs">Eligibility<select aria-label="Permission status filter" className="mt-1 w-full" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All states</option>{["AVAILABLE", "AVAILABLE_WITH_CONFIRMATION", "UNAVAILABLE", "BLOCKED", "ERROR"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead><tr className="border-b"><th className="p-2">Tool</th><th className="p-2">Permission</th><th className="p-2">Eligibility</th><th className="p-2">Handler</th><th className="p-2">Runtime</th><th className="p-2">Confirmation</th><th className="p-2">Evidence / reason</th></tr></thead>
          <tbody>{filtered.map((tool) => <tr key={tool.name} className="border-b align-top" data-tool-name={tool.name} data-tool-permission={tool.permission || "UNKNOWN"} data-tool-status={tool.status || "UNKNOWN"}>
            <td className="p-2"><strong>{tool.name}</strong><p className="mt-1 max-w-[260px] text-muted-foreground">{tool.description || "No description."}</p></td>
            <td className="p-2"><StatusBadge value={tool.permission || "UNKNOWN"} /></td>
            <td className="p-2"><StatusBadge value={tool.status || "UNKNOWN"} /></td>
            <td className="p-2">{tool.evidence?.handler || "UNKNOWN"}</td>
            <td className="p-2">{tool.evidence?.runtime || "UNKNOWN"}</td>
            <td className="p-2">{tool.requiresConfirmation || tool.evidence?.permission === "REQUIRES_CONFIRMATION" ? "REQUIRED" : tool.evidence?.permission === "BLOCKED" ? "BLOCKED" : "NOT_REQUIRED"}</td>
            <td className="p-2"><span>{tool.unavailableReason || tool.runtimeError || tool.evidence?.projectPrerequisite || "Eligible from current verified evidence."}</span></td>
          </tr>)}</tbody>
        </table>
        {!filtered.length ? <p className="py-6 text-center text-xs text-muted-foreground">No registered tool matches the current permission filters.</p> : null}
      </div>
    </section>

    <section className="rounded-lg border bg-card p-4" aria-label="Permission safety contract">
      <h3 className="text-sm font-semibold">Authority contract</h3>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
        <article className="rounded-md border p-3"><strong>Trust is separate</strong><p className="mt-1 text-muted-foreground">Project trust is managed only in Trust Center. Permissions does not silently promote UNAVAILABLE tools.</p></article>
        <article className="rounded-md border p-3"><strong>Confirmation is separate</strong><p className="mt-1 text-muted-foreground">A confirmation requirement is evidence of an additional gate, not proof that a write handler exists or will execute.</p></article>
        <article className="rounded-md border p-3"><strong>Network is separate</strong><p className="mt-1 text-muted-foreground">This center performs only the local permission-evidence GET. It does not contact GitHub, registries, or cloud AI providers.</p></article>
      </div>
      <div className="mt-4"><AdvancedEvidence value={{ project: { id: project.id, name: project.name, path: project.path, trust: project.trust }, permissions: data?.permissions || {}, tools }} label="Advanced · Raw permission evidence" /></div>
    </section>

    {message ? <p className="kw-message" role="status">{message}</p> : null}
  </section>;
}

export default SystemPermissionsCenter;
