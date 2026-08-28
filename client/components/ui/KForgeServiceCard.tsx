import React from "react";
import { cn } from "@/lib/utils";
import { Terminal, Check, AlertCircle, Clock, Play, Settings, Wrench, Shield } from "lucide-react";
import { StatusBadge } from "../../workbench/ui";

export type ServiceCardProps = {
  title: string;
  subtitle?: string;
  status?: string;
  command?: string;
  lastRun?: string;
  durationMs?: number;
  available?: boolean;
  reason?: string;
  onRun?: () => void;
  onHealth?: () => void;
  onConfigure?: () => void;
  disabled?: boolean;
};

export const KForgeServiceCard: React.FC<ServiceCardProps> = ({
  title,
  subtitle,
  status,
  command,
  lastRun,
  durationMs,
  available,
  reason,
  onRun,
  onHealth,
  onConfigure,
  disabled,
}) => {
  const isAvailable = available === true;
  const hasRun = !!lastRun;
  return (
    <article className="group relative rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-all p-4 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground shrink-0">
          {title.toLowerCase().includes("lint") ? <Wrench size={18} /> : title.toLowerCase().includes("test") ? <Play size={18} /> : title.toLowerCase().includes("build") ? <Settings size={18} /> : <Terminal size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight tracking-tight truncate">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
        </div>
        <StatusBadge value={isAvailable ? (status || "AVAILABLE") : (status === "NOT_DETECTED" ? "NOT_DETECTED" : available === false ? "UNAVAILABLE" : "UNKNOWN")} />
      </div>
      {command && (
        <div className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded px-2 py-1 truncate">{command}</div>
      )}
      {reason && !isAvailable && (
        <p className="text-[11px] text-rose-600 leading-relaxed">{reason}</p>
      )}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
        {hasRun && <span>Last run: {lastRun ? new Date(lastRun).toLocaleString() : "UNKNOWN"}</span>}
        {durationMs !== undefined && durationMs >= 0 && <span>· {durationMs} ms</span>}
      </div>
      <div className="flex gap-2 mt-2 pt-2 border-t">
        {isAvailable && onRun && (
          <button disabled={disabled} onClick={onRun} className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Run</button>
        )}
        {onHealth && (
          <button disabled={disabled} onClick={onHealth} className="inline-flex items-center justify-center rounded-md border border-border hover:bg-accent hover:text-accent-foreground h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Health</button>
        )}
        {onConfigure && (
          <button disabled={disabled} onClick={onConfigure} className="inline-flex items-center justify-center rounded-md border border-border hover:bg-accent hover:text-accent-foreground h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50">Configure</button>
        )}
      </div>
    </article>
  );
};
