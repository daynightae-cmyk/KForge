import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectSummary, WorkspaceActionDescriptor, WorkspaceResponse } from "@shared/workspace";
import { KForgeServiceCard } from "@/components/ui/KForgeServiceCard";
import { fetchJson } from "./api";
import { StatusBadge } from "./ui";
import { PROJECT_SERVICE_GROUPS, serviceByTarget, type WorkbenchService } from "./serviceDirectory";
import { resolveServiceState, type AvailabilityEvidence, type ProviderEvidence } from "./serviceAvailability";
import type { RecordRow } from "./surfaceContracts";

type Props = { project: ProjectSummary; workspace: WorkspaceResponse | null; onNavigate: (target: string) => void };

type PreviewResponse = { preview?: RecordRow };
type ActionResponse = { actions: WorkspaceActionDescriptor[] };
type ProviderResponse = { providers?: Array<RecordRow> };
type AgentToolResponse = { tools?: Array<RecordRow> };
type TaskResponse = { tasks?: Array<RecordRow> };

function providerEvidence(providers: Array<RecordRow> | undefined): ProviderEvidence[] {
  return (providers || []).map((provider) => ({
    id: String(provider.id || provider.providerId || "unknown"),
    configured: provider.hasKey === true || provider.configured === true || provider.keyConfigured === true || String(provider.state || "").toUpperCase() === "CONFIGURED",
    connected: provider.connected === true || String(provider.state || "").toUpperCase() === "CONNECTED",
  }));
}

/**
 * The canonical project service catalogue.
 *
 * Every card is a real service from the canonical service directory, every
 * state is derived from real evidence, and every action opens the surface
 * that owns the service. Nothing here is a shortcut into a second engine.
 */
export default function ServiceCatalogue({ project, workspace, onNavigate }: Props) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]);
  const [preview, setPreview] = useState<RecordRow | null>(null);
  const [providers, setProviders] = useState<ProviderEvidence[]>([]);
  const [agentTools, setAgentTools] = useState<{ total: number; blocked: number }>({ total: 0, blocked: 0 });
  const [lastTaskStatus, setLastTaskStatus] = useState<string | undefined>(undefined);
  const [previewResult, setPreviewResult] = useState<{ label: string; detail: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const base = `/api/workspace/projects/${encodeURIComponent(project.id)}`;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<ActionResponse>(`${base}/actions`).catch((): ActionResponse => ({ actions: [] })),
      fetchJson<PreviewResponse>(`${base}/preview`).catch((): PreviewResponse => ({})),
      fetchJson<ProviderResponse>("/api/workspace/ai/command-center/providers").catch((): ProviderResponse => ({})),
      fetchJson<AgentToolResponse>(`${base}/agent/tools`).catch((): AgentToolResponse => ({})),
      fetchJson<TaskResponse>("/api/workspace/tasks").catch((): TaskResponse => ({})),
    ]).then(([actionData, previewData, providerData, agentData, taskData]) => {
      if (cancelled) return;
      setActions(actionData.actions || []);
      setPreview(previewData.preview || null);
      setProviders(providerEvidence(providerData.providers));
      const tools = agentData.tools || [];
      setAgentTools({
        total: tools.length,
        blocked: tools.filter((tool) => tool.allowed === false || tool.permitted === false || String(tool.state || "").toUpperCase() === "BLOCKED").length,
      });
      const tasks = taskData.tasks || [];
      setLastTaskStatus(String(tasks[0]?.status || ""));
    });
    return () => { cancelled = true; };
  }, [base, project.id]);

  const evidence = useMemo<AvailabilityEvidence>(() => ({
    platformMode: workspace?.localPlatform.mode || "offline",
    project,
    actions,
    previewState: String(preview?.state || "IDLE"),
    previewDetail: String(preview?.error || (preview?.health as RecordRow | undefined)?.detail || ""),
    providers,
    agentToolCount: agentTools.total,
    agentBlockedCount: agentTools.blocked,
    lastTaskStatus,
  }), [actions, agentTools, lastTaskStatus, preview, project, providers, workspace]);

  const checkPreviewHealth = useCallback(async () => {
    setPreviewBusy(true);
    try {
      const result = await fetchJson<PreviewResponse>(`${base}/preview/health`, { method: "POST" });
      const health = (result.preview?.health as RecordRow | undefined) || result.preview || {};
      setPreviewResult({ label: "Preview health", detail: String(health.detail || health.status || health.state || "Health check returned no detail.") });
      setPreview((current) => ({ ...(current || {}), ...(result.preview || {}) }));
    } catch (error) {
      setPreviewResult({ label: "Preview health", detail: error instanceof Error ? error.message : "The Preview health check failed." });
    } finally {
      setPreviewBusy(false);
    }
  }, [base]);

  const groups = useMemo(() => PROJECT_SERVICE_GROUPS.map((group) => ({
    name: group.name,
    services: group.targets.map((target) => serviceByTarget(target)).filter((service): service is WorkbenchService => Boolean(service)),
  })).filter((group) => group.services.length), []);

  return <section className="kw-tool-grid" aria-label="Project service catalogue">
    <div className="kw-tool-grid__heading">
      <div><small>PROJECT SERVICES</small><h2>{project.name}</h2></div>
      <div><StatusBadge value={project.trust} /><code>{project.branch}</code></div>
    </div>
    <p className="kw-tool-grid__purpose">
      These are the services that act on the selected project. Every state below is derived from local evidence, and every
      action opens the surface that owns the service. Use <kbd>Ctrl</kbd>+<kbd>K</kbd> to search every KForge service.
    </p>
    {groups.map((group) => <section key={group.name} className="kw-tool-grid__group">
      <h3>{group.name}</h3>
      <div className="kw-tool-grid__cards">
        {group.services.map((service) => {
          const state = resolveServiceState(service, evidence);
          const isPreview = service.target === "developer-tools:preview";
          return <KForgeServiceCard
            key={service.target}
            title={service.label}
            category={`${service.activityLabel} · ${service.group || "Services"}`}
            icon={<service.icon size={15} aria-hidden="true" />}
            description={service.description}
            capability={service.capability}
            state={state}
            context={state.prerequisite}
            result={isPreview ? previewResult : null}
            primaryAction={{ id: "open", label: service.primaryAction, onInvoke: () => onNavigate(service.target) }}
            secondaryActions={isPreview ? [{ id: "preview-health", label: "Check health", disabled: previewBusy, onInvoke: () => void checkPreviewHealth() }] : undefined}
            dataAttributes={{ "data-service-target": service.target, "data-service-state": state.state }}
          />;
        })}
      </div>
    </section>)}
  </section>;
}
