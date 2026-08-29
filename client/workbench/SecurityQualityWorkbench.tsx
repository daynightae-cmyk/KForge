import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence, fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";
type SecurityToolId = "gitleaks" | "semgrep" | "sonar" | "npm-audit";
type SecurityToolState = "AVAILABLE" | "UNAVAILABLE" | "CONFIGURED" | "FAILED" | "PASSED" | "BLOCKED";

type SecurityFinding = {
  id: string;
  title?: string;
  description?: string;
  message?: string;
  severity: SecuritySeverity;
  category?: string;
  source?: string;
  rule?: string;
  file?: string;
  line?: number;
  confidence?: string;
  risk?: string;
  suggestion?: string;
};

type SecurityTool = {
  id: SecurityToolId;
  label: string;
  state: SecurityToolState;
  version?: string;
  detail: string;
  lastRun?: string;
  exitCode?: number;
  findings?: SecurityFinding[];
};

type PlatformEvidence = {
  mode: "offline" | "local-first" | "online-optional" | "online";
  policy: { externalMetadataReads: boolean };
};

type ToolRunEvidence = {
  projectId?: string;
  tool?: SecurityTool;
  transparency?: {
    execution?: string;
    network?: string;
    dataClasses?: string[];
    projectSourceSent?: boolean;
    provider?: string;
    destination?: string;
    purpose?: string;
    confirmation?: string;
    result?: string;
    reason?: string;
  };
  error?: string;
};

const severityOrder: Record<SecuritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const remoteTools = new Set<SecurityToolId>(["sonar", "npm-audit"]);

function publicToolEvidence(tool: SecurityTool) {
  return {
    id: tool.id,
    label: tool.label,
    state: tool.state,
    version: tool.version || null,
    detail: tool.detail,
    lastRun: tool.lastRun || null,
    exitCode: tool.exitCode ?? null,
    findings: tool.findings || [],
  };
}

function disclosure(tool: SecurityTool) {
  if (tool.id === "sonar") return {
    network: "REQUIRED",
    data: "Project context, source code, and credential references may be sent to the configured Sonar server.",
    destination: "Configured Sonar server (redacted by backend evidence)",
  };
  if (tool.id === "npm-audit") return {
    network: "REQUIRED",
    data: "Dependency metadata from package-lock.json is sent to the npm registry for vulnerability advisories; project source is not sent by this operation.",
    destination: "npm registry",
  };
  return { network: "NOT_REQUIRED", data: "The tool executes locally against the selected project.", destination: "Selected local project" };
}

export default function SecurityQualityWorkbench({ project }: { project: ProjectSummary }) {
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [tools, setTools] = useState<SecurityTool[]>([]);
  const [platform, setPlatform] = useState<PlatformEvidence | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<SecurityToolId | null>(null);
  const [reviewedDisclosureId, setReviewedDisclosureId] = useState<SecurityToolId | null>(null);
  const [runEvidence, setRunEvidence] = useState<ToolRunEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const trusted = project.trust === "trusted";

  const loadEvidence = async (invalidateRunAuthority = true) => {
    if (invalidateRunAuthority) {
      setReviewedDisclosureId(null);
      setRunEvidence(null);
    }
    setLoading(true);
    setMessage("");
    try {
      const [problemData, toolData, platformData] = await Promise.all([
        fetchJson<{ problems: SecurityFinding[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`),
        fetchJson<{ tools: SecurityTool[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/security/tools`),
        fetchJson<PlatformEvidence>("/api/workspace/platform"),
      ]);
      const securityFindings = (problemData.problems || [])
        .filter((finding) => finding.category === "security")
        .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
      const nextTools = Array.isArray(toolData.tools) ? toolData.tools : [];
      setFindings(securityFindings);
      setTools(nextTools);
      setPlatform(platformData);
      setSelectedToolId((current) => current && nextTools.some((tool) => tool.id === current) ? current : nextTools[0]?.id || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Security evidence unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedToolId(null);
    setReviewedDisclosureId(null);
    setRunEvidence(null);
    void loadEvidence();
  }, [project.id, project.trust]);

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === selectedToolId) || null, [tools, selectedToolId]);
  const selectedIsRemote = Boolean(selectedTool && remoteTools.has(selectedTool.id));
  const selectedDisclosure = selectedTool ? disclosure(selectedTool) : null;
  const networkAllowed = !selectedIsRemote || Boolean(platform?.policy.externalMetadataReads);
  const disclosureReviewed = Boolean(selectedTool && reviewedDisclosureId === selectedTool.id);
  const toolRunnable = Boolean(selectedTool && selectedTool.state === "AVAILABLE");
  const canRun = Boolean(selectedTool && trusted && toolRunnable && networkAllowed && (!selectedIsRemote || disclosureReviewed) && !running);

  const severityCounts = useMemo(() => ({
    critical: findings.filter((finding) => finding.severity === "critical").length,
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    low: findings.filter((finding) => finding.severity === "low").length,
  }), [findings]);

  const selectTool = (tool: SecurityTool) => {
    setSelectedToolId(tool.id);
    setReviewedDisclosureId(null);
    setRunEvidence(null);
    setMessage("");
  };

  const reviewDisclosure = () => {
    if (!selectedTool || !selectedIsRemote) return;
    setReviewedDisclosureId(selectedTool.id);
    setMessage("Network disclosure reviewed. No security tool has been run and no remote service has been contacted.");
  };

  const runSelectedTool = async () => {
    if (!selectedTool || !canRun) return;
    const remote = remoteTools.has(selectedTool.id);
    if (remote && !window.confirm(`Run ${selectedTool.label} after the reviewed network disclosure?`)) return;
    setRunning(true);
    setMessage(`Running ${selectedTool.label} with backend-owned security policy…`);
    try {
      const response = await fetchEvidence(
        `/api/workspace/projects/${encodeURIComponent(project.id)}/security/tools/${encodeURIComponent(selectedTool.id)}/run`,
        jsonRequest(remote ? { confirmed: true } : {}),
      );
      setRunEvidence(response.data as ToolRunEvidence);
      setReviewedDisclosureId(null);
      const returned = (response.data as ToolRunEvidence).tool;
      setMessage(response.ok
        ? `${returned?.label || selectedTool.label} completed with state ${returned?.state || "UNKNOWN"}. Run authority was cleared.`
        : (response.data as ToolRunEvidence).error || returned?.detail || `${selectedTool.label} did not complete successfully.`);
      await loadEvidence(false);
    } catch (error) {
      setReviewedDisclosureId(null);
      setMessage(error instanceof Error ? error.message : "Security tool execution failed.");
    } finally {
      setRunning(false);
    }
  };

  const unavailableReason = !selectedTool ? "Select a security tool."
    : !trusted ? "Project trust is required before local executable probing or security tool execution."
      : !toolRunnable ? selectedTool.detail
        : !networkAllowed ? `${platform?.mode || "offline"} mode blocks this network-required security operation.`
          : selectedIsRemote && !disclosureReviewed ? "Review the network data disclosure before enabling this remote security operation."
            : "";

  return (
    <section className="kw-surface-section" role="region" aria-label="KForge Quality Security">
      <div className="kw-toolbar">
        <div>
          <h2>Security Evidence Workbench</h2>
          <p>Correlate bounded local scanner findings with detected security tools. Opening or refreshing this surface never runs a tool or contacts a remote service.</p>
        </div>
        <button onClick={() => void loadEvidence(true)} disabled={loading || running}>Refresh security evidence</button>
      </div>

      <section className="kw-operation-result" role="region" aria-label="Security summary">
        <div className="kw-row-badges">
          <StatusBadge value={`${severityCounts.critical} CRITICAL`} />
          <StatusBadge value={`${severityCounts.high} HIGH`} />
          <StatusBadge value={`${severityCounts.medium} MEDIUM`} />
          <StatusBadge value={`${severityCounts.low} LOW`} />
          <StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} />
          <StatusBadge value={(platform?.mode || "UNKNOWN").toUpperCase()} />
        </div>
        <p>Scanner findings are read-only evidence. Tool execution is explicit, trust-bound, and network-required tools add a separate disclosure review before confirmation.</p>
      </section>

      {message && <p className="kw-message" role="status">{message}</p>}
      {loading && <p className="kw-message" role="status">Loading current local security evidence…</p>}

      <section aria-label="Security tool inventory">
        <h3>Security Tool Manager</h3>
        <div className="kw-quality-list">
          {tools.map((tool) => {
            const remote = remoteTools.has(tool.id);
            return (
              <article className="kw-quality-card" key={tool.id} data-tool-id={tool.id} data-selected={tool.id === selectedToolId ? "true" : "false"}>
                <div className="kw-row-badges">
                  <StatusBadge value={tool.state} />
                  <StatusBadge value={remote ? "NETWORK_REQUIRED" : "LOCAL"} />
                </div>
                <h3>{tool.label}</h3>
                <p>{tool.detail}</p>
                <small>{tool.version ? `Version ${tool.version}` : "Version not measured"}</small>
                <div className="kw-quality-actions"><button onClick={() => selectTool(tool)}>Select {tool.label}</button></div>
                <details><summary>Advanced tool evidence</summary><pre>{JSON.stringify(publicToolEvidence(tool), null, 2)}</pre></details>
              </article>
            );
          })}
        </div>
      </section>

      {selectedTool && selectedDisclosure && (
        <section className="kw-operation-result" role="region" aria-label="Selected security tool">
          <div className="kw-toolbar">
            <div>
              <h3>{selectedTool.label}</h3>
              <p>{selectedTool.detail}</p>
            </div>
            <div className="kw-row-badges">
              <StatusBadge value={selectedTool.state} />
              <StatusBadge value={selectedDisclosure.network} />
              {selectedIsRemote && <StatusBadge value={disclosureReviewed ? "DISCLOSURE_REVIEWED" : "DISCLOSURE_REQUIRED"} />}
            </div>
          </div>
          <h4>Execution disclosure</h4>
          <p>{selectedDisclosure.data}</p>
          <p><strong>Destination:</strong> {selectedDisclosure.destination}</p>
          {selectedIsRemote && !disclosureReviewed && <button onClick={reviewDisclosure}>Review data disclosure</button>}
          <div className="kw-quality-actions">
            <button onClick={() => void runSelectedTool()} disabled={!canRun}>{running ? `Running ${selectedTool.label}…` : `Run ${selectedTool.label}`}</button>
          </div>
          {!canRun && unavailableReason && <p className="kw-message">{unavailableReason}</p>}
        </section>
      )}

      <section aria-label="Normalized security findings">
        <h3>Normalized security findings</h3>
        {findings.length ? (
          <div className="kw-quality-list">
            {findings.map((finding) => (
              <article className="kw-quality-card" key={finding.id}>
                <div className="kw-row-badges">
                  <StatusBadge value={finding.severity} />
                  <StatusBadge value={finding.source || "KFORGE_SCANNER"} />
                  {finding.confidence && <StatusBadge value={`${finding.confidence}_confidence`} />}
                </div>
                <h3>{finding.title || finding.message || finding.id}</h3>
                <p>{finding.description || finding.message || "No additional finding description is available."}</p>
                {(finding.file || finding.line) && <small>{finding.file || "project"}{finding.line ? `:${finding.line}` : ""}</small>}
                {finding.rule && <p><strong>Rule:</strong> {finding.rule}</p>}
                {finding.suggestion && <p><strong>Suggested review:</strong> {finding.suggestion}</p>}
              </article>
            ))}
          </div>
        ) : <EmptyState title="No current security finding" detail="The bounded local scanner produced no security finding in the current evidence. KForge does not turn missing external-tool runs into a security PASS." />}
      </section>

      {runEvidence && (
        <section className="kw-operation-result" role="region" aria-label="Security tool run evidence">
          <div className="kw-row-badges">
            <StatusBadge value={runEvidence.tool?.state || runEvidence.transparency?.result || "UNKNOWN"} />
            <StatusBadge value={runEvidence.transparency?.network || "UNKNOWN_NETWORK"} />
          </div>
          <h3>{runEvidence.tool?.label || "Security tool execution"}</h3>
          <p>{runEvidence.tool?.detail || runEvidence.error || "Backend execution evidence returned without a detail message."}</p>
          {runEvidence.transparency?.purpose && <p>{runEvidence.transparency.purpose}</p>}
          {(runEvidence.tool?.findings || []).length > 0 && <p>{runEvidence.tool?.findings?.length} normalized tool finding(s) require review.</p>}
          <details><summary>Advanced run evidence</summary><pre>{JSON.stringify({ tool: runEvidence.tool ? publicToolEvidence(runEvidence.tool) : null, transparency: runEvidence.transparency || null, error: runEvidence.error || null }, null, 2)}</pre></details>
        </section>
      )}
    </section>
  );
}
