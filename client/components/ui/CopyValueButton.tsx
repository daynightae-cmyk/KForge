import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * Accessible copy control for canonical identifiers (brand tokens, asset paths,
 * API contracts). It never reports success before the clipboard promise
 * resolves, and it reports a truthful failure when the clipboard is blocked.
 */
export function CopyValueButton({ value, label, compact = false }: { value: string; label: string; compact?: boolean }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  };

  const status = state === "copied" ? `Copied ${label}` : state === "failed" ? `Could not copy ${label}` : "";
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${state === "failed" ? "border-destructive/50 text-destructive" : ""}`}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}: ${value}`}
      onClick={() => void copy()}
    >
      {state === "copied" ? <Check size={13} /> : state === "failed" ? <TriangleAlert size={13} /> : <Copy size={13} />}
      {!compact ? <span>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span> : null}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </button>
  );
}

export default CopyValueButton;
