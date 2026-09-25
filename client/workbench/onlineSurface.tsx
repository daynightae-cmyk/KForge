import "./online.css";
// Canonical evidence surface: uses explicit item.authority?.kind, item.availability, item.runtimeEvidence?.state, permission.required, p.required
import { useCallback, useEffect, useMemo, useState } from "react";
import type { InspectorAction, MarketplaceData, MarketplaceItem, RecordRow, SurfaceProps, TaskRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { Cloud, Search } from "lucide-react";
import { EmptyState, EvidenceCards, EvidenceRows, StatusBadge, TaskTable } from "./ui";
import { KForgeCapabilityCard } from "@/components/ui/KForgeCapabilityCard";
import { viewLabel } from "./navigation";

type LifecycleActionKind = "install" | "health" | "run" | "update" | "uninstall";

const lifecycleLabels: Record<LifecycleActionKind, string> = {
  install: "Install local package",
  health: "Health check",
  run: "Run local package",
  update: "Update local package",
  uninstall: "Uninstall local package",
};

function actionEligibility(item: MarketplaceItem, id: "install" | "manage") {
  return item.actionEligibility?.actions?.find((action) => action.id === id);
}

function lifecycleActions(item: MarketplaceItem, operate: (targetItem: MarketplaceItem, kind: LifecycleActionKind) => Promise<void>, onManage: (targetItem: MarketplaceItem) => void): InspectorAction[] {
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

  const networkActions: InspectorAction[] = [
    availability("install", isLocalPackage && !installed && installEligibility?.enabled === true, !isLocalPackage ? localPackageReason : installed ? "This verified local package is already installed." : installEligibility?.reason || item.unavailableReason || "No verified local package install adapter is available."),
    availability("health", isLocalPackage && installed && manageEligibility?.enabled === true, !isLocalPackage ? localPackageReason : managementReason),
    availability("run", isLocalPackage && installed && manageEligibility?.enabled === true && runtimeVerified, !isLocalPackage ? localPackageReason : !installed ? managementReason : !runtimeVerified ? "Runtime evidence has not verified that this installed package can run." : managementReason),
    availability("update", isLocalPackage && installed && manageEligibility?.enabled === true && updateAvailable, !isLocalPackage ? localPackageReason : !installed ? managementReason : !updateAvailable ? "No verified update is available for this installed local package." : managementReason),
    availability("uninstall", isLocalPackage && installed && manageEligibility?.enabled === true, !isLocalPackage ? localPackageReason : managementReason),
  ];

  const manageAction: InspectorAction = {
    id: "manage",
    label: "Manage",
    disabled: !installed || manageEligibility?.enabled !== true,
    reason: !installed ? managementReason : manageEligibility?.enabled !== true ? managementReason : undefined,
    invoke: installed && manageEligibility?.enabled === true ? () => onManage(item) : undefined,
  };

  return [...networkActions, manageAction];
}

function OnlineSurface({ view, project, onInspectorContext }: SurfaceProps) {
  const [market, setMarket] = useState<MarketplaceData>({});
  const [control, setControl] = useState<RecordRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading Online evidence…");
  const [operation, setOperation] = useState<RecordRow | null>(null);
  // Explicit MCP Registry discovery: never fetched by opening Online, only by
  // the Search button below. Results are remote catalog records (CATALOG),
  // never installed items; runtime capability stays unverified.
  const [mcpQuery, setMcpQuery] = useState("");
  const [mcpItems, setMcpItems] = useState<MarketplaceItem[]>([]);
  const [mcpEvidence, setMcpEvidence] = useState<RecordRow | null>(null);
  const [mcpSearched, setMcpSearched] = useState(false);
  const [mcpRunning, setMcpRunning] = useState(false);
  const [mcpError, setMcpError] = useState("");
  // Explicit Open VSX discovery: same contract as MCP above. Results are
  // remote catalog records (CATALOG); installation stays with the existing
  // Marketplace lifecycle and is not offered by read-only discovery.
  const [ovsxQuery, setOvsxQuery] = useState("");
  const [ovsxItems, setOvsxItems] = useState<MarketplaceItem[]>([]);
  const [ovsxEvidence, setOvsxEvidence] = useState<RecordRow | null>(null);
  const [ovsxSearched, setOvsxSearched] = useState(false);
  const [ovsxRunning, setOvsxRunning] = useState(false);
  const [ovsxError, setOvsxError] = useState("");
  // Explicit Hugging Face catalog discovery: same contract as MCP/Open VSX.
  // Results are CATALOG_ONLY, never installed models; local runtime matches
  // arrive as separate LOCAL evidence alongside the catalog records.
  const [hfQuery, setHfQuery] = useState("");
  const [hfItems, setHfItems] = useState<MarketplaceItem[]>([]);
  const [hfEvidence, setHfEvidence] = useState<RecordRow | null>(null);
  const [hfLocalMatches, setHfLocalMatches] = useState<Record<string, { matchedName?: string }>>({});
  const [hfSearched, setHfSearched] = useState(false);
  const [hfRunning, setHfRunning] = useState(false);
  const [hfError, setHfError] = useState("");
  // Explicit KForge update discovery: never checked by opening Online, only
  // by the Check button below. Availability is a catalog fact; trusted
  // install stays blocked by checksum/signature policy with stated reasons.
  const [updDecision, setUpdDecision] = useState<RecordRow | null>(null);
  const [updEvidence, setUpdEvidence] = useState<RecordRow | null>(null);
  const [updSearched, setUpdSearched] = useState(false);
  const [updRunning, setUpdRunning] = useState(false);
  const [updError, setUpdError] = useState("");
  // Explicit npm Registry discovery: same contract as others. Results are
  // remote catalog records (CATALOG), never installed packages.
  const [npmQuery, setNpmQuery] = useState("");
  const [npmItems, setNpmItems] = useState<MarketplaceItem[]>([]);
  const [npmEvidence, setNpmEvidence] = useState<RecordRow | null>(null);
  const [npmSearched, setNpmSearched] = useState(false);
  const [npmRunning, setNpmRunning] = useState(false);
  const [npmError, setNpmError] = useState("");
  const [pypiQuery, setPypiQuery] = useState("");
  const [pypiItems, setPypiItems] = useState<MarketplaceItem[]>([]);
  const [pypiEvidence, setPypiEvidence] = useState<RecordRow | null>(null);
  const [pypiSearched, setPypiSearched] = useState(false);
  const [pypiRunning, setPypiRunning] = useState(false);
  const [pypiError, setPypiError] = useState("");
  const [nugetQuery, setNugetQuery] = useState("");
  const [nugetItems, setNugetItems] = useState<MarketplaceItem[]>([]);
  const [nugetEvidence, setNugetEvidence] = useState<RecordRow | null>(null);
  const [nugetSearched, setNugetSearched] = useState(false);
  const [nugetRunning, setNugetRunning] = useState(false);
  const [nugetError, setNugetError] = useState("");
  const [wingetQuery, setWingetQuery] = useState("");
  const [wingetItems, setWingetItems] = useState<MarketplaceItem[]>([]);
  const [wingetEvidence, setWingetEvidence] = useState<RecordRow | null>(null);
  const [wingetSearched, setWingetSearched] = useState(false);
  const [wingetRunning, setWingetRunning] = useState(false);
  const [wingetError, setWingetError] = useState("");

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
  // authoritative in the canonical Inspector. Explicit MCP/Open VSX/HF/npm results
  // join the selection pool only when the retained id names one of them.
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || mcpItems.find((item) => item.id === selectedId) || ovsxItems.find((item) => item.id === selectedId) || hfItems.find((item) => item.id === selectedId) || npmItems.find((item) => item.id === selectedId) || pypiItems.find((item) => item.id === selectedId) || nugetItems.find((item) => item.id === selectedId) || wingetItems.find((item) => item.id === selectedId) || items[0] || null, [items, mcpItems, ovsxItems, hfItems, npmItems, pypiItems, nugetItems, wingetItems, selectedId]);
  const catalogView = !["providers", "remote-sources", "documentation", "downloads", "activity"].includes(view);
  const mcpPanel = ["discover", "marketplace", "agents", "tools"].includes(view);
  const ovsxPanel = ["discover", "marketplace", "extensions"].includes(view);
  const hfPanel = ["discover", "marketplace", "models"].includes(view);
  const updPanel = view === "updates";
  const npmPanel = ["discover", "marketplace", "tools", "integrations"].includes(view);
  const pypiPanel = ["discover", "marketplace", "tools", "integrations"].includes(view);
  const nugetPanel = ["discover", "marketplace", "tools", "integrations"].includes(view);
  const wingetPanel = ["discover", "marketplace", "tools", "integrations"].includes(view);

  const searchMcp = useCallback(async () => {
    setMcpRunning(true);
    setMcpError("");
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (mcpQuery.trim()) params.set("search", mcpQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; evidence?: RecordRow }>(`/api/workspace/remote-sources/mcp/servers?${params.toString()}`);
      setMcpItems(result.items || []);
      setMcpEvidence(result.evidence || null);
      setMcpSearched(true);
    } catch (error) {
      setMcpError(error instanceof Error ? error.message : "MCP Registry search failed.");
      setMcpSearched(true);
    } finally {
      setMcpRunning(false);
    }
  }, [mcpQuery]);

  const searchOvsx = useCallback(async () => {
    setOvsxRunning(true);
    setOvsxError("");
    try {
      const params = new URLSearchParams({ size: "20" });
      if (ovsxQuery.trim()) params.set("query", ovsxQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; evidence?: RecordRow }>(`/api/workspace/remote-sources/open-vsx/search?${params.toString()}`);
      setOvsxItems(result.items || []);
      setOvsxEvidence(result.evidence || null);
      setOvsxSearched(true);
    } catch (error) {
      setOvsxError(error instanceof Error ? error.message : "Open VSX search failed.");
      setOvsxSearched(true);
    } finally {
      setOvsxRunning(false);
    }
  }, [ovsxQuery]);

  const searchHf = useCallback(async () => {
    setHfRunning(true);
    setHfError("");
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (hfQuery.trim()) params.set("search", hfQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; localMatches?: Record<string, { matchedName?: string }>; evidence?: RecordRow }>(`/api/workspace/remote-sources/huggingface/models?${params.toString()}`);
      setHfItems(result.items || []);
      setHfLocalMatches(result.localMatches || {});
      setHfEvidence(result.evidence || null);
      setHfSearched(true);
    } catch (error) {
      setHfError(error instanceof Error ? error.message : "Hugging Face search failed.");
      setHfSearched(true);
    } finally {
      setHfRunning(false);
    }
  }, [hfQuery]);

  const checkUpdates = useCallback(async () => {
    setUpdRunning(true);
    setUpdError("");
    try {
      const result = await fetchJson<{ decision?: RecordRow; evidence?: RecordRow }>("/api/workspace/remote-sources/kforge-updates/status");
      setUpdDecision(result.decision || null);
      setUpdEvidence(result.evidence || null);
      setUpdSearched(true);
    } catch (error) {
      setUpdError(error instanceof Error ? error.message : "KForge update check failed.");
      setUpdSearched(true);
    } finally {
      setUpdRunning(false);
    }
  }, []);

  const searchNpm = useCallback(async () => {
    setNpmRunning(true);
    setNpmError("");
    try {
      const params = new URLSearchParams({ size: "20" });
      if (npmQuery.trim()) params.set("text", npmQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; evidence?: RecordRow }>(`/api/workspace/remote-sources/npm/search?${params.toString()}`);
      setNpmItems(result.items || []);
      setNpmEvidence(result.evidence || null);
      setNpmSearched(true);
    } catch (error) {
      setNpmError(error instanceof Error ? error.message : "npm Registry search failed.");
      setNpmSearched(true);
    } finally {
      setNpmRunning(false);
    }
  }, [npmQuery]);

  const searchPypi = useCallback(async () => {
    setPypiRunning(true);
    setPypiError("");
    try {
      const params = new URLSearchParams();
      if (pypiQuery.trim()) params.set("text", pypiQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; evidence?: RecordRow }>(`/api/workspace/remote-sources/pypi/search?${params.toString()}`);
      setPypiItems(result.items || []);
      setPypiEvidence(result.evidence || null);
      setPypiSearched(true);
    } catch (error) {
      setPypiError(error instanceof Error ? error.message : "PyPI search failed.");
      setPypiSearched(true);
    } finally {
      setPypiRunning(false);
    }
  }, [pypiQuery]);

  const searchNuget = useCallback(async () => {
    setNugetRunning(true);
    setNugetError("");
    try {
      const params = new URLSearchParams();
      if (nugetQuery.trim()) params.set("q", nugetQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; evidence?: RecordRow }>(`/api/workspace/remote-sources/nuget/search?${params.toString()}`);
      setNugetItems(result.items || []);
      setNugetEvidence(result.evidence || null);
      setNugetSearched(true);
    } catch (error) {
      setNugetError(error instanceof Error ? error.message : "NuGet search failed.");
      setNugetSearched(true);
    } finally {
      setNugetRunning(false);
    }
  }, [nugetQuery]);

  const searchWinget = useCallback(async () => {
    setWingetRunning(true);
    setWingetError("");
    try {
      const params = new URLSearchParams();
      if (wingetQuery.trim()) params.set("q", wingetQuery.trim());
      const result = await fetchJson<{ items?: MarketplaceItem[]; evidence?: RecordRow }>(`/api/workspace/remote-sources/winget/search?${params.toString()}`);
      setWingetItems(result.items || []);
      setWingetEvidence(result.evidence || null);
      setWingetSearched(true);
    } catch (error) {
      setWingetError(error instanceof Error ? error.message : "WinGet search failed.");
      setWingetSearched(true);
    } finally {
      setWingetRunning(false);
    }
  }, [wingetQuery]);

  const selectItem = useCallback((item: MarketplaceItem) => {
    setSelectedId(item.id);
    setOperation(null);
    // Manage is UI-only: focus canonical inspector without network request
    requestAnimationFrame(() => {
      const inspector = document.querySelector<HTMLElement>(".kw-inspector");
      inspector?.focus();
    });
  }, []);

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

  const actionsByItemId = useMemo(() => {
    return new Map([...items, ...mcpItems, ...ovsxItems, ...hfItems, ...npmItems, ...pypiItems, ...nugetItems, ...wingetItems].map((item) => [item.id, lifecycleActions(item, operate, selectItem)]));
  }, [items, mcpItems, ovsxItems, hfItems, npmItems, pypiItems, nugetItems, wingetItems, operate, selectItem]);

  const actions = useMemo(() => (selected ? actionsByItemId.get(selected.id) ?? [] : []), [actionsByItemId, selected]);

  useEffect(() => {
    if (!catalogView || !selected) {
      onInspectorContext?.(null);
      return;
    }
    onInspectorContext?.({ kind: "online-item", item: selected, title: selected.name, view, compatibility: project ? selected.projectCompatibility?.state : "NOT_EVALUATED", projectName: project?.name, actions, operation });
  }, [actions, catalogView, onInspectorContext, operation, project?.name, selected, view]);

  if (view === "providers" || view === "remote-sources") {
    const rows = view === "providers" ? [...(market.providers || []), ...(market.adapters || [])] : (market.adapters || []).filter((row) => row.kind === "remote");
    return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-toolbar"><h2>{viewLabel("online", view)}</h2><button onClick={() => void refresh()}>Refresh evidence</button></div><EvidenceCards rows={rows} /></section>;
  }
  if (view === "documentation") {
    return <section className="kw-online"><OnlineContext project={project} control={control} /><DocumentationPanel /></section>;
  }
  if (view === "downloads" || view === "activity") {
    const list = tasks.filter((task) => view === "downloads" ? /download|pull|install|update/i.test(JSON.stringify(task)) : /online|marketplace|download|install|update|provider/i.test(JSON.stringify(task)));
    return <section className="kw-online"><OnlineContext project={project} control={control} /><TaskTable tasks={list} /></section>;
  }

  const resultLabel = view === "discover" ? "recommended item(s)" : "result(s)";
  const mcpFreshness = mcpEvidence && typeof mcpEvidence.freshness === "string" ? mcpEvidence.freshness : mcpEvidence && typeof mcpEvidence.freshness === "object" ? JSON.stringify(mcpEvidence.freshness) : "";
  const ovsxFreshness = ovsxEvidence && typeof ovsxEvidence.freshness === "string" ? ovsxEvidence.freshness : ovsxEvidence && typeof ovsxEvidence.freshness === "object" ? JSON.stringify(ovsxEvidence.freshness) : "";
  const hfFreshness = hfEvidence && typeof hfEvidence.freshness === "string" ? hfEvidence.freshness : hfEvidence && typeof hfEvidence.freshness === "object" ? JSON.stringify(hfEvidence.freshness) : "";
  const hfMatchEntries = Object.entries(hfLocalMatches);
  return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search Online catalog" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{items.length} {resultLabel}</span><button onClick={() => void refresh()}>Refresh local evidence</button></div>{message && <p className="kw-message">{message}</p>}{items.length ? <div className="kw-online-layout"><div className="kw-online-results">{items.map((item) => (
  <KForgeCapabilityCard
    key={item.id}
    item={item}
    selected={selected?.id === item.id}
    onSelect={() => selectItem(item)}
    actions={actionsByItemId.get(item.id)}
    actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"}
  />
))}</div></div> : <EmptyState title={view === "updates" ? "No verified update evidence" : view === "discover" ? "No verified recommendations" : `No ${viewLabel("online", view).toLowerCase()} evidence`} detail={view === "updates" ? "Updates require installedVersion, verifiedLatestVersion and version comparison." : view === "discover" ? "Discover shows only items marked recommended by verified local catalog evidence." : "No verified source item matches this view."} />}{mcpPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>MCP Registry — explicit remote search</h2><button onClick={() => void searchMcp()} disabled={mcpRunning}>{mcpRunning ? "Searching…" : "Search MCP Registry"}</button></div><p className="kw-message">Read-only discovery from the Official MCP Registry. Opening Online never contacts it; this search runs only when you ask. Results are remote catalog records (CATALOG), not installed items; runtime capability stays unverified until a verified adapter proves it.</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search MCP Registry" value={mcpQuery} onChange={(event) => setMcpQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchMcp(); }} /></label><span>{mcpSearched ? `${mcpItems.length} remote result(s)` : "not searched"}</span></div>{mcpError && <p className="kw-message">{mcpError}</p>}{mcpEvidence && <p className="kw-message">Source: Official MCP Registry · Freshness: {String(mcpFreshness || (mcpEvidence.fromCache ? "CACHED" : "CURRENT"))}{mcpEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(mcpEvidence.destination || "https://registry.modelcontextprotocol.io")}</p>}{mcpSearched && !mcpItems.length && !mcpError && <p className="kw-message">No remote catalog records matched this query.</p>}{mcpItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{mcpItems.map((item) => (
  <KForgeCapabilityCard
    key={item.id}
    item={item}
    selected={selected?.id === item.id}
    onSelect={() => selectItem(item)}
    actions={actionsByItemId.get(item.id)}
    actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"}
  />
))}</div></div> : null}</div>}{ovsxPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>Open VSX — explicit remote search</h2><button onClick={() => void searchOvsx()} disabled={ovsxRunning}>{ovsxRunning ? "Searching…" : "Search Open VSX"}</button></div><p className="kw-message">Read-only discovery from the Open VSX Registry. Opening Online never contacts it; this search runs only when you ask. Results are remote catalog records (CATALOG), not installed extensions; installation requires the existing Marketplace lifecycle (immutable VSIX, expected integrity, compatibility, confirmation).</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search Open VSX Registry" value={ovsxQuery} onChange={(event) => setOvsxQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchOvsx(); }} /></label><span>{ovsxSearched ? `${ovsxItems.length} remote result(s)` : "not searched"}</span></div>{ovsxError && <p className="kw-message">{ovsxError}</p>}{ovsxEvidence && <p className="kw-message">Source: Open VSX Registry · Freshness: {String(ovsxFreshness || (ovsxEvidence.fromCache ? "CACHED" : "CURRENT"))}{ovsxEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(ovsxEvidence.destination || "https://open-vsx.org")}</p>}{ovsxSearched && !ovsxItems.length && !ovsxError && <p className="kw-message">No remote catalog records matched this query.</p>}{ovsxItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{ovsxItems.map((item) => (
  <KForgeCapabilityCard
    key={item.id}
    item={item}
    selected={selected?.id === item.id}
    onSelect={() => selectItem(item)}
    actions={actionsByItemId.get(item.id)}
    actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"}
  />
))}</div></div> : null}</div>}{hfPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>Hugging Face — explicit model catalog search</h2><button onClick={() => void searchHf()} disabled={hfRunning}>{hfRunning ? "Searching…" : "Search Hugging Face"}</button></div><p className="kw-message">Read-only discovery from the Hugging Face Hub. Opening Online never contacts it; this search runs only when you ask. Results are catalog records (CATALOG), not installed models; gated and private records stay blocked until valid auth and terms exist.</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search Hugging Face Hub" value={hfQuery} onChange={(event) => setHfQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchHf(); }} /></label><span>{hfSearched ? `${hfItems.length} remote result(s)` : "not searched"}</span></div>{hfError && <p className="kw-message">{hfError}</p>}{hfEvidence && <p className="kw-message">Source: Hugging Face Hub · Freshness: {String(hfFreshness || (hfEvidence.fromCache ? "CACHED" : "CURRENT"))}{hfEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(hfEvidence.destination || "https://huggingface.co")}</p>}{hfMatchEntries.length > 0 && <p className="kw-message">Local runtime matches (separate LOCAL evidence, not install proof): {hfMatchEntries.map(([modelId, match]) => `${modelId} ↔ ${match.matchedName || "unknown"}`).join("; ")}</p>}{hfSearched && !hfItems.length && !hfError && <p className="kw-message">No remote catalog records matched this query.</p>}{hfItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{hfItems.map((item) => (
  <KForgeCapabilityCard
    key={item.id}
    item={item}
    selected={selected?.id === item.id}
    onSelect={() => selectItem(item)}
    actions={actionsByItemId.get(item.id)}
    actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"}
  />
))}</div></div> : null}</div>}{updPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>KForge updates — explicit release discovery</h2><button onClick={() => void checkUpdates()} disabled={updRunning}>{updRunning ? "Checking…" : "Check for updates"}</button></div><p className="kw-message">Read-only discovery from the official KForge GitHub releases. Opening Online never contacts it; this check runs only when you ask. Availability is a catalog fact; trusted install stays blocked by checksum and signature policy with stated reasons. No silent auto-update or auto-install exists.</p>{updError && <p className="kw-message">{updError}</p>}{updDecision && <div><p className="kw-message">Installed: {String(updDecision.currentVersion || "UNKNOWN")} · Latest stable: {String((updDecision.latestStable as RecordRow | undefined)?.tag || "none")} · Latest prerelease: {String((updDecision.latestPrerelease as RecordRow | undefined)?.tag || "none")} · Availability: {String(updDecision.availability || "UNKNOWN")}</p><p className="kw-message">{String(updDecision.availabilityDetail || "")}</p><p className="kw-message">Trusted update: {String(updDecision.trustedUpdate || "BLOCKED")}</p>{Array.isArray(updDecision.trustedBlockers) && (updDecision.trustedBlockers as Array<{ detail?: string }>).length > 0 && <p className="kw-message">Blockers: {(updDecision.trustedBlockers as Array<{ detail?: string }>).map((blocker) => String(blocker.detail || "")).join(" ")}</p>}</div>}{updEvidence && <p className="kw-message">Source: KForge GitHub Releases · Freshness: {String(typeof updEvidence.freshness === "string" ? updEvidence.freshness : (updEvidence.fromCache ? "CACHED" : "CURRENT"))}{updEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(updEvidence.destination || "https://api.github.com")}</p>}{updSearched && !updDecision && !updError && <p className="kw-message">No update evidence was returned.</p>}</div>}{npmPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>npm Registry — explicit package search</h2><button onClick={() => void searchNpm()} disabled={npmRunning}>{npmRunning ? "Searching…" : "Search npm"}</button></div><p className="kw-message">Read-only discovery from the npm Public Registry. Opening Online never contacts it; this search runs only when you ask. Results are remote catalog records (CATALOG), not installed packages.</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search npm Registry" value={npmQuery} onChange={(event) => setNpmQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchNpm(); }} /></label><span>{npmSearched ? `${npmItems.length} remote result(s)` : "not searched"}</span></div>{npmError && <p className="kw-message">{npmError}</p>}{npmEvidence && <p className="kw-message">Source: npm Public Registry · Freshness: {String(typeof npmEvidence.freshness === "string" ? npmEvidence.freshness : (npmEvidence.fromCache ? "CACHED" : "CURRENT"))}{npmEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(npmEvidence.destination || "https://registry.npmjs.org")}</p>}{npmSearched && !npmItems.length && !npmError && <p className="kw-message">No remote catalog records matched this query.</p>}{npmItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{npmItems.map((item) => (<KForgeCapabilityCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => selectItem(item)} actions={actionsByItemId.get(item.id)} actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"} />))}</div></div> : null}</div>}{pypiPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>PyPI — explicit package lookup</h2><button onClick={() => void searchPypi()} disabled={pypiRunning}>{pypiRunning ? "Searching…" : "Lookup PyPI"}</button></div><p className="kw-message">Read-only lookup from the Python Package Index. Opening Online never contacts it; this lookup runs only when you ask. Results are remote catalog records (CATALOG), not installed packages. Enter an exact package name (e.g., requests).</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Lookup PyPI package" value={pypiQuery} onChange={(event) => setPypiQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPypi(); }} /></label><span>{pypiSearched ? `${pypiItems.length} remote result(s)` : "not searched"}</span></div>{pypiError && <p className="kw-message">{pypiError}</p>}{pypiEvidence && <p className="kw-message">Source: Python Package Index · Freshness: {String(typeof pypiEvidence.freshness === "string" ? pypiEvidence.freshness : (pypiEvidence.fromCache ? "CACHED" : "CURRENT"))}{pypiEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(pypiEvidence.destination || "https://pypi.org")}</p>}{pypiSearched && !pypiItems.length && !pypiError && <p className="kw-message">No remote catalog records matched this query.</p>}{pypiItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{pypiItems.map((item) => (<KForgeCapabilityCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => selectItem(item)} actions={actionsByItemId.get(item.id)} actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"} />))}</div></div> : null}</div>}{nugetPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>NuGet — explicit package search</h2><button onClick={() => void searchNuget()} disabled={nugetRunning}>{nugetRunning ? "Searching…" : "Search NuGet"}</button></div><p className="kw-message">Read-only discovery from nuget.org. Opening Online never contacts it; this search runs only when you ask. Results are remote catalog records (CATALOG), not installed packages.</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search NuGet" value={nugetQuery} onChange={(event) => setNugetQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchNuget(); }} /></label><span>{nugetSearched ? `${nugetItems.length} remote result(s)` : "not searched"}</span></div>{nugetError && <p className="kw-message">{nugetError}</p>}{nugetEvidence && <p className="kw-message">Source: nuget.org · Freshness: {String(typeof nugetEvidence.freshness === "string" ? nugetEvidence.freshness : (nugetEvidence.fromCache ? "CACHED" : "CURRENT"))}{nugetEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(nugetEvidence.destination || "https://api.nuget.org")}</p>}{nugetSearched && !nugetItems.length && !nugetError && <p className="kw-message">No remote catalog records matched this query.</p>}{nugetItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{nugetItems.map((item) => (<KForgeCapabilityCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => selectItem(item)} actions={actionsByItemId.get(item.id)} actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"} />))}</div></div> : null}</div>}{wingetPanel && <div className="kw-mcp"><div className="kw-toolbar"><h2>WinGet — explicit package ID lookup</h2><button onClick={() => void searchWinget()} disabled={wingetRunning}>{wingetRunning ? "Looking up…" : "Lookup WinGet"}</button></div><p className="kw-message">Read-only lookup from the WinGet community repository. Opening Online never contacts it; this lookup runs only when you ask. Enter an exact dotted package ID such as Git.Git. Community manifest presence is not publisher authenticity.</p><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Lookup WinGet package ID" placeholder="Git.Git" value={wingetQuery} onChange={(event) => setWingetQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchWinget(); }} /></label><span>{wingetSearched ? `${wingetItems.length} remote result(s)` : "not searched"}</span></div>{wingetError && <p className="kw-message">{wingetError}</p>}{wingetEvidence && <p className="kw-message">Source: WinGet Community Repository · Freshness: {String(typeof wingetEvidence.freshness === "string" ? wingetEvidence.freshness : (wingetEvidence.fromCache ? "CACHED" : "CURRENT"))}{wingetEvidence.fromCache ? " (cached)" : " (live)"} · Destination: {String(wingetEvidence.destination || "https://api.github.com")}</p>}{wingetSearched && !wingetItems.length && !wingetError && <p className="kw-message">No remote catalog records matched this query.</p>}{wingetItems.length ? <div className="kw-online-layout"><div className="kw-online-results">{wingetItems.map((item) => (<KForgeCapabilityCard key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => selectItem(item)} actions={actionsByItemId.get(item.id)} actionsDisabled={operation?.itemId === item.id && operation?.state === "RUNNING"} />))}</div></div> : null}</div>}</section>;
}

function OnlineContext({ project, control }: { project?: ProjectSummary; control: RecordRow | null }) {
  return <div className="kw-online-context"><div><Cloud size={17} /><strong>Online is global</strong><span>Opening this surface performs no remote catalog refresh.</span></div><div><span>Compatibility</span><StatusBadge value={project ? "PROJECT_CONTEXT" : "NOT_EVALUATED"} /><small>{project ? project.name : "No project selected"}</small></div><div><span>Control Center</span><StatusBadge value={control?.mode || "UNKNOWN"} /><small>{control ? "Policy evidence loaded" : "Loading policy evidence"}</small></div></div>;
}

type DocsSource = {
  id: string;
  provider: string;
  kind: string;
  title: string;
  url: string;
  version?: string;
  licenseTerms: string;
  authority: string;
};

type DocsRecord = {
  sourceId: string;
  provider: string;
  canonicalUrl: string;
  title: string;
  version: string;
  retrievedAt: string;
  etag?: string;
  lastModified?: string;
  contentHash: string;
  contentType?: string;
  sizeBytes: number;
  authority: string;
  licenseTerms: string;
  origin: "LIVE" | "CACHE";
  freshness: "CURRENT" | "CACHED" | "STALE";
};

type DocsHit = {
  sourceId: string;
  provider: string;
  title: string;
  canonicalUrl: string;
  version: string;
  freshness: string;
  matchCount: number;
  truncated: boolean;
  snippets: string[];
};

/**
 * Online Documentation: explicit provider-document reads over the
 * allowlisted documentation framework. Opening this view performs no
 * remote fetch; each source refreshes only on its own button, and search
 * reads the bounded local cache. There is no general crawler and no
 * arbitrary URL fetcher.
 */
function DocumentationPanel() {
  const [sources, setSources] = useState<DocsSource[]>([]);
  const [records, setRecords] = useState<Record<string, DocsRecord>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DocsHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [message, setMessage] = useState("Loading approved documentation sources…");

  useEffect(() => {
    void fetchJson<{ sources?: DocsSource[] }>("/api/workspace/remote-sources/documentation/sources")
      .then((data) => { setSources(data.sources || []); setMessage(""); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Documentation sources unavailable."));
  }, []);

  const refreshSource = useCallback(async (sourceId: string) => {
    setRefreshing((current) => ({ ...current, [sourceId]: true }));
    setErrors((current) => ({ ...current, [sourceId]: "" }));
    try {
      const result = await fetchJson<{ record?: DocsRecord }>("/api/workspace/remote-sources/documentation/refresh", jsonRequest({ sourceId }));
      if (result.record) setRecords((current) => ({ ...current, [sourceId]: result.record as DocsRecord }));
    } catch (error) {
      setErrors((current) => ({ ...current, [sourceId]: error instanceof Error ? error.message : "Refresh failed." }));
    } finally {
      setRefreshing((current) => ({ ...current, [sourceId]: false }));
    }
  }, []);

  const searchDocs = useCallback(async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const result = await fetchJson<{ hits?: DocsHit[] }>(`/api/workspace/remote-sources/documentation/search?q=${encodeURIComponent(query.trim())}`);
      setHits(result.hits || []);
      setSearched(true);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Documentation search failed.");
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }, [query, searching]);

  return <div><div className="kw-toolbar"><h2>Documentation</h2></div><p className="kw-message">Official provider documents only: OpenAPI contracts and same-provider llms.txt from an exact allowlist. Opening this view performs no remote fetch; each source refreshes on its own button, and search reads the bounded local cache.</p>{message && <p className="kw-message">{message}</p>}{sources.map((source) => {
    const record = records[source.id];
    const busy = refreshing[source.id] === true;
    return <div className="kw-mcp" key={source.id}><div className="kw-toolbar"><h2>{source.provider} — {source.title}</h2><button onClick={() => void refreshSource(source.id)} disabled={busy}>{busy ? "Refreshing…" : record ? "Refresh again" : "Refresh now"}</button></div><p className="kw-message">Kind: {source.kind} · Authority: {source.authority} · License: {source.licenseTerms}</p><p className="kw-message">Canonical URL: {source.url}</p>{errors[source.id] && <p className="kw-message">{errors[source.id]}</p>}{record && <div><p className="kw-message">Version: {record.version} · Freshness: {record.freshness}{record.origin === "CACHE" ? " (cached)" : " (live)"} · Size: {record.sizeBytes} bytes · Retrieved: {record.retrievedAt}</p><p className="kw-message">SHA-256: {record.contentHash}{record.etag ? ` · ETag: ${record.etag}` : ""}{record.lastModified ? ` · Last-Modified: ${record.lastModified}` : ""}</p></div>}</div>;
  })}<div className="kw-mcp"><div className="kw-toolbar"><h2>Search cached documentation</h2><button onClick={() => void searchDocs()} disabled={searching || !query.trim()}>{searching ? "Searching…" : "Search cache"}</button></div><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search cached documentation" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchDocs(); }} /></label><span>{searched ? `${hits.length} source(s) matched` : "local cache only"}</span></div>{searchError && <p className="kw-message">{searchError}</p>}{searched && !hits.length && !searchError && <p className="kw-message">No cached document matched. Refresh a source explicitly, then search again.</p>}{hits.map((hit) => <div key={hit.sourceId}><p className="kw-message">{hit.provider} — {hit.title} (v{hit.version}, {hit.freshness}, {hit.matchCount} match{hit.matchCount === 1 ? "" : "es"}{hit.truncated ? ", truncated" : ""})</p>{hit.snippets.map((snippet, index) => <p className="kw-message" key={`${hit.sourceId}:${index}`}>{snippet}</p>)}</div>)}</div></div>;
}

export default OnlineSurface;
