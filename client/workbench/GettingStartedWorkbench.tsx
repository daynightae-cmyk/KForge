import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleDashed,
  CircleSlash,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { SurfaceProps } from "./surfaceContracts";
import { deriveProviderEvidence, buildSetupPath, type SetupProviderEvidence, type SetupStatus } from "./gettingStartedModel";
import { fetchJson } from "./api";
import { StatusBadge } from "./ui";
import { KForgeBrandLockup } from "@/components/brand/KForgeBrandLockup";
import { ProjectStartActions } from "./ProjectStartActions";
import "./gettingStarted.css";

type HealthEvidenceSummary = { path: string; scannedAt: string };

const STATUS_ICON: Record<SetupStatus, typeof BadgeCheck> = {
  COMPLETE: BadgeCheck,
  ACTION_REQUIRED: CircleAlert,
  BLOCKED: CircleSlash,
  NOT_EVALUATED: CircleDashed,
};

/**
 * Get Started is an evidence reader, not a checklist that advances by being
 * visited. Every step status is derived from workspace, trust, policy, provider
 * and persisted scan evidence that KForge already owns. When evidence is not
 * available the step says so instead of reporting progress.
 */
function GettingStartedWorkbench({ workspace, project, settings, onNavigate, onRefresh }: SurfaceProps) {
  const [providers, setProviders] = useState<SetupProviderEvidence | null | undefined>(undefined);
  const [scanAt, setScanAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setMessage("");
    void (async () => {
      const [providerResult, healthResult] = await Promise.allSettled([
        fetchJson<{ providers: Array<{ authState?: string; credentialState?: string; health?: string }> }>(
          "/api/workspace/ai/command-center/providers",
          { signal: controller.signal },
        ),
        fetchJson<{ summaries: HealthEvidenceSummary[] }>(
          "/api/workspace/projects/health-evidence",
          { signal: controller.signal },
        ),
      ]);
      if (cancelled || controller.signal.aborted) return;
      setProviders(providerResult.status === "fulfilled" ? deriveProviderEvidence(providerResult.value.providers) : null);
      if (project && healthResult.status === "fulfilled") {
        const match = healthResult.value.summaries.find((summary) => summary.path === project.path);
        setScanAt(match?.scannedAt ?? null);
      } else {
        setScanAt(null);
      }
      setLoading(false);
      if (providerResult.status === "rejected" || healthResult.status === "rejected") {
        setMessage("Some setup evidence could not be read in this session. The affected steps remain unevaluated rather than reporting progress.");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [project?.path, reloadKey]);

  const path = useMemo(
    () => buildSetupPath({ workspace, project, settings, providers: providers === undefined ? null : providers, scanAt }),
    [workspace, project, settings, providers, scanAt],
  );

  const refreshEvidence = async () => {
    setReloadKey((value) => value + 1);
    await onRefresh();
  };

  return (
    <section className="kw-getting-started" aria-label="KForge Get Started">
      <header className="kw-getting-started__hero">
        <div className="kw-getting-started__copy">
          <KForgeBrandLockup size="standard" showTagline arabicFirst />
          <hr />
          <small>EVIDENCE-BASED ONBOARDING</small>
          <h2>Start from the machine you actually have.</h2>
          <p>
            Get Started reads the workspace, project trust, operating policy, provider inventory and persisted
            scan evidence. Opening this guide never completes a step by itself, and a recommendation is never a
            readiness claim.
          </p>
        </div>
        <div className="kw-getting-started__progress" aria-live="polite">
          <div
            className="kw-getting-started__meter"
            role="progressbar"
            aria-label="Core setup progress"
            aria-valuemin={0}
            aria-valuemax={path.coreTotal}
            aria-valuenow={path.coreComplete}
            aria-valuetext={`${path.coreComplete} of ${path.coreTotal} core steps have evidence`}
          >
            <span style={{ width: `${path.corePercent}%` }} />
          </div>
          <strong>{path.coreComplete} / {path.coreTotal}</strong>
          <span>core steps backed by evidence</span>
          <span className={`kw-getting-started__readiness ${path.readyToWork ? "is-ready" : ""}`}>
            {path.readyToWork ? <><ShieldCheck size={14} />Ready to work with the active project</> : <><Sparkles size={14} />Core setup still has an open step</>}
          </span>
          <small>{path.recommendedComplete} of {path.recommendedTotal} recommendations complete</small>
          <button type="button" onClick={() => void refreshEvidence()} disabled={loading}>
            <RefreshCw size={13} className={loading ? "kw-spin" : ""} />
            {loading ? "Reading setup evidence…" : "Refresh evidence"}
          </button>
        </div>
      </header>

      {loading ? <p className="kw-message" role="status">Reading setup evidence…</p> : null}
      {message ? <p className="kw-message" role="status">{message}</p> : null}

      {!project ? (
        <section className="kw-getting-started__bootstrap" aria-label="Add your first project">
          <div>
            <small>STEP ZERO</small>
            <h3>No project is active yet</h3>
            <p>Open a local directory or clone a repository. Clone remains policy-controlled and requires explicit confirmation.</p>
          </div>
          <ProjectStartActions compact />
        </section>
      ) : null}

      <section className="kw-getting-started__track" aria-label="Core setup">
        <header>
          <div>
            <small>CORE</small>
            <h3>Required before project work</h3>
          </div>
          <span>{path.coreComplete} of {path.coreTotal} complete</span>
        </header>
        <ol>
          {path.core.map((step, index) => {
            const Icon = STATUS_ICON[step.status];
            return (
              <li key={step.id} className={`kw-getting-started__step is-${step.status.toLowerCase().replace(/_/g, "-")}`}>
                <span className="kw-getting-started__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className="kw-getting-started__step-body">
                  <header>
                    <strong>{step.title}</strong>
                    <span className="kw-getting-started__status"><Icon size={13} aria-hidden="true" /><StatusBadge value={step.status} /></span>
                  </header>
                  <p>{step.summary}</p>
                  <small>{step.evidence}</small>
                </div>
                <button type="button" className="kw-getting-started__action" onClick={() => onNavigate(step.target.activity, step.target.view)}>
                  {step.actionLabel}<ArrowRight size={13} />
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="kw-getting-started__track" aria-label="Recommended setup">
        <header>
          <div>
            <small>RECOMMENDED</small>
            <h3>Useful, never required for core readiness</h3>
          </div>
          <span>{path.recommendedComplete} of {path.recommendedTotal} complete</span>
        </header>
        <ol>
          {path.recommended.map((step, index) => {
            const Icon = STATUS_ICON[step.status];
            return (
              <li key={step.id} className={`kw-getting-started__step is-${step.status.toLowerCase().replace(/_/g, "-")}`}>
                <span className="kw-getting-started__index" aria-hidden="true">R{index + 1}</span>
                <div className="kw-getting-started__step-body">
                  <header>
                    <strong>{step.title}</strong>
                    <span className="kw-getting-started__status"><Icon size={13} aria-hidden="true" /><StatusBadge value={step.status} /></span>
                  </header>
                  <p>{step.summary}</p>
                  <small>{step.evidence}</small>
                </div>
                <button type="button" className="kw-getting-started__action" onClick={() => onNavigate(step.target.activity, step.target.view)}>
                  {step.actionLabel}<ArrowRight size={13} />
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="kw-getting-started__footer">
        <ShieldCheck size={15} aria-hidden="true" />
        <p>
          Status reflects local evidence at the moment it was read. Trust and policy gates are never bypassed by
          this guide, and provider or scan recommendations do not contact a network service.
        </p>
      </footer>
    </section>
  );
}

export default GettingStartedWorkbench;
