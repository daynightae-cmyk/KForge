import type { ReactNode } from "react";
import type { RecordRow, TaskRow } from "./surfaceContracts";

export function StatusBadge({ value }: { value?: unknown }) {
  const normalized = String(value ?? "UNKNOWN").toUpperCase().replace(/\s+/g, "_");
  return <span className={`kw-badge kw-badge--${normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{normalized}</span>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="kw-empty" aria-label={title}><h2>{title}</h2><p>{detail}</p>{action}</section>;
}

function primitiveRows(value: RecordRow | null | undefined) {
  return Object.entries(value || {}).filter(([, entry]) => entry === null || ["string", "number", "boolean", "undefined"].includes(typeof entry));
}

export function EvidenceRows({ value }: { value?: RecordRow | null }) {
  const rows = primitiveRows(value);
  if (!rows.length) return <p className="kw-muted">No scalar evidence fields are available.</p>;
  return <dl className="kw-evidence-list">{rows.map(([key, entry]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{entry === null || entry === undefined || entry === "" ? "UNKNOWN" : String(entry)}</dd></div>)}</dl>;
}

export function EvidenceCards({ rows }: { rows: RecordRow[] }) {
  if (!rows.length) return <p className="kw-muted">No evidence rows are available.</p>;
  return <div className="kw-card-grid">{rows.map((row, index) => <article className="kw-evidence-card" key={String(row.id || row.name || row.label || index)}><strong>{String(row.name || row.label || row.id || `Evidence ${index + 1}`)}</strong><EvidenceRows value={row} /><details><summary>Advanced · Raw Evidence</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></article>)}</div>;
}

export function TaskTable({ tasks }: { tasks: TaskRow[]; emptyTitle?: string; emptyDetail?: string }) {
  if (!tasks.length) return <EmptyState title="No persisted tasks" detail="Tasks appear only after a real operation creates evidence." />;
  return <div className="kw-table-wrap" aria-label="Persisted task evidence"><table className="kw-table"><thead><tr><th>Task</th><th>Project</th><th>State</th><th>Progress</th><th>Started</th><th>Duration</th><th>Evidence</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><strong>{task.kind}</strong><small>{task.id}</small></td><td>{task.projectId}</td><td><StatusBadge value={task.status} /></td><td>{task.progress ?? 0}%</td><td>{task.startedAt ? new Date(task.startedAt).toLocaleString() : "UNKNOWN"}</td><td>{task.durationMs ? `${task.durationMs} ms` : "UNKNOWN / RUNNING"}</td><td><span>{task.error || task.logs?.at(-1)?.message || task.output?.slice(0, 140) || "No output yet"}</span><details className="kw-task-detail"><summary>Task evidence</summary><pre>{JSON.stringify(task, null, 2)}</pre></details></td></tr>)}</tbody></table></div>;
}

export function EvidenceTable({ columns, rows, empty }: { columns: Array<{ key: string; label: string; render?: (row: RecordRow) => ReactNode }>; rows: RecordRow[]; empty: string }) {
  if (!rows.length) return <p className="kw-muted">{empty}</p>;
  return <div className="kw-table-wrap"><table className="kw-table"><thead><tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || row.sha || row.name || row.label || index)}>{columns.map((col) => <td key={col.key}>{col.render ? col.render(row) : String(row[col.key] ?? "UNKNOWN")}</td>)}</tr>)}</tbody></table></div>;
}

export function AdvancedEvidence({ value, label }: { value: unknown; label?: string }) {
  return <details className="kw-advanced-evidence"><summary>{label || "Advanced · Raw Evidence"}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
