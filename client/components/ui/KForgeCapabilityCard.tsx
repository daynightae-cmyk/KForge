import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Check, AlertCircle, Clock, Shield, Zap, Wrench, Package, Plug, Cloud } from "lucide-react";
import type { MarketplaceItem, InspectorAction } from "../../workbench/surfaceContracts";

export type CapabilityCardProps = {
  item: MarketplaceItem;
  selected?: boolean;
  onSelect?: () => void;
  actions?: InspectorAction[];
  actionsDisabled?: boolean;
  className?: string;
};

const StatusIcon: React.FC<{ value?: string }> = ({ value }) => {
  if (!value) return null;
  const v = value.toUpperCase();
  if (v.includes("INSTALLED") || v.includes("AVAILABLE") || v.includes("PASS")) return <Check size={14} className="text-emerald-600" />;
  if (v.includes("UPDATE") || v.includes("READY")) return <Zap size={14} className="text-amber-600" />;
  if (v.includes("BLOCKED") || v.includes("FAILED")) return <AlertCircle size={14} className="text-rose-600" />;
  if (v.includes("RUNNING")) return <Clock size={14} className="text-blue-600" />;
  return <Shield size={14} className="text-slate-400" />;
};

const CategoryIcon: React.FC<{ category?: string }> = ({ category }) => {
  const c = (category || "").toLowerCase();
  if (c.includes("agent")) return <Zap size={18} />;
  if (c.includes("model")) return <Cloud size={18} />;
  if (c.includes("tool")) return <Wrench size={18} />;
  if (c.includes("extension")) return <Plug size={18} />;
  return <Package size={18} />;
};

export const KForgeCapabilityCard: React.FC<CapabilityCardProps> = ({
  item,
  selected,
  onSelect,
  actions,
  actionsDisabled,
  className,
}) => {
  const installed = item.installed === true;
  const updateAvailable = item.updateState?.state === "VERIFIED" && /^UPDATE_AVAILABLE\b/i.test(item.updateState.value || "");

  // Premium concise subset: only enabled actionable items are surfaced on the card.
  // Disabled policy remains in inspector matrix; card stays uncluttered.
  const visibleActions = useMemo(() => {
    if (!actions?.length) return [];
    const enabled = actions.filter((a) => !a.disabled && typeof a.invoke === "function");
    // Keep premium uncluttered: at most 4 primary actions on card
    // Priority: install (when not installed), then health/run/update, then manage, then uninstall
    const order: Record<string, number> = { install: 0, health: 1, run: 2, update: 3, manage: 4, uninstall: 5 };
    return enabled.sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));
  }, [actions]);

  return (
    <article
      role="article"
      tabIndex={0}
      aria-label={`${item.name}, ${item.category}`}
      data-item-id={item.id}
      data-selected={selected ? "true" : "false"}
      onClick={onSelect}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.currentTarget === e.target) { e.preventDefault(); onSelect?.(); } }}
      className={cn(
        "group relative rounded-xl border bg-card text-card-foreground shadow-sm transition-all kw-capability-card",
        "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "ring-2 ring-primary/40 border-primary/60" : "border-border",
        className
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 text-muted-foreground"><CategoryIcon category={item.category} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight tracking-tight truncate">{item.name}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{item.category}</span>
            <span>·</span>
            <span>{item.source || item.authority?.kind || "Unknown source"}</span>
            <span>·</span>
            <span>v{item.version || "version UNKNOWN"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusIcon value={installed ? "INSTALLED" : item.availability} />
          {updateAvailable && <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">Update</span>}
          {installed && <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">Installed</span>}
        </div>
      </div>
      <div className="px-4 pb-3">
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{item.description || item.overview || "No description supplied."}</p>
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Shield size={10} /> Trust: {item.trust === "TRUSTED" ? "TRUSTED" : item.trust === "UNTRUSTED" ? "UNTRUSTED" : item.trust === "PARTIALLY_TRUSTED" ? "PARTIALLY_TRUSTED" : item.trust ? item.trust : "NOT_EVALUATED"}</span>
          <span>·</span>
          <span>Compatibility: {item.projectCompatibility?.state || (item.projectCompatibility ? item.projectCompatibility.state : "NOT_EVALUATED")}</span>
          <span>·</span>
          <span>Integrity: {item.integrity?.state || "UNKNOWN"}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3 border-t bg-muted/20 min-h-[48px]">
        {visibleActions.length ? visibleActions.map((action) => {
          const visibleLabel = action.id === "install" ? "Install" : action.id === "manage" ? "Manage" : action.label;
          return (
          <button
            key={action.id}
            disabled={Boolean(actionsDisabled)}
            aria-label={visibleLabel}
            onClick={(e) => { e.stopPropagation(); if (action.invoke) action.invoke(); }}
            data-action-id={action.id}
            data-item-id={item.id}
            className={cn(
              "inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              action.id === "install" || action.id === "run" || action.id === "update" ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : action.id === "manage" ? "border-border bg-card hover:bg-accent hover:text-accent-foreground" : "border-border hover:bg-accent hover:text-accent-foreground",
              actionsDisabled ? "opacity-45 cursor-not-allowed" : ""
            )}
          >
            {visibleLabel}
          </button>
        )}) : <span className="text-[11px] text-muted-foreground">No actions available</span>}
      </div>
    </article>
  );
};
