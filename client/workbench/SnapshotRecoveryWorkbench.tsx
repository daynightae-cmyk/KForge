import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

type SnapshotFileEvidence = {
  path: string;
  existed: boolean;
};

type SnapshotManifestEvidence = {
  id: string;
  projectPath: string;
  createdAt: string;
  reason: string;
  files: SnapshotFileEvidence[];
};

type RecoveryOperation = {
  state: "IDLE" | "RESTORING" | "SUCCEEDED" | "FAILED";
  snapshotId?: string;
  detail?: string;
};

function safeDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value || "UNKNOWN" : parsed.toLocaleString();
}

function publicEvidence(snapshot: SnapshotManifestEvidence) {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    files: snapshot.files.map((file) => ({ path: file.path, existed: file.existed })),
  };
}

export default function SnapshotRecoveryWorkbench({ project }: { project: ProjectSummary }) {
  const [snapshots, setSnapshots] = useState<SnapshotManifestEvidence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewedId, setReviewedId] = useState<string | null>(null);
  const [files, setFiles] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<RecoveryOperation>({ state: "IDLE" });

  const trusted = project.trust === "trusted";

  const loadSnapshots = async (invalidateAuthority = true) => {
    if (invalidateAuthority) {
      setReviewedId(null);
      setOperation({ state: "IDLE" });
    }
    setLoading(true);
    setMessage("");
    try {
      const data = await fetchJson<{ snapshots: SnapshotManifestEvidence[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots`);
      const next = Array.isArray(data.snapshots) ? data.snapshots : [];
      setSnapshots(next);
      setSelectedId((current) => current && next.some((snapshot) => snapshot.id === current) ? current : next[0]?.id || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Snapshot evidence unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedId(null);
    setReviewedId(null);
    setOperation({ state: "IDLE" });
    void loadSnapshots();
  }, [project.id]);

  const selected = useMemo(() => snapshots.find((snapshot) => snapshot.id === selectedId) || null, [snapshots, selectedId]);
  const restoreFiles = selected?.files.filter((file) => file.existed) || [];
  const removalFiles = selected?.files.filter((file) => !file.existed) || [];
  const reviewCurrent = Boolean(selected && reviewedId === selected.id);

  const selectSnapshot = (snapshot: SnapshotManifestEvidence) => {
    setSelectedId(snapshot.id);
    setReviewedId(null);
    setOperation({ state: "IDLE" });
    setMessage("");
  };

  const createSnapshot = async () => {
    const requestedFiles = files.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
    if (!requestedFiles.length) {
      setMessage("Select at least one project file before creating a snapshot.");
      return;
    }
    if (!trusted) {
      setMessage("Project trust is required before KForge writes snapshot evidence under .kforge.");
      return;
    }
    if (!window.confirm(`Create a local snapshot for ${requestedFiles.length} reviewed file(s)?`)) return;
    try {
      const data = await fetchJson<{ snapshot: SnapshotManifestEvidence }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots`, jsonRequest({
        files: requestedFiles,
        reason: reason.trim() || "KForge manual snapshot",
        confirmed: true,
      }));
      setFiles("");
      setReason("");
      setReviewedId(null);
      setOperation({ state: "IDLE" });
      await loadSnapshots(false);
      if (data.snapshot?.id) setSelectedId(data.snapshot.id);
      setMessage(`Snapshot created: ${data.snapshot?.id || "recorded"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Snapshot creation failed.");
    }
  };

  const reviewRestorePlan = () => {
    if (!selected) return;
    setReviewedId(selected.id);
    setOperation({ state: "IDLE" });
    setMessage("Restore plan reviewed. No project file has been changed.");
  };

  const restoreReviewedSnapshot = async () => {
    if (!selected || reviewedId !== selected.id) {
      setMessage("Review the current snapshot restore plan before restoring it.");
      return;
    }
    if (!trusted) {
      setMessage("Project trust is required before snapshot restore can write project files.");
      return;
    }
    if (!window.confirm(`Restore reviewed snapshot ${selected.id}? This will write or remove only the files listed in the reviewed plan.`)) return;
    setOperation({ state: "RESTORING", snapshotId: selected.id, detail: "Restoring reviewed local snapshot…" });
    try {
      await fetchJson(`/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots/${encodeURIComponent(selected.id)}/restore`, jsonRequest({ confirmed: true }));
      setReviewedId(null);
      setOperation({ state: "SUCCEEDED", snapshotId: selected.id, detail: `${selected.files.length} reviewed file operation(s) restored from local snapshot evidence.` });
      await loadSnapshots(false);
      setMessage(`Snapshot ${selected.id} restored. Review authority was cleared after the write.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Snapshot restore failed.";
      setOperation({ state: "FAILED", snapshotId: selected.id, detail });
      setReviewedId(null);
      setMessage(detail);
    }
  };

  return (
    <section className="kw-surface-section" role="region" aria-label="KForge Snapshot Recovery">
      <div className="kw-toolbar">
        <div>
          <h2>Snapshot Recovery Workbench</h2>
          <p>Capture explicit local file state, review the restore plan without writes, then restore only after trust and confirmation.</p>
        </div>
        <button onClick={() => void loadSnapshots(true)} disabled={loading}>Refresh snapshots</button>
      </div>

      <section className="kw-operation-result" role="region" aria-label="Recovery summary">
        <div className="kw-row-badges">
          <StatusBadge value={`${snapshots.length} SNAPSHOTS`} />
          <StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} />
          <StatusBadge value={reviewCurrent ? "REVIEWED" : "NOT_REVIEWED"} />
        </div>
        <p>Snapshot creation and restore are local writes. Listing, selection, and restore-plan review do not modify project files.</p>
      </section>

      <section className="kw-snapshot-form" aria-label="Create local snapshot">
        <h3>Create recovery point</h3>
        <label>
          Files to snapshot
          <input aria-label="Files to snapshot" value={files} onChange={(event) => setFiles(event.target.value)} placeholder="src/file.ts, config.txt" />
        </label>
        <label>
          Snapshot reason
          <input aria-label="Snapshot reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Before configuration change" />
        </label>
        <button onClick={() => void createSnapshot()} disabled={!trusted || !files.trim()}>Create snapshot</button>
        {!trusted && <small>Project trust is required before creating or restoring snapshots.</small>}
      </section>

      {message && <p className="kw-message" role="status">{message}</p>}

      {loading ? <p className="kw-message" role="status">Loading persisted local snapshots…</p> : snapshots.length ? (
        <div className="kw-quality-list" aria-label="Available recovery snapshots">
          {snapshots.map((snapshot) => (
            <article className="kw-quality-card" key={snapshot.id} data-selected={snapshot.id === selectedId ? "true" : "false"}>
              <div className="kw-row-badges">
                <StatusBadge value={snapshot.id === selectedId ? "SELECTED" : "AVAILABLE"} />
                <StatusBadge value={`${snapshot.files.length} FILES`} />
              </div>
              <h3>{snapshot.reason || snapshot.id}</h3>
              <p>{safeDate(snapshot.createdAt)}</p>
              <small>{snapshot.id}</small>
              <div className="kw-quality-actions">
                <button onClick={() => selectSnapshot(snapshot)}>Select snapshot</button>
              </div>
              <details>
                <summary>Advanced snapshot evidence</summary>
                <pre>{JSON.stringify(publicEvidence(snapshot), null, 2)}</pre>
              </details>
            </article>
          ))}
        </div>
      ) : <EmptyState title="No recovery snapshots" detail="No persisted local snapshot exists for this project. KForge does not invent recovery history." />}

      {selected && (
        <section className="kw-operation-result" role="region" aria-label="Selected recovery snapshot">
          <div className="kw-toolbar">
            <div>
              <h3>{selected.reason || selected.id}</h3>
              <p>{safeDate(selected.createdAt)} · {selected.files.length} captured file(s)</p>
            </div>
            <StatusBadge value={reviewCurrent ? "REVIEWED" : "REVIEW_REQUIRED"} />
          </div>

          <section role="region" aria-label="Restore plan" data-review-state={reviewCurrent ? "REVIEWED" : "NOT_REVIEWED"}>
            <h3>Restore plan</h3>
            <p>This review is read-only. It describes exactly what the existing snapshot engine will do if restore is confirmed.</p>
            <div className="kw-quality-list">
              {selected.files.map((file) => (
                <article className="kw-quality-card" key={file.path}>
                  <div className="kw-row-badges">
                    <StatusBadge value={file.existed ? "RESTORE" : "REMOVE_IF_PRESENT"} />
                  </div>
                  <h4>{file.path}</h4>
                  <p>{file.existed ? "Restore the bytes captured when this snapshot was created." : "Remove this path if it exists now, because it did not exist at snapshot time."}</p>
                </article>
              ))}
            </div>
            <div className="kw-row-badges">
              <StatusBadge value={`${restoreFiles.length} RESTORE`} />
              <StatusBadge value={`${removalFiles.length} REMOVE_IF_PRESENT`} />
            </div>
          </section>

          <div className="kw-quality-actions">
            <button onClick={reviewRestorePlan}>Review restore plan</button>
            {reviewCurrent && <button onClick={() => void restoreReviewedSnapshot()} disabled={!trusted || operation.state === "RESTORING"}>Restore reviewed snapshot</button>}
          </div>
        </section>
      )}

      {operation.state !== "IDLE" && (
        <section className="kw-operation-result" role="region" aria-label="Recovery operation" data-recovery-state={operation.state}>
          <div className="kw-row-badges"><StatusBadge value={operation.state} /></div>
          <p>{operation.detail}</p>
          {operation.snapshotId && <small>{operation.snapshotId}</small>}
        </section>
      )}
    </section>
  );
}
