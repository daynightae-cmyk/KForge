import { useState, useEffect, type ReactNode } from "react";
import { EvidenceRows, StatusBadge, EmptyState } from "./ui";
import { fetchJson } from "./api";
import type { RecordRow } from "./surfaceContracts";

export function SimpleFetchSurface({ url, title, onError }: { url: string; title: string; onError?: (text: string) => void }) {
  const [data, setData] = useState<RecordRow | null>(null);
  const [message, setMessage] = useState(`Loading ${title} evidence...`);
  const refresh = () => fetchJson<RecordRow>(url).then((next) => { setData(next); setMessage(""); }).catch((error) => { const text = error instanceof Error ? error.message : `${title} evidence unavailable.`; setMessage(text); onError?.(text); });
  useEffect(() => { void refresh(); }, [url]);
  return <section className="kw-simple-surface"><div className="kw-inline-actions"><h2>{title}</h2><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kw-message">{message}</p>}{data && <><EvidenceRows value={data} /><pre>{JSON.stringify(data, null, 2)}</pre></>}</section>;
}
