import { useState } from "react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import ReleaseDistributionWorkbench from "./ReleaseDistributionWorkbench";
import { ProjectRequired } from "./ProjectStartActions";
import { CheckCircle2, CircleDashed, Clock3, GitBranch, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";

function ReleaseSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <ProjectRequired detail="Release evidence is project scoped." />;
  if (view === "release-gate") return <ReleaseGate project={project} onExecution={onExecution} />;
  if (view === "release-preparation" || view === "artifacts" || view === "versioning") return <ReleaseDistributionWorkbench project={project} view={view} />;
  return <EmptyState title="Specialized release surface unavailable" detail="This Release view has no canonical specialized implementation. KForge does not fall back to raw JSON as the primary release UX." />;
}

function ReleaseGate({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<RecordRow | null>(null);
  const [message, setMessage] = useState("");
  const order = ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"];

  const run = async () => {
    onExecution({ label: "Release Gate", state: "RUNNING", source: "KForge release evidence engine" });
    const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/release-gate`, { method: "POST" });
    if (response.data.verdicts) {
      setData(response.data);
      setMessage(response.ok ? "" : "Release Gate is blocked; independent source verdicts remain visible.");
      onExecution({ label: "Release Gate", state: String(response.data.readiness || "UNKNOWN"), source: "KForge release evidence engine" });
    } else {
      setMessage(String(response.data.error || "Release Gate failed."));
    }
  };

  const verdicts = (data?.verdicts || {}) as Record<string, RecordRow>;
  const evaluated = Object.keys(verdicts).length;
  const passing = Object.values(verdicts).filter((verdict) => /^(PASS|PASSED|READY|SUCCESS|VERIFIED)$/i.test(String(verdict.state || "").trim())).length;
  const readiness = String(data?.readiness || "NOT_EVALUATED");
  const isPositive = /READY|PASS|SUCCESS/i.test(readiness);

  return <div className="kf-stack kw-release">
    <header className="kf-hero-band kw-release-banner">
      <div className="kw-release-banner__copy"><small>INDEPENDENT RELEASE EVIDENCE · {project.name}</small><h2>{data?.version ? `${String(data.version)} readiness` : "Release readiness"}</h2><p>Source, local, desktop, installer and remote evidence remain independent verdicts. A Windows PASS never implies CI PASS.</p></div>
      <div className="kw-release-banner__actions">
        <StatusBadge value={readiness} />
        <button className="kf-btn kf-btn--primary" onClick={() => void run()}><Rocket size={14} />Run Release Gate</button>
      </div>
    </header>

    <section className="kf-stat-grid" aria-label="Release readiness summary">
      <article className="kf-stat"><span className="kf-tile"><Rocket size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Release readiness</span><strong className={`kf-stat__value ${isPositive ? "is-positive" : ""}`} style={{ fontSize: 18 }}>{readiness.replace(/_/g, " ")}</strong><span className="kf-stat__foot">Independent evidence verdict</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--blue"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Gate domains</span><strong className="kf-stat__value">{evaluated}<small> / {order.length}</small></strong><span className="kf-stat__foot">Evaluated in this run</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--green"><CheckCircle2 size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Passing domains</span><strong className="kf-stat__value">{passing}</strong><span className="kf-stat__foot">No inferred pass</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--amber"><TriangleAlert size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Non-passing</span><strong className="kf-stat__value">{Math.max(0, evaluated - passing)}</strong><span className="kf-stat__foot">Blocked or unknown evidence</span></div></article>
    </section>

    <section className="kf-card kw-release-pipeline" aria-label="Release evidence pipeline">
      <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile"><GitBranch size={17} /></span><div><h2>Release Evidence</h2><p>Every mandatory domain is evaluated independently.</p></div></div><span className="kf-chip">{data ? "Gate evaluated" : "Gate not run"}</span></header>
      <div className="kw-release-steps">
        {order.map((kind, index) => {
          const state = String(verdicts[kind]?.state || (data ? "UNKNOWN" : "NOT_EVALUATED"));
          const positive = /^(PASS|PASSED|READY|SUCCESS|VERIFIED)$/i.test(state);
          const negative = /FAIL|BLOCK|ERROR/i.test(state);
          return <div className="kw-release-step" key={kind} data-state={positive ? "pass" : negative ? "fail" : "pending"}>
            <span className="kw-release-step__mark">{positive ? <CheckCircle2 size={14} /> : negative ? <TriangleAlert size={14} /> : <CircleDashed size={14} />}</span>
            <strong>{kind.replace(/_/g, " ")}</strong>
            <small>{state.replace(/_/g, " ")}</small>
            {index < order.length - 1 ? <i className="kw-release-step__line" aria-hidden="true" /> : null}
          </div>;
        })}
      </div>
      {message ? <p className="kw-release-message" role="status">{message}</p> : null}
    </section>

    {data ? (
      <div className="kw-release-verdicts kw-release-grid">
        {order.map((kind) => {
          const verdict = verdicts[kind] || {};
          const state = String(verdict.state || "UNKNOWN");
          return <article className="kf-card kw-release-verdict" key={kind}><header><span className="kf-eyebrow">{kind.replace(/_/g, " ")}</span><StatusBadge value={state} /></header><strong>{String(verdict.source || "No source evidence")}</strong><small><Clock3 size={11} /> {String(verdict.timestamp || "NO_TIMESTAMP")} · {String(verdict.freshness || "UNKNOWN")}</small><details><summary>Domain evidence</summary><pre>{JSON.stringify(verdict, null, 2)}</pre></details></article>;
        })}
      </div>
    ) : null}
  </div>;
}

export default ReleaseSurface;
