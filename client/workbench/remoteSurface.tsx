import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SurfaceProps, RecordRow, TaskRow, ExecutionSnapshot, MarketplaceData, MarketplaceItem } from "./surfaceContracts";
import { fetchJson, fetchEvidence, jsonRequest, waitForTask } from "./api";
import { EmptyState, StatusBadge, EvidenceRows, EvidenceCards, TaskTable, EvidenceTable } from "./ui";
import { viewLabel } from "./navigation";

function RemoteSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Git and GitHub evidence requires project context." />;
  return <SimpleFetchSurface url={["git", "branches", "commits"].includes(view) ? `/api/workspace/projects/${encodeURIComponent(project.id)}/git` : `/api/workspace/projects/${encodeURIComponent(project.id)}/github`} title={viewLabel("remote", view)} onError={(text) => onExecution({ label: viewLabel("remote", view), state: "UNAVAILABLE", source: "GitHub read-only adapter", message: text })} />;
}
