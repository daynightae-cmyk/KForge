import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary, ScanIssue } from "@shared/workspace";
import { fetchJson } from "./api";
import { EmptyState, StatusBadge } from "./ui";

type DocumentationFinding = {
  id?: string;
  sourceDocument?: string;
  claim?: string;
  actualState?: string;
  severity?: string;
  suggestedFix?: string;
};

type DocumentationAudit = {
  auditedAt?: string;
  documents?: string[];
  findings?: DocumentationFinding[];
};

type ArchitectureEvidence = {
  generatedAt?: string;
  coverage?: { state?: string; scannedCount?: number; totalOrUnknown?: number | null; limit?: number; reason?: string; source?: string };
  cache?: { state?: string; fingerprint?: string; generatedAt?: string };
  modules?: Array<{ name?: string; files?: number }>;
  directCycles?: string[][];
  dependencyCycles?: unknown[];
  duplicatedResponsibilities?: unknown[];
  highCoupling?: Array<{ file?: string; dependents?: number }>;
  limitations?: string[];
};

const debtCategories = new Set([
  "quality",
  "dependency",
  "configuration",
  "completeness",
  "architecture",
  "api",
  "ui",
  "mock",
  "documentation",
]);

const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function text(value: unknown, fallback = "Not reported") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

export default function TechnicalDebtWorkbench({ project }: { project: ProjectSummary }) {
  const [findings, setFindings] = useState<ScanIssue[]>([]);
  const [documentation, setDocumentation] = useState<DocumentationAudit | null>(null);
  const [architecture, setArchitecture] = useState<ArchitectureEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [collectingArchitecture, setCollectingArchitecture] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [query, setQuery] = useState("");

  const loadBaseEvidence = async () => {
    setLoading(true);
    setMessage("");
    setArchitecture(null);
    try {
      const [problemData, documentationData] = await Promise.all([
        fetchJson<{ problems: ScanIssue[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`),
        fetchJson<{ audit: DocumentationAudit }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation`),
      ]);
      const normalized = (problemData.problems || [])
        .filter((finding) => debtCategories.has(String(finding.category)))
        .sort((left, right) => {
          const byPriority = (priorityRank[left.priority] ?? 99) - (priorityRank[right.priority] ?? 99);
          if (byPriority !== 0) return byPriority;
          return (severityRank[left.severity] ?? 99) - (severityRank[right.severity] ?? 99);
        });
      setFindings(normalized);
      setDocumentation(documentationData.audit || null);
      setMessage("Current technical-debt evidence loaded. Architecture graph evidence remains uncollected until explicitly requested.");
    } catch (error) {
      setFindings([]);
      setDocumentation(null);
      setMessage(error instanceof Error ? error.message : "Technical-debt evidence unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCategory("all");
    setPriority("all");
    setQuery("");
    void loadBaseEvidence();
  }, [project.id, project.trust]);

  const collectArchitecture = async () => {
    setCollectingArchitecture(true);
    setMessage("Collecting bounded architecture debt evidence on explicit request…");
    try {
      const data = await fetchJson<{ projectId: string } & ArchitectureEvidence>(`/api/workspace/projects/${encodeURIComponent(project.id)}/architecture`);
      setArchitecture(data);
      setMessage("Architecture debt evidence collected from the bounded project graph. No debt score, remediation time, or cost was synthesized.");
    } catch (error) {
      setArchitecture(null);
      setMessage(error instanceof Error ? error.message : "Architecture debt evidence could not be collected.");
    } finally {
      setCollectingArchitecture(false);
    }
  };

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return findings.filter((finding) => {
      if (category !== "all" && finding.category !== category) return false;
      if (priority !== "all" && finding.priority !== priority) return false;
      if (!normalizedQuery) return true;
      return [finding.title, finding.description, finding.file, finding.rule, finding.source, finding.suggestion]
        .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    });
  }, [findings, category, priority, query]);

  const categories = useMemo(() => [...new Set(findings.map((finding) => finding.category))].sort(), [findings]);
  const documentationFindings = Array.isArray(documentation?.findings) ? documentation!.findings! : [];
  const priorityCounts = useMemo(() => ({
    P0: findings.filter((finding) => finding.priority === "P0").length,
    P1: findings.filter((finding) => finding.priority === "P1").length,
    P2: findings.filter((finding) => finding.priority === "P2").length,
    P3: findings.filter((finding) => finding.priority === "P3").length,
  }), [findings]);

  return (
    <section className="kw-surface-section" role="region" aria-label="KForge Quality Technical Debt">
      <div className="kw-toolbar">
        <div>
          <h2>Technical Debt Evidence Workbench</h2>
          <p>Correlate normalized maintainability findings, documentation contradictions, and explicitly collected architecture hotspots. KForge does not invent a debt score, engineering-hour estimate, monetary cost, or remediation deadline.</p>
        </div>
        <button onClick={() => void loadBaseEvidence()} disabled={loading || collectingArchitecture}>Refresh debt evidence</button>
      </div>

      {message && <p className="kw-message" role="status">{message}</p>}
      {loading && <p className="kw-message">Loading normalized scanner and documentation evidence…</p>}

      <section className="kw-operation-result" role="region" aria-label="Technical debt evidence summary">
        <div className="kw-row-badges">
          <StatusBadge value={`${findings.length} NORMALIZED_FINDINGS`} />
          <StatusBadge value={`${documentationFindings.length} DOC_CONTRADICTIONS`} />
          <StatusBadge value={architecture ? "ARCHITECTURE_COLLECTED" : "ARCHITECTURE_NOT_COLLECTED"} />
        </div>
        <div className="kw-summary-grid">
          <article><strong>{priorityCounts.P0}</strong><span>P0 findings</span></article>
          <article><strong>{priorityCounts.P1}</strong><span>P1 findings</span></article>
          <article><strong>{priorityCounts.P2}</strong><span>P2 findings</span></article>
          <article><strong>{priorityCounts.P3}</strong><span>P3 findings</span></article>
        </div>
        <p>Counts are evidence inventory only. They are not converted into a synthetic score or schedule.</p>
      </section>

      <section aria-label="Technical debt filters">
        <div className="kw-toolbar">
          <label>Search debt evidence<input aria-label="Search technical debt" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="finding, file, rule, source…" /></label>
          <label>Category<select aria-label="Technical debt category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Priority<select aria-label="Technical debt priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></label>
        </div>
      </section>

      <section aria-label="Technical debt register">
        <h3>Normalized debt register</h3>
        {visible.length ? <div className="kw-quality-list">
          {visible.map((finding) => <article className="kw-quality-card" key={finding.id}>
            <div className="kw-row-badges"><StatusBadge value={finding.priority} /><StatusBadge value={finding.severity} /><StatusBadge value={finding.category} /></div>
            <h3>{finding.title}</h3>
            <p>{finding.description}</p>
            <small>{finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : finding.source}</small>
            {finding.rule && <p><strong>Rule:</strong> {finding.rule}</p>}
            {finding.suggestion && <p><strong>Suggested review:</strong> {finding.suggestion}</p>}
            <details><summary>Advanced finding evidence</summary><pre>{JSON.stringify(finding, null, 2)}</pre></details>
          </article>)}
        </div> : <EmptyState title="No matching technical-debt finding" detail="The current normalized evidence contains no finding for these filters. KForge does not synthesize technical debt to fill the view." />}
      </section>

      <section className="kw-operation-result" role="region" aria-label="Documentation debt evidence">
        <div className="kw-toolbar"><div><h3>Documentation debt</h3><p>Contradictions come from the same local Documentation Consistency audit; this surface does not duplicate its write/fix authority.</p></div><StatusBadge value={`${documentationFindings.length} CONTRADICTIONS`} /></div>
        {documentationFindings.length ? <div className="kw-quality-list">
          {documentationFindings.map((finding, index) => <article className="kw-quality-card" key={String(finding.id || index)}>
            <div className="kw-row-badges"><StatusBadge value={finding.severity || "UNKNOWN"} /></div>
            <h4>{text(finding.sourceDocument, `Documentation finding ${index + 1}`)}</h4>
            <p>{text(finding.claim)}</p>
            <small>{text(finding.actualState)}</small>
            {finding.suggestedFix && <p><strong>Suggested correction:</strong> {finding.suggestedFix}</p>}
          </article>)}
        </div> : <EmptyState title="No documentation contradiction" detail="The current documentation audit returned no contradiction. This is evidence absence, not a synthetic zero-debt claim." />}
      </section>

      <section className="kw-operation-result" role="region" aria-label="Architecture debt evidence">
        <div className="kw-toolbar">
          <div><h3>Architecture hotspots</h3><p>Architecture analysis can build/reuse the bounded project graph, so it runs only after this explicit action.</p></div>
          <button onClick={() => void collectArchitecture()} disabled={collectingArchitecture || loading}>{collectingArchitecture ? "Collecting…" : "Collect architecture debt evidence"}</button>
        </div>
        {!architecture ? <EmptyState title="Architecture debt evidence not collected" detail="Use Collect architecture debt evidence to inspect real cycles, duplicated responsibilities, and high-coupling hotspots. Opening Technical Debt does not build the graph." /> : <>
          <div className="kw-row-badges"><StatusBadge value={architecture.coverage?.state || "UNKNOWN_COVERAGE"} /><StatusBadge value={architecture.cache?.state || "UNKNOWN_CACHE"} /></div>
          <div className="kw-summary-grid">
            <article><strong>{countArray(architecture.directCycles)}</strong><span>Direct cycles</span></article>
            <article><strong>{countArray(architecture.dependencyCycles)}</strong><span>Dependency cycles</span></article>
            <article><strong>{countArray(architecture.duplicatedResponsibilities)}</strong><span>Duplicated responsibilities</span></article>
            <article><strong>{countArray(architecture.highCoupling)}</strong><span>High-coupling files</span></article>
          </div>
          {architecture.highCoupling?.length ? <div className="kw-quality-list">{architecture.highCoupling.slice(0, 12).map((item, index) => <article className="kw-quality-card" key={`${item.file || "file"}:${index}`}><h4>{text(item.file, `Hotspot ${index + 1}`)}</h4><p>{Number(item.dependents || 0)} dependent import(s) in bounded graph evidence.</p></article>)}</div> : null}
          {architecture.coverage?.reason && <p>{architecture.coverage.reason}</p>}
          {architecture.limitations?.length ? <details><summary>Architecture analysis limitations</summary><ul>{architecture.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details> : null}
        </>}
      </section>

      <details>
        <summary>Advanced technical debt evidence</summary>
        <pre>{JSON.stringify({ findings, documentation, architecture }, null, 2)}</pre>
      </details>
    </section>
  );
}
