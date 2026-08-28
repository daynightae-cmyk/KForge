import React from "react";
import { cn } from "@/lib/utils";
import { Check, AlertCircle, Clock, Shield, Zap, Wrench, Package, Plug, Cloud } from "lucide-react";
import type { MarketplaceItem } from "../../workbench/surfaceContracts";

export type CapabilityCardProps = {
  item: MarketplaceItem;
  selected?: boolean;
  onSelect?: () => void;
  onInstall?: () => void;
  onUpdate?: () => void;
  onHealth?: () => void;
  onRun?: () => void;
  onManage?: () => void;
  onUninstall?: () => void;
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
  onInstall,
  onUpdate,
  onHealth,
  onRun,
  onManage,
  onUninstall,
  actionsDisabled,
  className,
}) => {
  const installed = item.installed === true;
  const updateAvailable = item.updateState?.state === "VERIFIED" && /^UPDATE_AVAILABLE\b/i.test(item.updateState.value || "");
  const hasManage = item.actionEligibility?.actions?.some((a) => a.id === "manage" && a.enabled);
  const hasHealth = item.actionEligibility?.actions?.some((a) => a.id === "health" && a.enabled);
  const hasRun = item.actionEligibility?.actions?.some((a) => a.id === "run" && a.enabled);

  return (
    <article
      role="article"
      tabIndex={0}
      aria-label={`${item.name}, ${item.category}`}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect?.(); }}
      className={cn(
        "group relative rounded-xl border bg-card text-card-foreground shadow-sm transition-all",
        "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "ring-2 ring-primary/40 border-primary/60" : "border-border",
        className
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 text-muted-foreground"><CategoryIcon category={item.category} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight tracking-tight truncate">{item.name}</h3>
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
          <span className="inline-flex items-center gap-1"><Shield size={10} /> Trust: {item.trust || "UNTRUSTED"}</span>
          <span>·</span>
          <span>Compatibility: {item.projectCompatibility?.state || (item.projectCompatibility ? item.projectCompatibility.state : "NOT_EVALUATED")}</span>
          <span>·</span>
          <span>Integrity: {item.integrity?.state || "UNKNOWN"}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3 border-t bg-muted/20">
        {!installed && item.actionEligibility?.actions?.some((a) => a.id === "install" && a.enabled) && (
          <button disabled={actionsDisabled} onClick={(e) => { e.stopPropagation(); onInstall?.(); }} className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Install</button>
        )}
        {installed && hasManage && (
          <>
            <button disabled={actionsDisabled} onClick={(e) => { e.stopPropagation(); onHealth?.(); }} className="inline-flex items-center justify-center rounded-md border border-border hover:bg-accent hover:text-accent-foreground h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Health</button>
            {hasRun && <button disabled={actionsDisabled} onClick={(e) => { e.stopPropagation(); onRun?.(); }} className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Run</button>}
          </>
        )}
        {updateAvailable && (
          <button disabled={actionsDisabled} onClick={(e) => { e.stopPropagation(); onUpdate?.(); }} className="inline-flex items-center justify-center rounded-md bg-amber-600 text-white hover:bg-amber-700 h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Update</button>
        )}
        {installed && hasManage && (
          <button disabled={actionsDisabled} onClick={(e) => { e.stopPropagation(); onManage?.(); }} className="inline-flex items-center justify-center rounded-md border border-border hover:bg-accent hover:text-accent-foreground h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Manage</button>
        )}
        {installed && item.actionEligibility?.actions?.some((a) => a.id === "uninstall" && a.enabled) && (
          <button disabled={actionsDisabled} onClick={(e) => { e.stopPropagation(); onUninstall?.(); }} className="inline-flex items-center justify-center rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Uninstall</button>
        )}
      </div>
    </article>
  );
};
