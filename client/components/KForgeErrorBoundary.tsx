import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Home, RotateCcw, ShieldAlert } from "lucide-react";

export interface KForgeErrorFallbackProps {
  errorId: string;
  onReload?: () => void;
}

/**
 * A renderer failure must not leave a blank window. The fallback states only
 * what is known, offers a real recovery action and provides a reference that
 * can be matched to the desktop diagnostics log.
 */
export function KForgeErrorFallback({ errorId, onReload }: KForgeErrorFallbackProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground" role="alert" aria-live="assertive">
      <section className="w-full max-w-xl rounded-2xl border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-3 text-destructive">
          <ShieldAlert aria-hidden="true" size={24} />
          <p className="text-xs font-semibold uppercase tracking-[0.2em]">Workbench recovery</p>
        </div>
        <h1 className="mt-4 text-2xl font-semibold">KNOuX Forge could not render this view.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your local project data was not modified by this renderer failure. Reload the workbench to continue; if the same view fails again, restart KForge and check the desktop diagnostics log.
        </p>
        <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Reference: <code className="font-mono text-foreground">{errorId}</code>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={onReload || (() => window.location.reload())}
          >
            <RotateCcw aria-hidden="true" size={16} /> Reload workbench
          </button>
          <a className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium" href="/">
            <Home aria-hidden="true" size={16} /> Return to start
          </a>
        </div>
      </section>
    </main>
  );
}

interface KForgeErrorBoundaryState {
  errorId: string | null;
}

let errorSequence = 0;

function nextErrorId() {
  errorSequence += 1;
  // Alternation instead of a bracket character class: Tailwind's content
  // scanner misreads a bracketed dash-colon-dot-T-Z class in this file as an
  // arbitrary-property candidate and emits invalid CSS.
  const stamp = new Date().toISOString().replace(/-|:|\.|T|Z/g, "").slice(0, 14);
  return `KF-${stamp}-${errorSequence.toString(36).toUpperCase()}`;
}

/**
 * Catches render, lifecycle and lazy-chunk failures in the workbench tree.
 * Event-handler and asynchronous failures are not render failures and remain
 * the responsibility of the surface that owns them.
 */
export class KForgeErrorBoundary extends Component<{ children: ReactNode }, KForgeErrorBoundaryState> {
  state: KForgeErrorBoundaryState = { errorId: null };

  static getDerivedStateFromError(): KForgeErrorBoundaryState {
    return { errorId: nextErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("KForge renderer failure", error, info.componentStack);
  }

  render() {
    if (this.state.errorId) return <KForgeErrorFallback errorId={this.state.errorId} />;
    return this.props.children;
  }
}
