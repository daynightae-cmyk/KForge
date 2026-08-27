export { EvidenceRows, EvidenceCards, StatusBadge, EmptyState, EvidenceTable, AdvancedEvidence } from "./surfaces";
import type { ReactNode } from "react";
export type RecordRow = Record<string, unknown>;
export function EvidenceRows({ value }: { value?: RecordRow | null }) { return null; }
export function EvidenceCards({ rows }: { rows: RecordRow[] }) { return null; }
export function StatusBadge({ value }: { value?: unknown }) { return null; }
export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) { return null; }
export function EvidenceTable({ columns, rows, empty }: { columns: Array<{ key: string; label: string; render?: (row: RecordRow) => ReactNode }>; rows: RecordRow[]; empty: string }) { return null; }
export function AdvancedEvidence({ value, label }: { value: unknown; label?: string }) { return null; }
