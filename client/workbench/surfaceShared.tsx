import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceRows } from "./ui";
import { fetchJson } from "./api";
import type { RecordRow } from "./surfaceContracts";

export function SimpleFetchSurface({ url, title, onError }: { url: string; title: string; onError?: (text: string) => void }) {
  const [data, setData] = useState<RecordRow | null>(null);
  const [message, setMessage] = useState(`Loading ${title} evidence...`);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const refresh = useCallback(async (signal: AbortSignal) => {
    setMessage(`Loading ${title} evidence...`);
    try {
      const next = await fetchJson<RecordRow>(url, { signal });
      if (signal.aborted) return;
      setData(next);
      setMessage("");
    } catch (error: unknown) {
      if (signal.aborted) return;
      const text = error instanceof Error && error.name !== "AbortError" ? error.message : `${title} evidence unavailable.`;
      setMessage(text);
      errorRef.current?.(text);
    }
  }, [title, url]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return <section className="kw-simple-surface"><div className="kw-inline-actions"><h2>{title}</h2><button onClick={() => { const controller = new AbortController(); void refresh(controller.signal); }}>Refresh</button></div>{message && <p className="kw-message">{message}</p>}{data && <><EvidenceRows value={data} /><details className="kw-advanced-evidence"><summary>Advanced evidence</summary><pre tabIndex={0} aria-label={`${title} raw evidence`}>{JSON.stringify(data, null, 2)}</pre></details></>}</section>;
}
