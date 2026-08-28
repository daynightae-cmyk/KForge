import { useCallback, useEffect, useMemo, useState } from "react";
import type { InspectorAction, MarketplaceData, MarketplaceItem, RecordRow, SurfaceProps, TaskRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { Cloud, Search } from "lucide-react";
import { EmptyState, EvidenceCards, EvidenceRows, StatusBadge, TaskTable } from "./ui";
import { KForgeCapabilityCard } from "@/components/ui/KForgeCapabilityCard";
import { viewLabel } from "./navigation";

type LifecycleActionKind = "install" | "health" | "run" | "update" | "uninstall" | "manage";

const lifecycleLabels: Record<LifecycleActionKind, string> = {
  install: "Install local package",
  health: "Health check",
  run: "Run local package",
  update: "Update local package",
  uninstall: "Uninstall local package",
  manage: "Manage package",
};

function actionEligibility(item: MarketplaceItem, id: "install" | "manage") {
  return item.actionEligibility?.actions?.find((action) => action.id === id);
}

function lifecycleActions(item: MarketplaceItem, operate: (targetItem: MarketplaceItem, kind: LifecycleActionKind) => Promise<void>): InspectorAction[] {
  const isLocalPackage = item.id.startsWith("package:");
  const installed = item.installed === true;
  const installEligibility = actionEligibility(item, "install");
  const manageEligibility = actionEligibility(item, "manage");
  const localPackageReason = "Lifecycle actions are available only for verified local packages.";
  const managementReason = manageEligibility?.reason || "The package is not installed with a verified local management adapter.";
  const runtimeVerified = item.runtimeEvidence?.state === "VERIFIED";
  const updateAvailable = item.updateState?.state === "VERIFIED" && /^UPDATE_AVAILABLE\b/i.test(item.updateState.value || "");
  const availability = (id: LifecycleActionKind, enabled: boolean, reason: string): InspectorAction => ({
    id,
    label: lifecycleLabels[id],
    disabled: !enabled,
    reason: enabled ? undefined : reason,
    invoke: enabled ? () => { void operate(item, id); } : undefined,
  });

  return [
    availability("install", isLocalPackage && !installed && installEligibility?.enabled === true, !isLocalPackage ? localPackageReason : installed ? "This verified local package is already installed." : installEligibility?.reason || item.unavailableReason || "No verified local package install adapter is available."),
    availability("health", isLocalPackage && installed && manageEligibility?.enabled === true, !isLocalPackage ? localPackageReason : managementReason),
    availability("run", isLocalPackage && installed && manageEligibility?.enabled === true && runtimeVerified, !isLocalPackage ? localPackageReason : !installed ? managementReason : !runtimeVerified ? "Runtime evidence has not verified that this installed package can run." : managementReason),
    availability("update", isLocalPackage && installed && manageEligibility?.enabled === true && updateAvailable, !isLocalPackage ? localPackageReason : !installed ? managementReason : !updateAvailable ? "No verified update is available for this installed local package." : managementReason),
    availability("uninstall", isLocalPackage && installed && manageEligibility?.enabled === true, !isLocalPackage ? localPackageReason : managementReason),
  ];
}

function OnlineSurface({ view, project, onInspectorContext }: SurfaceProps) {
  const [market, setMarket] = useState<MarketplaceData>({});
  const [control, setControl] = useState<RecordRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading Online evidence…");
  const [operation, setOperation] = useState<RecordRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextMarket, nextControl, nextTasks] = await Promise.all([
        fetchJson<MarketplaceData>(project ? `/api/workspace/projects/${encodeURIComponent(project.id)}/marketplace` : "/api/workspace/marketplace"),
        fetchJson<RecordRow>("/api/workspace/online/control-center"),
        fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks"),
      ]);
      setMarket(nextMarket);
      setControl(nextControl);
      setTasks(nextTasks.tasks || []);
      setSelectedId((currentId) => currentId && nextMarket.items?.some((item) => item.id === currentId) ? currentId : nextMarket.items?.[0]?.id || "");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Online evidence failed.");
    }
  }, [project?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const items = useMemo(() => {
    let list = market.items || [];
    if (view === "discover") list = list.filter((item) => (item.features || []).includes("recommended"));
    if (view === "extensions") list = list.filter((item) => item.taxonomy?.includes("extensions"));
    if (view === "models") list = list.filter((item) => item.category === "models");
    if (view === "agents") list = list.filter((item) => item.category === "agents");
    if (view === "tools") list = list.filter((item) => item.category === "tools");
    if (view === "integrations") list = list.filter((item) => item.taxonomy?.includes("integrations"));
    if (view === "installed") list = list.filter((item) => item.installed);
    if (view === "updates") list = list.filter((item) => item.updateState?.state === "VERIFIED" && /UPDATE_AVAILABLE/i.test(item.updateState.value || ""));
    if (view === "security") list = list.filter((item) => item.trust !== "TRUSTED" || (item.permissions || []).some((permission) => permission.required) || ["REMOTE_REGISTRY", "CACHED_REMOTE"].includes(item.authority?.kind || ""));
    return list.filter((item) => `${item.name} ${item.description || ""} ${item.source || ""} ${(item.capabilities || []).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  }, [market, view, query]);

  // The visible semantic view is the sole authority for selection. A retained id
  // may be valid in the global catalog but must not keep a hidden prior-view item
  // authoritative in the canonical Inspector.
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0] || null, [items, selectedId]);
  const catalogView = !["providers", "remote-sources", "downloads", "activity"].includes(view);

  const operate = useCallback(async (targetItem: MarketplaceItem, kind: LifecycleActionKind) => {
    if (!targetItem) return;
    const destructive = ["install", "run", "update", "uninstall"].includes(kind);
    if (destructive && !window.confirm(`${kind} ${targetItem.name}? Review the displayed authority, integrity, permissions and trust evidence first.`)) return;
    setOperation({ state: "RUNNING", operation: kind, itemId: targetItem.id });
    try {
      const url = `/api/workspace/marketplace/items/${encodeURIComponent(targetItem.id)}/${kind}`;
      const result = kind === "health" ? await fetchEvidence(url) : await fetchEvidence(url, jsonRequest({ confirmed: true }));
      if (!result.ok) throw new Error(String(result.data.error || result.data.message || `${kind} failed with HTTP ${result.status}.`));
      setOperation({ state: "SUCCESS", operation: kind, status: result.status, itemId: targetItem.id, ...result.data });
      await refresh();
    } catch (error) {
      setOperation({ state: "FAILED", operation: kind, itemId: targetItem.id, error: error instanceof Error ? error.message : "Operation failed" });
    }
  }, [refresh]);

  const actions = useMemo(() => selected ? lifecycleActions(selected, operate) : [], [operate, selected]);

  useEffect(() => {
    if (!catalogView || !selected) {
      onInspectorContext?.(null);
      return;
    }
    onInspectorContext?.({ kind: "online-item", item: selected, title: selected.name, view, compatibility: project ? selected.projectCompatibility?.state : "NOT_EVALUATED", projectName: project?.name, actions, operation });
  }, [actions, catalogView, onInspectorContext, operation, project?.name, selected, view]);

  const selectItem = (item: MarketplaceItem) => {
    setSelectedId(item.id);
    setOperation(null);
  };

  if (view === "providers" || view === "remote-sources") {
    const rows = view === "providers" ? [...(market.providers || []), ...(market.adapters || [])] : (market.adapters || []).filter((row) => row.kind === "remote");
    return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-toolbar"><h2>{viewLabel("online", view)}</h2><button onClick={() => void refresh()}>Refresh evidence</button></div><EvidenceCards rows={rows} /></section>;
  }
  if (view === "downloads" || view === "activity") {
    const list = tasks.filter((task) => view === "downloads" ? /download|pull|install|update/i.test(JSON.stringify(task)) : /online|marketplace|download|install|update|provider/i.test(JSON.stringify(task)));
    return <section className="kw-online"><OnlineContext project={project} control={control} /><TaskTable tasks={list} /></section>;
  }

  const resultLabel = view === "discover" ? "recommended item(s)" : "result(s)";
  return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search Online catalog" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{items.length} {resultLabel}</span><button onClick={() => void refresh()}>Refresh local evidence</button></div>{message && <p className="kw-message">{message}</p>}{items.length ? <div className="kw-online-layout"><div className="kw-online-results">{items.map((item) => (
  <KForgeCapabilityCard
    key={item.id}
    item={item}
    selected={selected?.id === item.id}
    onSelect={() => selectItem(item)}
    actions={selected?.id === item.id ? actions : undefined}
    actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"}
  />
))}</div></div> : <EmptyState title={view === "updates" ? "No verified update evidence" : view === "discover" ? "No verified recommendations" : `No ${viewLabel("online", view).toLowerCase()} evidence`} detail={view === "updates" ? "Updates require installedVersion, verifiedLatestVersion and version comparison." : view === "discover" ? "Discover shows only items marked recommended by verified local catalog evidence." : "No verified source item matches this view."} />}</section>;
}

function OnlineContext({ project, control }: { project?: ProjectSummary; control: RecordRow | null }) {
  return <div className="kw-online-context"><div><Cloud size={17} /><strong>Online is global</strong><span>Opening this surface performs no remote catalog refresh.</span></div><div><span>Compatibility</span><StatusBadge value={project ? "PROJECT_CONTEXT" : "NOT_EVALUATED"} /><small>{project ? project.name : "No project selected"}</small></div><div><span>Control Center</span><StatusBadge value={control?.mode || "UNKNOWN"} /><small>{control ? "Policy evidence loaded" : "Loading policy evidence"}</small></div></div>;
}

export default OnlineSurface;
