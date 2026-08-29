import { useEffect, useMemo, useState } from "react";
import type { ProjectProfile, ProjectSummary, ScanIssue } from "@shared/workspace";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

type GraphEvidence = {
  generatedAt?: string;
  summary?: { files?: number; symbols?: number; imports?: number; apis?: number; routes?: number };
  coverage?: { state?: string; scannedCount?: number; totalOrUnknown?: number | null; limit?: number; reason?: string; source?: string };
  cache?: { state?: string; fingerprint?: string; generatedAt?: string };
};

type CacheEntry = {
  key: string;
  version: number;
  createdAt: string;
  hits: number;
  invalidations: number;
  fingerprint: string;
};

type ProblemResponse = {
  scannedAt?: string;
  problems: ScanIssue[];
  coverage?: Record<string, { state?: string; scannedCount?: number; totalOrUnknown?: number | null; limit?: number; reason?: string; source?: string }>;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export default function PerformanceQualityWorkbench({ project }: { project: ProjectSummary }) {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [performanceFindings, setPerformanceFindings] = useState<ScanIssue[]>([]);
  const [problemCoverage, setProblemCoverage] = useState<ProblemResponse["coverage"]>({});
  const [graph, setGraph] = useState<GraphEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [collectingGraph, setCollectingGraph] = useState(false);
  const [reviewedClear, setReviewedClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");

  const trusted = project.trust === "trusted";

  const refreshBaseEvidence = async (invalidateAuthority = true) => {
    if (invalidateAuthority) setReviewedClear(false);
    setLoading(true);
    setMessage("");
    try {
      const [profileData, cacheData, problemData] = await Promise.all([
        fetchJson<{ profile: ProjectProfile }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/profile`),
        fetchJson<{ entries: CacheEntry[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache`),
        fetchJson<ProblemResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`),
      ]);
      setProfile(profileData.profile);
      setCacheEntries(Array.isArray(cacheData.entries) ? cacheData.entries : []);
      setPerformanceFindings((problemData.problems || []).filter((issue) => String(issue.category) === "performance"));
      setProblemCoverage(problemData.coverage || {});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Performance evidence unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setGraph(null);
    setReviewedClear(false);
    void refreshBaseEvidence(false);
  }, [project.id, project.trust]);

  const collectGraphEvidence = async () => {
    setCollectingGraph(true);
    setReviewedClear(false);
    setMessage("Collecting bounded graph/cache evidence on explicit request…");
    try {
      const data = await fetchJson<{ graph: GraphEvidence }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph`);
      setGraph(data.graph);
      const cacheData = await fetchJson<{ entries: CacheEntry[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache`);
      setCacheEntries(Array.isArray(cacheData.entries) ? cacheData.entries : []);
      setMessage("Current graph and cache evidence collected. No synthetic benchmark was generated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Graph performance evidence could not be collected.");
    } finally {
      setCollectingGraph(false);
    }
  };

  const clearCache = async () => {
    if (!trusted || !reviewedClear || clearing) return;
    if (!window.confirm("Clear the reviewed local KForge analysis cache for this project? Source files are not modified.")) return;
    setClearing(true);
    setMessage("Clearing reviewed local analysis cache…");
    try {
      const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/cache/clear`, jsonRequest({ confirmed: true }));
      setReviewedClear(false);
      setGraph(null);
      if (!response.ok) {
        setMessage(String(response.data.error || `Cache clear failed with HTTP ${response.status}.`));
        return;
      }
      const removed = typeof response.data.removed === "number" ? response.data.removed : 0;
      await refreshBaseEvidence(false);
      setMessage(`CACHE_CLEARED: ${removed} local analysis cache entr${removed === 1 ? "y" : "ies"} removed. Source files were not modified.`);
    } catch (error) {
      setReviewedClear(false);
      setMessage(error instanceof Error ? error.message : "Local analysis cache could not be cleared.");
    } finally {
      setClearing(false);
    }
  };

  const strategy = profile?.performance;
  const coverageLimited = profile?.fileDiscovery.state === "LIMIT_REACHED" || graph?.coverage?.state === "LIMIT_REACHED";
  const cacheHits = useMemo(() => cacheEntries.reduce((total, entry) => total + (Number(entry.hits) || 0), 0), [cacheEntries]);
  const cacheInvalidations = useMemo(() => cacheEntries.reduce((total, entry) => total + (Number(entry.invalidations) || 0), 0), [cacheEntries]);

  if (!loading && !profile) return <EmptyState title="Performance evidence unavailable" detail="KForge could not load a current project profile. No performance status was invented." />;

  return (
    <section className="kw-surface-section" role="region" aria-label="KForge Quality Performance">
      <div className="kw-toolbar">
        <div>
          <h2>Performance Evidence Workbench</h2>
          <p>Inspect measured project scale, bounded-analysis policy, graph coverage, and local cache behavior. Opening this surface does not run a benchmark or build the project graph.</p>
        </div>
        <button onClick={() => void refreshBaseEvidence(true)} disabled={loading || collectingGraph || clearing}>Refresh performance evidence</button>
      </div>

      {message && <p className="kw-message" role="status">{message}</p>}
      {loading && <p className="kw-message" role="status">Loading measured project profile and current cache evidence…</p>}

      {profile && strategy && (
        <>
          <section className="kw-operation-result" role="region" aria-label="Performance strategy summary">
            <div className="kw-row-badges">
              <StatusBadge value={strategy.scale.toUpperCase()} />
              <StatusBadge value={coverageLimited ? "BOUNDED_EVIDENCE" : "CURRENT_EVIDENCE"} />
              <StatusBadge value={strategy.cacheEnabled ? "CACHE_ENABLED" : "CACHE_DISABLED"} />
              <StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} />
            </div>
            <h3>Measured project scale</h3>
            <p>{strategy.rationale}</p>
            <div className="kw-quality-list">
              <article className="kw-quality-card"><strong>{profile.totalFileCount.toLocaleString()}</strong><span>Total files discovered</span></article>
              <article className="kw-quality-card"><strong>{profile.sourceFileCount.toLocaleString()}</strong><span>Source files detected</span></article>
              <article className="kw-quality-card"><strong>{formatBytes(profile.projectSizeBytes)}</strong><span>Measured project bytes</span></article>
              <article className="kw-quality-card"><strong>{strategy.maxIndexedFiles.toLocaleString()}</strong><span>Maximum indexed files</span></article>
            </div>
          </section>

          <section aria-label="Bounded analysis policy">
            <h3>Bounded analysis policy</h3>
            <div className="kw-quality-list">
              <article className="kw-quality-card"><h4>Parallelism</h4><p>{strategy.parallelism} worker slot(s)</p></article>
              <article className="kw-quality-card"><h4>Scanner concurrency</h4><p>{strategy.scannerConcurrency} scanner worker(s)</p></article>
              <article className="kw-quality-card"><h4>Graph depth</h4><p>{strategy.graphDepth} level(s)</p></article>
              <article className="kw-quality-card">
                <h4>File discovery</h4>
                <div className="kw-row-badges"><StatusBadge value={profile.fileDiscovery.state} /></div>
                <p>{profile.fileDiscovery.reason}</p>
                <small>{profile.fileDiscovery.scannedCount.toLocaleString()} scanned · limit {profile.fileDiscovery.limit.toLocaleString()} · source {profile.fileDiscovery.source}</small>
              </article>
            </div>
          </section>

          <section className="kw-operation-result" role="region" aria-label="Graph performance evidence">
            <div className="kw-toolbar">
              <div>
                <h3>Graph indexing evidence</h3>
                <p>Graph construction can be expensive on large projects, so KForge does not start it merely because this page opened.</p>
              </div>
              <button onClick={() => void collectGraphEvidence()} disabled={collectingGraph || clearing}>{collectingGraph ? "Collecting…" : "Collect graph evidence"}</button>
            </div>
            {!graph ? <EmptyState title="Graph evidence not collected in this session" detail="Use Collect graph evidence to explicitly build/reuse the bounded graph and expose its real coverage/cache state." /> : (
              <div className="kw-quality-list">
                <article className="kw-quality-card">
                  <div className="kw-row-badges"><StatusBadge value={graph.coverage?.state || "UNKNOWN"} /><StatusBadge value={graph.cache?.state || "UNKNOWN_CACHE"} /></div>
                  <h4>Coverage</h4>
                  <p>{graph.coverage?.reason || "No coverage reason returned."}</p>
                  <small>{Number(graph.coverage?.scannedCount || 0).toLocaleString()} scanned · limit {Number(graph.coverage?.limit || 0).toLocaleString()}</small>
                </article>
                <article className="kw-quality-card">
                  <h4>Graph summary</h4>
                  <p>{Number(graph.summary?.files || 0).toLocaleString()} files · {Number(graph.summary?.imports || 0).toLocaleString()} imports · {Number(graph.summary?.symbols || 0).toLocaleString()} symbols</p>
                  <small>{graph.generatedAt ? `Generated ${graph.generatedAt}` : "Generation timestamp unavailable"}</small>
                </article>
              </div>
            )}
          </section>

          <section aria-label="Local analysis cache">
            <h3>Local analysis cache</h3>
            <div className="kw-row-badges">
              <StatusBadge value={`${cacheEntries.length} ENTRIES`} />
              <StatusBadge value={`${cacheHits} HITS`} />
              <StatusBadge value={`${cacheInvalidations} INVALIDATIONS`} />
            </div>
            {cacheEntries.length ? (
              <div className="kw-quality-list">
                {cacheEntries.map((entry) => (
                  <article className="kw-quality-card" key={`${entry.key}:${entry.fingerprint}`}>
                    <h4>{entry.key}</h4>
                    <p>{entry.hits} hit(s) · {entry.invalidations} invalidation(s)</p>
                    <small>Format v{entry.version} · created {entry.createdAt}</small>
                  </article>
                ))}
              </div>
            ) : <EmptyState title="No current local analysis cache" detail="No KForge cache entry exists for this project. This is not treated as a performance failure." />}
            <div className="kw-quality-actions">
              {!reviewedClear && <button onClick={() => { setReviewedClear(true); setMessage("Cache-clear plan reviewed. No cache entry or source file has been changed."); }}>Review cache clear</button>}
              <button onClick={() => void clearCache()} disabled={!trusted || !reviewedClear || clearing}>{clearing ? "Clearing…" : "Clear local analysis cache"}</button>
            </div>
            {!trusted && <p className="kw-message">Project trust is required before clearing local cache evidence.</p>}
            {reviewedClear && <p className="kw-message">Reviewed operation: remove KForge in-memory analysis cache entries for this project only. Source files, dependencies, and Git history are not modified.</p>}
          </section>

          <section aria-label="Performance findings">
            <h3>Normalized performance findings</h3>
            {performanceFindings.length ? (
              <div className="kw-quality-list">
                {performanceFindings.map((finding) => (
                  <article className="kw-quality-card" key={finding.id}>
                    <div className="kw-row-badges"><StatusBadge value={finding.severity} /><StatusBadge value={finding.source} /></div>
                    <h4>{finding.title}</h4>
                    <p>{finding.description}</p>
                    {finding.file && <small>{finding.file}{finding.line ? `:${finding.line}` : ""}</small>}
                  </article>
                ))}
              </div>
            ) : <EmptyState title="No normalized performance finding" detail="The current scanner produced no performance-category finding. KForge shows measured scale and bounded-analysis evidence instead of inventing a PASS." />}
          </section>

          <details>
            <summary>Advanced performance evidence</summary>
            <pre>{JSON.stringify({ profile: { performance: strategy, fileDiscovery: profile.fileDiscovery, totalFileCount: profile.totalFileCount, sourceFileCount: profile.sourceFileCount, projectSizeBytes: profile.projectSizeBytes }, graph, cacheEntries, problemCoverage }, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
