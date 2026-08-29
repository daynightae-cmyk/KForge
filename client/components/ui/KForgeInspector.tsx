import React from "react";
import { cn } from "@/lib/utils";
import { Shield, Zap, Clock, AlertCircle, Check, Wrench, Package, Plug, Cloud } from "lucide-react";
import { StatusBadge } from "../../workbench/ui";
import type { InspectorContext } from "../../workbench/surfaceContracts";

export function KForgeInspector({ context, operation }: { context: InspectorContext | null; operation?: Record<string, unknown> | null }) {
  if (!context || !context.item) {
    return (
      <aside className="kw-inspector flex flex-col overflow-hidden" aria-label="Inspector" tabIndex={0}>
        <div className="p-5 border-b shrink-0 bg-card">
          <h2 className="text-sm font-semibold">Inspector</h2>
          <p className="text-xs text-muted-foreground mt-1">Select an item to inspect its lifecycle, runtime evidence, and permissions.</p>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-sm text-muted-foreground">Select an item to inspect its lifecycle, runtime evidence, and permissions.</p>
        </div>
      </aside>
    );
  }
  const item = context.item;
  const actions = context.actions || [];
  return (
    <aside className="kw-inspector flex flex-col overflow-hidden" aria-label={`Inspector for ${context.title || item.name}`} tabIndex={0}>
      <div className="p-5 border-b shrink-0 bg-card">
        <div className="flex items-start gap-3">
          <h2 className="text-base font-semibold tracking-tight leading-snug flex-1 min-w-0">{context.title || item.name}</h2>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <StatusBadge value={item.installed ? "INSTALLED" : item.availability || "UNKNOWN"} />
            {context.compatibility && <StatusBadge value={context.compatibility || "NOT_EVALUATED"} />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{item.category} · {item.version ? `v${item.version}` : "version UNKNOWN"}</p>
        <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1"><Shield size={10} /> Trust: {item.trust === "TRUSTED" ? "TRUSTED" : item.trust === "UNTRUSTED" ? "UNTRUSTED" : item.trust === "PARTIALLY_TRUSTED" ? "PARTIALLY_TRUSTED" : item.trust ? String(item.trust) : "NOT_EVALUATED"}</span>
          <span>·</span>
          <span>Integrity: {item.integrity?.state || "UNKNOWN"}</span>
          <span>·</span>
          <span>Compatibility: {context.compatibility || (item.projectCompatibility?.state ? item.projectCompatibility.state : "NOT_EVALUATED")}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 space-y-5 kw-inspector-scroll" tabIndex={0} aria-label="Inspector details scroll">
        {/* Overview */}
        <section aria-label="Overview">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Overview</h3>
          <p className="text-sm text-card-foreground leading-relaxed break-words">{item.description || item.overview || "No description supplied."}</p>
          {item.source && <p className="text-xs text-muted-foreground mt-1 break-words">Source: {item.source}</p>}
          {item.authority?.kind && <p className="text-xs text-muted-foreground break-words">Authority: {item.authority.kind}</p>}
        </section>

        {/* Freshness */}
        {context.item?.freshness && (
          <section aria-label="Freshness">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Freshness</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <StatusBadge value={context.item.freshness.state || "UNKNOWN"} />
              <span>·</span>
              <span>Checked: {context.item.freshness.at ? new Date(context.item.freshness.at).toLocaleString() : "UNKNOWN"}</span>
            </div>
          </section>
        )}

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
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", p.required ? "bg-amber-500" : "bg-slate-300")} />
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
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <StatusBadge value={item.runtimeEvidence.state || "UNKNOWN"} />
              {item.runtimeEvidence.sources?.map((s) => (
                <span key={s} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground break-all">{s}</span>
              ))}
            </div>
          </section>
        )}

        {/* Actions - full matrix with disabled reasons visible */}
        {actions.length > 0 && (
          <section aria-label="Actions">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Actions</h3>
            <div className="space-y-2">
              {actions.map((action) => (
                <div key={action.id} className="flex flex-col gap-1 rounded-md border bg-card px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      disabled={action.disabled}
                      onClick={() => { action.invoke?.(); }}
                      className={cn(
                        "inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                        action.disabled ? "opacity-45 cursor-not-allowed border-border text-muted-foreground" : "border-border hover:bg-accent hover:text-accent-foreground",
                        action.id === "install" && !action.disabled ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "",
                      )}
                      aria-label={action.label}
                      aria-describedby={action.disabled && action.reason ? `reason-${action.id}` : undefined}
                      title={action.reason || action.label}
                    >
                      {action.label}
                    </button>
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", action.disabled ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700")}>{action.disabled ? "DISABLED" : "ENABLED"}</span>
                  </div>
                  {action.disabled && action.reason && (
                    <p id={`reason-${action.id}`} className="text-[11px] text-muted-foreground leading-relaxed break-words">
                      {action.reason}
                    </p>
                  )}
                  {!action.disabled && <p className="text-[11px] text-emerald-700">Ready — requires confirmation before execution.</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Operation Status */}
        {operation && (
          <section aria-label="Operation Status">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Operation</h3>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs break-words">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <StatusBadge value={(operation.state as string) || "UNKNOWN"} />
                <span className="font-medium">{String(operation.operation || operation.state || "UNKNOWN")}</span>
                {operation.itemId && <span className="text-muted-foreground">· {String(operation.itemId)}</span>}
              </div>
              {operation.error && <p className="text-rose-600 break-words">{String(operation.error)}</p>}
              {operation.status && <p className="text-muted-foreground">Status: {String(operation.status)}</p>}
              {operation.message && <p className="text-muted-foreground break-words">{String(operation.message)}</p>}
              <details className="mt-2"><summary className="cursor-pointer text-muted-foreground text-[11px]">Raw operation evidence</summary><pre className="mt-1 max-h-40 overflow-auto text-[10px] break-all whitespace-pre-wrap">{JSON.stringify(operation, null, 2)}</pre></details>
            </div>
          </section>
        )}

        {/* Advanced evidence for scroll reachability */}
        <section aria-label="Advanced Evidence">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Advanced Evidence</h3>
          <details><summary className="cursor-pointer text-xs text-muted-foreground">Raw item evidence</summary><pre className="mt-2 max-h-48 overflow-auto text-[10px] break-all whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre></details>
        </section>
      </div>
    </aside>
  );
}
