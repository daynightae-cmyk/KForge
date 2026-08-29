import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import type { RecordRow } from "./surfaceContracts";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

type FixState = "NOT_EVALUATED" | "CHECKING" | "AVAILABLE" | "MANUAL_REVIEW" | "ERROR";
type ApplyState = "IDLE" | "APPLYING" | "SUCCEEDED" | "FAILED" | "UNVERIFIED";

type DocumentationFinding = RecordRow & {
  id?: string;
  sourceDocument?: string;
  claim?: string;
  evidence?: string;
  actualState?: string;
  severity?: string;
  suggestedFix?: string;
  fix?: RecordRow;
};

type DocumentationAudit = RecordRow & {
  auditedAt?: string;
  documents?: string[];
  findings?: DocumentationFinding[];
};

function text(value: unknown, fallback = "Not reported") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function record(value: unknown): RecordRow | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordRow : null;
}

function DocumentationConsistencyWorkbench({ project }: { project: ProjectSummary }) {
  const [audit, setAudit] = useState<DocumentationAudit | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [fixState, setFixState] = useState<FixState>("NOT_EVALUATED");
  const [previewEvidence, setPreviewEvidence] = useState<RecordRow | null>(null);
  const [previewFindingId, setPreviewFindingId] = useState("");
  const [applyState, setApplyState] = useState<ApplyState>("IDLE");
  const [applyEvidence, setApplyEvidence] = useState<RecordRow | null>(null);
  const authorityEpoch = useRef(0);

  const clearAuthority = (clearOperation = true) => {
    authorityEpoch.current += 1;
    setFixState("NOT_EVALUATED");
    setPreviewEvidence(null);
    setPreviewFindingId("");
    if (clearOperation) {
      setApplyState("IDLE");
      setApplyEvidence(null);
    }
  };

  const loadAudit = async (clearOperation = true) => {
    clearAuthority(clearOperation);
    setMessage("Auditing local documentation claims…");
    try {
      const data = await fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation`);
      const nextAudit = (record(data.audit) || {}) as DocumentationAudit;
      const findings = Array.isArray(nextAudit.findings) ? nextAudit.findings : [];
      setAudit({ ...nextAudit, findings });
      setSelectedId((current) => findings.some((finding) => String(finding.id || "") === current) ? current : String(findings[0]?.id || ""));
      setMessage("Current documentation audit evidence loaded.");
    } catch (error) {
      setAudit(null);
      setSelectedId("");
      setMessage(error instanceof Error ? error.message : "Documentation audit evidence unavailable.");
    }
  };

  useEffect(() => { void loadAudit(); }, [project.id]);

  const findings = Array.isArray(audit?.findings) ? audit!.findings! : [];
  const documents = Array.isArray(audit?.documents) ? audit!.documents! : [];
  const selected = findings.find((finding) => String(finding.id || "") === selectedId) || null;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return findings.filter((finding) => {
      if (severity !== "all" && String(finding.severity || "").toLowerCase() !== severity) return false;
      if (documentFilter !== "all" && String(finding.sourceDocument || "") !== documentFilter) return false;
      if (!query) return true;
      return [finding.sourceDocument, finding.claim, finding.evidence, finding.actualState, finding.suggestedFix]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [findings, search, severity, documentFilter]);

  const selectFinding = (finding: DocumentationFinding) => {
    clearAuthority();
    setSelectedId(String(finding.id || ""));
  };

  const preview = async () => {
    const findingId = String(selected?.id || "");
    if (!findingId) return;
    clearAuthority();
    const epoch = authorityEpoch.current;
    setFixState("CHECKING");
    setMessage("Checking exact safe documentation replacement…");
    const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation/${encodeURIComponent(findingId)}/preview`, jsonRequest({}));
    if (authorityEpoch.current !== epoch) return;
    const patch = record(response.data.patch);
    setPreviewEvidence(response.data);
    setPreviewFindingId(findingId);
    if (!response.ok) {
      setFixState("ERROR");
      setMessage(text(response.data.error, `Documentation preview failed with HTTP ${response.status}.`));
      return;
    }
    if (!patch) {
      setFixState("MANUAL_REVIEW");
      setMessage(text(response.data.reason, "No exact safe replacement is available; manual review is required."));
      return;
    }
    setFixState("AVAILABLE");
    setMessage("Exact safe replacement is available. No file has been changed.");
  };

  const apply = async () => {
    const findingId = String(selected?.id || "");
    if (!findingId || fixState !== "AVAILABLE" || previewFindingId !== findingId || !record(previewEvidence?.patch)) return;
    if (!window.confirm(`Apply the reviewed documentation replacement for ${text(selected?.sourceDocument, findingId)} and re-audit it?`)) return;
    authorityEpoch.current += 1;
    setFixState("NOT_EVALUATED");
    setPreviewFindingId("");
    setPreviewEvidence(null);
    setApplyState("APPLYING");
    setApplyEvidence(null);
    setMessage("Applying the explicitly confirmed documentation replacement and re-auditing…");
    const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation/${encodeURIComponent(findingId)}/apply`, jsonRequest({ confirmed: true }));
    const applied = response.data.applied === true;
    const verified = response.data.verified === true;
    setApplyEvidence(response.data);
    setApplyState(response.ok && applied && verified ? "SUCCEEDED" : response.ok && applied ? "UNVERIFIED" : "FAILED");
    setMessage(response.ok && applied && verified
      ? "Documentation replacement applied and verified by a fresh audit."
      : text(response.data.reason || response.data.error, applied ? "The write completed but the fresh audit did not verify the finding as resolved." : "The documentation replacement was not applied."));
    await loadAudit(false);
  };

  const patch = record(previewEvidence?.patch);
  const automatic = findings.filter((finding) => record(finding.fix)).length;
  const high = findings.filter((finding) => String(finding.severity || "").toLowerCase() === "high").length;

  return <section className="kw-surface-section" role="region" aria-label="KForge Documentation Consistency">
    <div className="kw-toolbar">
      <div>
        <h2>Documentation Consistency Workbench</h2>
        <p>Compare documented claims with detected project reality. Preview is observational; source writes require explicit confirmation and a fresh verification audit.</p>
      </div>
      <button onClick={() => void loadAudit()}>Refresh documentation audit</button>
    </div>

    <div className="kw-summary-grid" role="region" aria-label="Documentation audit summary">
      <article><strong>{documents.length}</strong><span>Documents audited</span></article>
      <article><strong>{findings.length}</strong><span>Contradictions</span></article>
      <article><strong>{high}</strong><span>High severity</span></article>
      <article><strong>{automatic}</strong><span>Exact replacement candidates</span></article>
    </div>

    <div className="kw-toolbar" aria-label="Documentation finding filters">
      <label>Search claims<input aria-label="Search documentation findings" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="claim, evidence, actual state…" /></label>
      <label>Severity<select aria-label="Documentation severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
      <label>Document<select aria-label="Documentation source" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)}><option value="all">All documents</option>{documents.map((document) => <option key={document} value={document}>{document}</option>)}</select></label>
    </div>

    {visible.length ? <div className="kw-quality-list" aria-label="Documentation findings">
      {visible.map((finding, index) => <article className="kw-quality-card" data-selected={String(finding.id || "") === selectedId ? "true" : "false"} key={String(finding.id || index)}>
        <h2>{text(finding.sourceDocument, `Documentation finding ${index + 1}`)}</h2>
        <div className="kw-row-badges"><StatusBadge value={finding.severity} />{record(finding.fix) ? <StatusBadge value="EXACT_FIX" /> : <StatusBadge value="MANUAL_REVIEW" />}</div>
        <p>{text(finding.claim)}</p>
        <small>{text(finding.actualState)}</small>
        <button onClick={() => selectFinding(finding)}>Select documentation finding</button>
      </article>)}
    </div> : <EmptyState title="No matching documentation findings" detail="The current filters match no audited contradiction. KForge does not synthesize documentation issues." />}

    {selected ? <section className="kw-operation-result" role="region" aria-label="Selected documentation finding">
      <div className="kw-toolbar"><h3>{text(selected.sourceDocument)}</h3><div className="kw-row-badges"><StatusBadge value={selected.severity} /></div></div>
      <dl>
        <dt>Documented claim</dt><dd>{text(selected.claim)}</dd>
        <dt>Observed evidence</dt><dd>{text(selected.evidence)}</dd>
        <dt>Actual project state</dt><dd>{text(selected.actualState)}</dd>
        <dt>Suggested correction</dt><dd>{text(selected.suggestedFix)}</dd>
      </dl>
      <button onClick={() => void preview()} disabled={fixState === "CHECKING"}>Check safe documentation fix</button>
      <details><summary>Advanced finding evidence</summary><pre>{JSON.stringify(selected, null, 2)}</pre></details>
    </section> : null}

    <section className="kw-operation-result" role="region" aria-label="Documentation fix evidence" data-fix-state={fixState}>
      <h3>Verified documentation fix evidence</h3>
      <p>Preview never writes. Apply authority exists only for the currently selected finding and the currently verified exact patch.</p>
      <StatusBadge value={fixState} />
      {fixState === "AVAILABLE" && patch ? <dl>
        <dt>Document</dt><dd>{text(patch.document)}</dd>
        <dt>Before</dt><dd>{text(patch.before)}</dd>
        <dt>After</dt><dd>{text(patch.after)}</dd>
      </dl> : null}
      {fixState === "MANUAL_REVIEW" ? <p>{text(previewEvidence?.reason, "This finding requires manual review; no exact safe replacement is available.")}</p> : null}
      {fixState === "AVAILABLE" && selectedId === previewFindingId ? <button onClick={() => void apply()}>Apply verified documentation fix</button> : null}
      {previewEvidence ? <details><summary>Advanced preview evidence</summary><pre>{JSON.stringify(previewEvidence, null, 2)}</pre></details> : null}
    </section>

    {applyState !== "IDLE" ? <section className="kw-operation-result" role="region" aria-label="Documentation fix operation" data-apply-state={applyState}>
      <h3>Documentation fix operation</h3><StatusBadge value={applyState} />
      {applyState === "SUCCEEDED" ? <p>The confirmed source edit was re-audited and the original finding is no longer present.</p> : null}
      {applyEvidence ? <details><summary>Advanced apply evidence</summary><pre>{JSON.stringify(applyEvidence, null, 2)}</pre></details> : null}
    </section> : null}

    {message && <p className="kw-message" role="status">{message}</p>}
    {audit?.auditedAt ? <small>Audit evidence timestamp: {String(audit.auditedAt)}</small> : null}
  </section>;
}

export default DocumentationConsistencyWorkbench;
