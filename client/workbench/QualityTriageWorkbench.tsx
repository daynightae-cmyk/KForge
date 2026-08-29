import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import type { RecordRow } from "./surfaceContracts";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

const ALL = "ALL";

function record(value: unknown): RecordRow {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordRow : {};
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function qualityLocation(issue: RecordRow) {
  const file = text(issue.file, text(issue.source, "Local scanner evidence"));
  return issue.line === undefined || issue.line === null ? file : `${file}:${String(issue.line)}`;
}

type PreviewEvidence = {
  state: "NOT_EVALUATED" | "AVAILABLE" | "NOT_AVAILABLE" | "ERROR";
  status?: number;
  data?: RecordRow;
  reason?: string;
};

type ApplyEvidence = {
  state: "IDLE" | "SUCCEEDED" | "FAILED";
  status?: number;
  data?: RecordRow;
  message?: string;
};

export default function QualityTriageWorkbench({
  project,
  view,
  onNavigate,
}: {
  project: ProjectSummary;
  view: "problems" | "solutions";
  onNavigate: (activity: "quality", view: string) => void;
}) {
  const [findings, setFindings] = useState<RecordRow[]>([]);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PreviewEvidence>({ state: "NOT_EVALUATED" });
  const [applyEvidence, setApplyEvidence] = useState<ApplyEvidence>({ state: "IDLE" });

  const refresh = async () => {
    try {
      const payload = await fetchJson<{ problems: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`);
      const next = payload.problems || [];
      setFindings(next);
      setSelectedId((current) => current && next.some((item) => String(item.id || "") === current) ? current : String(next[0]?.id || ""));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quality findings are unavailable.");
    }
  };

  useEffect(() => {
    setPreview({ state: "NOT_EVALUATED" });
    setApplyEvidence({ state: "IDLE" });
    void refresh();
  }, [project.id]);

  const categories = useMemo(() => [...new Set(findings.map((issue) => String(issue.category || "UNKNOWN")))].sort(), [findings]);
  const severities = useMemo(() => [...new Set(findings.map((issue) => String(issue.severity || "UNKNOWN")))].sort(), [findings]);
  const filtered = useMemo(() => findings.filter((issue) => {
    const haystack = [issue.title, issue.description, issue.risk, issue.suggestion, issue.file, issue.source, issue.rule, issue.category, issue.severity].map((value) => String(value || "").toLowerCase()).join(" ");
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesSeverity = severity === ALL || String(issue.severity || "UNKNOWN") === severity;
    const matchesCategory = category === ALL || String(issue.category || "UNKNOWN") === category;
    return matchesQuery && matchesSeverity && matchesCategory;
  }), [findings, query, severity, category]);

  useEffect(() => {
    if (filtered.some((issue) => String(issue.id || "") === selectedId)) return;
    setSelectedId(String(filtered[0]?.id || ""));
    setPreview({ state: "NOT_EVALUATED" });
    setApplyEvidence({ state: "IDLE" });
  }, [filtered, selectedId]);

  const selected = findings.find((issue) => String(issue.id || "") === selectedId) || null;
  const counts = useMemo(() => ({
    total: findings.length,
    critical: findings.filter((issue) => String(issue.severity || "").toLowerCase() === "critical").length,
    high: findings.filter((issue) => String(issue.severity || "").toLowerCase() === "high").length,
    security: findings.filter((issue) => String(issue.category || "").toLowerCase() === "security").length,
  }), [findings]);

  const selectFinding = (issue: RecordRow) => {
    setSelectedId(String(issue.id || ""));
    setPreview({ state: "NOT_EVALUATED" });
    setApplyEvidence({ state: "IDLE" });
  };

  const checkVerifiedFix = async () => {
    if (!selected?.id) return;
    setMessage("Checking deterministic fix evidence…");
    setApplyEvidence({ state: "IDLE" });
    try {
      const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems/${encodeURIComponent(String(selected.id))}/preview`, jsonRequest({}));
      if (response.ok) {
        setPreview({ state: "AVAILABLE", status: response.status, data: response.data });
        setMessage("Verified deterministic fix preview loaded. No source file has been changed.");
      } else {
        setPreview({ state: "NOT_AVAILABLE", status: response.status, data: response.data, reason: text(response.data.error, "No verified automatic patch is available for this diagnostic.") });
        setMessage(text(response.data.error, "No verified automatic patch is available for this diagnostic."));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Solution preview failed.";
      setPreview({ state: "ERROR", reason });
      setMessage(reason);
    }
  };

  const applyVerifiedFix = async () => {
    if (!selected?.id || preview.state !== "AVAILABLE") return;
    if (!window.confirm(`Apply the reviewed deterministic fix for ${text(selected.title, String(selected.id))} and run its verification?`)) return;
    setMessage("Applying reviewed fix and verifying the result…");
    try {
      const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems/${encodeURIComponent(String(selected.id))}/apply`, jsonRequest({ confirmed: true, verify: true }));
      setApplyEvidence({
        state: response.ok ? "SUCCEEDED" : "FAILED",
        status: response.status,
        data: response.data,
        message: response.ok ? "The reviewed deterministic fix was applied and the backend returned verification evidence." : text(response.data.error, "The fix or its verification failed."),
      });
      setMessage(response.ok ? "Verified fix operation completed." : text(response.data.error, "Verified fix operation failed."));
      if (response.ok) await refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Verified fix operation failed.";
      setApplyEvidence({ state: "FAILED", message: reason });
      setMessage(reason);
    }
  };

  const previewData = record(preview.data?.preview);
  const previewProblem = record(preview.data?.problem);
  const applyData = record(applyEvidence.data);
  const ariaLabel = view === "solutions" ? "KForge Quality Solutions" : "KForge Quality Problems";

  return <section className="kw-surface-section" aria-label={ariaLabel} data-quality-triage={view}>
    <div className="kw-toolbar">
      <div>
        <h2>{view === "solutions" ? "Solutions Triage Workbench" : "Problems Triage Workbench"}</h2>
        <p>{view === "solutions" ? "Evaluate deterministic fix availability first, then apply only after explicit review and confirmation." : "Triage normalized local scan findings by severity, category, source and remediation evidence."}</p>
      </div>
      <button onClick={() => void refresh()}>Refresh findings</button>
    </div>

    <section aria-label="Quality triage summary">
      <dl className="kw-preview-evidence-list">
        <div><dt>Total findings</dt><dd>{counts.total}</dd></div>
        <div><dt>Critical</dt><dd>{counts.critical}</dd></div>
        <div><dt>High</dt><dd>{counts.high}</dd></div>
        <div><dt>Security</dt><dd>{counts.security}</dd></div>
      </dl>
    </section>

    <div className="kw-snapshot-form" aria-label="Quality finding filters">
      <label>Search findings<input aria-label="Search quality findings" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="title, file, rule, source…" /></label>
      <label>Severity<select aria-label="Filter quality severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value={ALL}>All severities</option>{severities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Category<select aria-label="Filter quality category" value={category} onChange={(event) => setCategory(event.target.value)}><option value={ALL}>All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>

    <div className="kw-quality-list" aria-label="Quality findings">
      {filtered.map((issue, index) => {
        const id = String(issue.id || `finding-${index}`);
        const selectedState = selectedId === String(issue.id || "");
        return <article className="kw-quality-card kw-quality-triage-card" key={id} data-quality-finding-id={id} data-selected={String(selectedState)}>
          <div className="kw-row-badges"><StatusBadge value={issue.severity} /><StatusBadge value={issue.category} /></div>
          <h2>{text(issue.title, `Finding ${index + 1}`)}</h2>
          <p>{text(issue.description, text(issue.risk, "No description is present in the normalized scan evidence."))}</p>
          <small>{qualityLocation(issue)}</small>
          <div className="kw-quality-actions"><button aria-pressed={selectedState} onClick={() => selectFinding(issue)}>Select finding</button></div>
        </article>;
      })}
      {!filtered.length && <EmptyState title="No matching findings" detail="The current filters match no normalized local scan evidence. KForge does not synthesize findings." />}
    </div>

    {selected && <section className="kw-operation-result" aria-label="Selected quality finding">
      <div className="kw-toolbar"><div><h3>{text(selected.title, "Selected finding")}</h3><small>{qualityLocation(selected)}</small></div><div className="kw-row-badges"><StatusBadge value={selected.severity} /><StatusBadge value={selected.category} /></div></div>
      <dl className="kw-preview-evidence-list">
        <div><dt>Rule</dt><dd>{text(selected.rule, "NOT_REPORTED")}</dd></div>
        <div><dt>Source</dt><dd>{text(selected.source, "Local scanner evidence")}</dd></div>
        <div><dt>Risk</dt><dd>{text(selected.risk, text(selected.description, "No risk detail reported."))}</dd></div>
        <div><dt>Suggested action</dt><dd>{text(selected.suggestion, "Review the finding and run the relevant verification.")}</dd></div>
      </dl>
      {view === "problems" ? <div className="kw-quality-actions"><button onClick={() => onNavigate("quality", "solutions")}>Review remediation in Solutions</button></div> : <div className="kw-quality-actions"><button onClick={() => void checkVerifiedFix()}>Check verified fix</button>{preview.state === "AVAILABLE" && <button onClick={() => void applyVerifiedFix()}>Apply verified fix</button>}</div>}
      <details><summary>Advanced finding evidence</summary><pre tabIndex={0}>{JSON.stringify(selected, null, 2)}</pre></details>
    </section>}

    {view === "solutions" && selected && <section className="kw-operation-result" aria-label="Verified fix evidence" data-fix-state={preview.state}>
      <div className="kw-toolbar"><div><h3>Verified fix evidence</h3><p>Preview is observational. Apply remains a separately confirmed write operation.</p></div><StatusBadge value={preview.state} /></div>
      {preview.state === "NOT_EVALUATED" && <p className="kw-muted">Fix availability has not been evaluated for this selected finding.</p>}
      {preview.state === "NOT_AVAILABLE" && <p>{preview.reason || "No verified automatic patch is available."}</p>}
      {preview.state === "ERROR" && <p>{preview.reason || "Solution preview failed."}</p>}
      {preview.state === "AVAILABLE" && <dl className="kw-preview-evidence-list">
        <div><dt>Finding</dt><dd>{text(previewProblem.title, text(selected.title))}</dd></div>
        <div><dt>Operation</dt><dd>{text(previewData.operation, "NOT_REPORTED")}</dd></div>
        <div><dt>Target file</dt><dd><code>{text(previewData.file, "NOT_REPORTED")}</code></dd></div>
        <div><dt>Explanation</dt><dd>{text(previewData.explanation, "No explanation reported.")}</dd></div>
        <div><dt>Permission</dt><dd>{text(preview.data?.permission, "NOT_REPORTED")}</dd></div>
      </dl>}
      {preview.data && <details><summary>Advanced preview evidence</summary><pre tabIndex={0}>{JSON.stringify(preview.data, null, 2)}</pre></details>}
    </section>}

    {view === "solutions" && applyEvidence.state !== "IDLE" && <section className="kw-operation-result" aria-label="Verified fix operation" data-apply-state={applyEvidence.state}>
      <div className="kw-toolbar"><div><h3>Verified fix operation</h3><p>{applyEvidence.message}</p></div><StatusBadge value={applyEvidence.state} /></div>
      <dl className="kw-preview-evidence-list">
        <div><dt>HTTP evidence</dt><dd>{applyEvidence.status === undefined ? "NOT_RECORDED" : String(applyEvidence.status)}</dd></div>
        <div><dt>Backend result</dt><dd>{text(applyData.ok, applyEvidence.state)}</dd></div>
        <div><dt>Rolled back</dt><dd>{applyData.rolledBack === undefined ? "NOT_REPORTED" : String(applyData.rolledBack)}</dd></div>
        <div><dt>Verification</dt><dd>{Array.isArray(applyData.verification) ? `${applyData.verification.length} record(s)` : "See backend evidence"}</dd></div>
      </dl>
      {applyEvidence.data && <details><summary>Advanced apply evidence</summary><pre tabIndex={0}>{JSON.stringify(applyEvidence.data, null, 2)}</pre></details>}
    </section>}

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}
