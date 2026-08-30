import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type CacheEntry = {
  key: string;
  version: number;
  projectPath?: string;
  createdAt: string;
  hits: number;
  invalidations: number;
  fingerprint: string;
};

type CacheResponse = { entries: CacheEntry[] };

type ReviewedClear = {
  signature: string;
  count: number;
  reviewedAt: string;
};

function normalizedEntries(entries: CacheEntry[]) {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

function cacheSignature(entries: CacheEntry[]) {
  return JSON.stringify(normalizedEntries(entries).map((entry) => ({
    key: entry.key,
    version: entry.version,
    createdAt: entry.createdAt,
    hits: entry.hits,
    invalidations: entry.invalidations,
    fingerprint: entry.fingerprint,
  })));
}

function shortFingerprint(value: string) {
  if (!value) return "UNKNOWN";
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

export default function SystemStorageCenter({ project }: { project: ProjectSummary }) {
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewedClear | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const trusted = project.trust === "trusted";

  const load = useCallback(async (invalidateAuthority = true) => {
    if (invalidateAuthority) setReviewed(null);
    setLoading(true);
    setMessage("");
    try {
      const response = await fetchJson<CacheResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache`);
      setEntries(Array.isArray(response.entries) ? response.entries : []);
    } catch (error) {
      setEntries([]);
      setReviewed(null);
      setMessage(error instanceof Error ? error.message : "Storage evidence unavailable.");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    setEntries([]);
    setReviewed(null);
    setQuery("");
    void load(false);
  }, [load, project.id, project.trust]);

  const totals = useMemo(() => ({
    hits: entries.reduce((total, entry) => total + (Number(entry.hits) || 0), 0),
    invalidations: entries.reduce((total, entry) => total + (Number(entry.invalidations) || 0), 0),
    versions: new Set(entries.map((entry) => entry.version)).size,
  }), [entries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return normalizedEntries(entries);
    return normalizedEntries(entries).filter((entry) => [entry.key, entry.fingerprint, entry.createdAt, entry.version]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [entries, query]);

  const reviewClear = () => {
    if (!entries.length) {
      setReviewed(null);
      setMessage("No local analysis cache entry exists to review for clearing.");
      return;
    }
    setReviewed({ signature: cacheSignature(entries), count: entries.length, reviewedAt: new Date().toISOString() });
    setMessage(`CLEAR_PLAN_REVIEWED: ${entries.length} current in-memory cache entr${entries.length === 1 ? "y" : "ies"} reviewed. No cache or project file was changed.`);
  };

  const clearReviewed = async () => {
    if (!trusted || !reviewed || clearing) return;
    setClearing(true);
    setMessage("Re-checking reviewed cache authority against current evidence…");
    try {
      const current = await fetchJson<CacheResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache`);
      const currentEntries = Array.isArray(current.entries) ? current.entries : [];
      const currentSignature = cacheSignature(currentEntries);
      setEntries(currentEntries);
      if (currentSignature !== reviewed.signature) {
        setReviewed(null);
        setMessage("STALE_CLEAR_REVIEW: cache evidence changed after review. Nothing was cleared; review the current entries again.");
        return;
      }
      if (!window.confirm(`Clear ${reviewed.count} reviewed KForge in-memory analysis cache entr${reviewed.count === 1 ? "y" : "ies"} for this project? Source files and persisted .kforge evidence are not deleted.`)) {
        setMessage("Cache clear cancelled. Reviewed cache evidence remains unchanged.");
        return;
      }
      const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache/clear`, jsonRequest({ confirmed: true }));
      setReviewed(null);
      if (!response.ok) {
        setMessage(String(response.data.error || `Cache clear failed with HTTP ${response.status}.`));
        return;
      }
      const removed = typeof response.data.removed === "number" ? response.data.removed : 0;
      const refreshed = await fetchJson<CacheResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache`);
      const remaining = Array.isArray(refreshed.entries) ? refreshed.entries : [];
      setEntries(remaining);
      setMessage(`CACHE_CLEAR_COMPLETED: backend removed ${removed} reviewed in-memory entr${removed === 1 ? "y" : "ies"}; ${remaining.length} current entr${remaining.length === 1 ? "y remains" : "ies remain"}. Project source was not modified.`);
    } catch (error) {
      setReviewed(null);
      setMessage(error instanceof Error ? error.message : "Local analysis cache could not be cleared.");
    } finally {
      setClearing(false);
    }
  };

  if (loading && !entries.length) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading local storage evidence…</div>;

  return (
    <section className="space-y-4" role="region" aria-label="KForge Storage Center" data-cache-count={entries.length} data-review-state={reviewed ? "REVIEWED" : "NOT_REVIEWED"}>
      <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Storage Center</h2>
          <p className="mt-1 text-xs text-muted-foreground">Project-scoped KForge analysis-cache evidence only. The current backend exposes an in-memory cache registry; this surface does not invent disk usage, dependency-cache size, operating-system temporary storage, or persistent cleanup authority.</p>
        </div>
        <StatusBadge value="PROCESS_MEMORY" />
        <StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} />
        <button onClick={() => void load(true)} disabled={loading || clearing}>{loading ? "Refreshing…" : "Refresh storage evidence"}</button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Storage summary">
        <article className="rounded-lg border bg-card p-3 text-xs"><strong>{entries.length}</strong><p className="mt-1 text-muted-foreground">Current in-memory entries</p></article>
        <article className="rounded-lg border bg-card p-3 text-xs"><strong>{totals.hits}</strong><p className="mt-1 text-muted-foreground">Recorded cache hits</p></article>
        <article className="rounded-lg border bg-card p-3 text-xs"><strong>{totals.invalidations}</strong><p className="mt-1 text-muted-foreground">Recorded invalidations on current entries</p></article>
        <article className="rounded-lg border bg-card p-3 text-xs"><strong>{totals.versions}</strong><p className="mt-1 text-muted-foreground">Observed cache format versions</p></article>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Storage scope contract">
        <h3 className="text-sm font-semibold">Storage scope contract</h3>
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
          <article className="rounded-md border p-3"><strong>Measured scope</strong><p className="mt-1 text-muted-foreground">Only entries returned by the project cache-status endpoint are counted. The API does not report byte size, so no storage-size estimate is shown.</p></article>
          <article className="rounded-md border p-3"><strong>Mutation boundary</strong><p className="mt-1 text-muted-foreground">Clear removes KForge process-memory analysis entries for the selected project. It does not delete source files, Git history, dependencies, snapshots, or persisted `.kforge` evidence.</p></article>
          <article className="rounded-md border p-3"><strong>Network boundary</strong><p className="mt-1 text-muted-foreground">Reading, reviewing, refreshing, and clearing this cache are local operations. Storage Center does not contact registries, GitHub, or AI providers.</p></article>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Analysis cache inventory">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Analysis cache inventory</h3>
            <p className="mt-1 text-xs text-muted-foreground">Keys are backend cache identities. Fingerprints are evidence for freshness comparison, not file checksums or disk-size measurements.</p>
          </div>
          <label className="text-xs">Filter cache entries<input aria-label="Filter storage cache entries" className="mt-1 w-full min-w-[240px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="key, version, fingerprint…" /></label>
        </div>

        {entries.length ? (
          <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable storage cache table">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead><tr className="border-b"><th className="p-2">Cache key</th><th className="p-2">Format</th><th className="p-2">Created</th><th className="p-2">Hits</th><th className="p-2">Invalidations</th><th className="p-2">Fingerprint</th></tr></thead>
              <tbody>{filtered.map((entry) => (
                <tr key={`${entry.key}:${entry.fingerprint}`} className="border-b align-top" data-cache-key={entry.key}>
                  <td className="p-2 font-medium">{entry.key}</td>
                  <td className="p-2">v{entry.version}</td>
                  <td className="p-2">{entry.createdAt || "UNKNOWN"}</td>
                  <td className="p-2">{entry.hits}</td>
                  <td className="p-2">{entry.invalidations}</td>
                  <td className="p-2 font-mono" title={entry.fingerprint}>{shortFingerprint(entry.fingerprint)}</td>
                </tr>
              ))}</tbody>
            </table>
            {!filtered.length ? <p className="py-6 text-center text-xs text-muted-foreground">No current cache entry matches this filter.</p> : null}
          </div>
        ) : <EmptyState title="No current local analysis cache" detail="KForge has no in-memory analysis cache entry for this project. Storage Center does not convert absence into a synthetic health PASS." />}
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Cache clear authority">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Cache clear authority</h3>
            <p className="mt-1 text-xs text-muted-foreground">Review is read-only. Clear performs a fresh GET and compares the exact reviewed entry signature before confirmation; stale authority is rejected without mutation.</p>
          </div>
          <StatusBadge value={reviewed ? "REVIEWED" : "NOT_REVIEWED"} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={reviewClear} disabled={!entries.length || clearing}>Review current cache clear</button>
          <button onClick={() => void clearReviewed()} disabled={!trusted || !reviewed || clearing}>{clearing ? "Verifying / clearing…" : "Clear reviewed cache"}</button>
        </div>
        {!trusted ? <p className="mt-3 text-xs text-muted-foreground">Project trust is required by the backend before local cache clear may execute.</p> : null}
        {reviewed ? <p className="mt-3 text-xs text-muted-foreground">Reviewed {reviewed.count} current entr{reviewed.count === 1 ? "y" : "ies"} at {reviewed.reviewedAt}. Refreshing this surface invalidates that authority.</p> : null}
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Advanced storage evidence">
        <AdvancedEvidence value={{ scope: "KForge in-memory project analysis cache", project: { id: project.id, name: project.name, path: project.path, trust: project.trust }, entries }} label="Advanced · Raw storage evidence" />
      </section>

      {message ? <p className="kw-message" role="status">{message}</p> : null}
    </section>
  );
}
