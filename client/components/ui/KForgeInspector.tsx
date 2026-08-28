import React from "react";
import { cn } from "@/lib/utils";
import { Shield, Zap, Clock, AlertCircle, Check, Wrench, Package, Plug, Cloud, ChevronDown } from "lucide-react";
import { StatusBadge, AdvancedEvidence } from "../../workbench/ui";
import type { InspectorContext } from "../../workbench/surfaceContracts";

export function KForgeInspector({ context, operation }: { context: InspectorContext | null; operation?: Record<string, unknown> | null }) {
  if (!context || !context.item) {
    return (
      <aside className="kw-inspector" aria-label="Inspector">
        <div className="p-6">
          <p className="text-sm text-muted-foreground">Select an item to inspect its lifecycle, runtime evidence, and permissions.</p>
        </div>
      </aside>
    );
  }
  const item = context.item;
  const actions = context.actions || [];
  return (
    <aside className="kw-inspector" aria-label={`Inspector for ${context.title || item.name}`}>
      <div className="p-5 border-b">
        <div className="flex items-start gap-3">
          <h2 className="text-base font-semibold tracking-tight leading-snug">{context.title || item.name}</h2>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge value={item.installed ? "INSTALLED" : item.availability || "UNKNOWN"} />
            {context.compatibility && <StatusBadge value={context.compatibility || "NOT_EVALUATED"} />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{item.category} · {item.version ? `v${item.version}` : "version UNKNOWN"}</p>
        <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Shield size={10} /> Trust: {item.trust || "UNTRUSTED"}</span>
          <span>·</span>
          <span>Integrity: {item.integrity?.state || "UNKNOWN"}</span>
          <span>·</span>
          <span>Compatibility: {context.compatibility || (item.projectCompatibility?.state ? item.projectCompatibility.state : "NOT_EVALUATED")}</span>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Overview */}
        <section aria-label="Overview">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Overview</h3>
          <p className="text-sm text-card-foreground leading-relaxed">{item.description || item.overview || "No description supplied."}</p>
          {item.source && <p className="text-xs text-muted-foreground mt-1">Source: {item.source}</p>}
          {item.authority?.kind && <p className="text-xs text-muted-foreground">Authority: {item.authority.kind}</p>}
        </section>

        {/* Lifecycle */}
        <section aria-label="Lifecycle">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Lifecycle</h3>
          <div className="flex flex-wrap gap-2">
            {item.lifecycle?.map((step) => (
              <span key={step.id} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", step.state === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : step.state === "FAILED" ? "bg-rose-100 text-rose-700" : step.state === "RUNNING" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600")}>
                {step.id === "install" ? <Package size={10} /> : step.id === "run" ? <Zap size={10} /> : step.id === "update" ? <Clock size={10} /> : step.id === "uninstall" ? <Wrench size={10} /> : null}
                {step.label || step.id}
              </span>
            ))}
            {!item.lifecycle?.length && <span className="text-xs text-muted-foreground">No lifecycle evidence.</span>}
          </div>
        </section>

        {/* Permissions */}
        {item.permissions && item.permissions.length > 0 && (
          <section aria-label="Permissions">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Permissions</h3>
            <ul className="space-y-1">
              {item.permissions.map((p) => (
                <li key={p.id} className="text-xs flex items-center gap-2 text-muted-foreground">
                  <span className={cn("w-1.5 h-1.5 rounded-full", p.required ? "bg-amber-500" : "bg-slate-300")} />
                  <span className={p.required ? "font-medium text-card-foreground" : ""}>{p.id}</span>
                  {p.detail && <span className="text-[10px] text-muted-foreground">— {p.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Runtime Evidence */}
        {item.runtimeEvidence && (
          <section aria-label="Runtime Evidence">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Runtime Evidence</h3>
            <div className="flex items-center gap-2 text-xs">
              <StatusBadge value={item.runtimeEvidence.state || "UNKNOWN"} />
              {item.runtimeEvidence.sources?.map((s) => (
                <span key={s} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{s}</span>
              ))}
            </div>
          </section>
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <section aria-label="Actions">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Actions</h3>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action.id}
                  disabled={action.disabled}
                  onClick={() => { action.invoke?.(); }}
                  className={cn(
                    "inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    action.disabled ? "opacity-45 cursor-not-allowed border-border text-muted-foreground" : "border-border hover:bg-accent hover:text-accent-foreground",
                    action.id === "install" ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "",
                  )}
                  aria-label={action.label}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Operation Status */}
        {operation && (
          <section aria-label="Operation Status">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Operation</h3>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge value={operation.state || "UNKNOWN"} />
                <span className="font-medium">{String(operation.operation)}</span>
              </div>
              {operation.error && <p className="text-rose-600">{String(operation.error)}</p>}
              {operation.status && <p className="text-muted-foreground">Status: {String(operation.status)}</p>}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};
