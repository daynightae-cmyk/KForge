import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceRows } from "./ui";
import { fetchJson } from "./api";
import type { RecordRow } from "./surfaceContracts";

export function SimpleFetchSurface({ url, title, onError }: { url: string; title: string; onError?: (text: string) => void }) {
  const [data, setData] = useState<RecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const refresh = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchJson<RecordRow>(url, { signal });
      if (signal.aborted) return;
      setData(next);
      setLoading(false);
    } catch (fetchError: unknown) {
      if (signal.aborted) return;
      const text = fetchError instanceof Error && fetchError.name !== "AbortError" ? fetchError.message : `${title} evidence unavailable.`;
      // A failed read is a refusal, not an empty result: drop stale evidence
      // so it can never masquerade as the current read.
      setData(null);
      setError(text);
      setLoading(false);
      errorRef.current?.(text);
    }
  }, [title, url]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return <section className="kw-simple-surface"><div className="kw-inline-actions"><h2>{title}</h2><button onClick={() => { const controller = new AbortController(); void refresh(controller.signal); }}>Refresh</button></div>{loading ? <p className="kw-message" role="status">Loading {title} evidence…</p> : error ? <p className="kw-message" role="alert">{title} evidence unavailable: {error} KForge does not treat a failed read as empty evidence. Use Refresh to retry.</p> : data ? <><EvidenceRows value={data} /><details className="kw-advanced-evidence"><summary>Advanced evidence</summary><pre tabIndex={0} aria-label={`${title} raw evidence`}>{JSON.stringify(data, null, 2)}</pre></details></> : null}</section>;
}
