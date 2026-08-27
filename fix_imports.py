import glob, os

base = "C:/Users/day night/.traycer/worktrees/daynightae-cmyk__kforge/recovery-world-class-hardening/client/workbench/"

header = '''import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SurfaceProps, RecordRow, TaskRow, ExecutionSnapshot, MarketplaceData, MarketplaceItem } from "./surfaceContracts";
import { fetchJson, fetchEvidence, jsonRequest, waitForTask } from "./api";
import { EmptyState, StatusBadge, EvidenceRows, EvidenceCards, TaskTable, EvidenceTable } from "./ui";
import { viewLabel } from "./navigation";

'''

for path in glob.glob(os.path.join(base, "*Surface.tsx")):
    fname = os.path.basename(path)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    # Only add imports if not already present at top
    if not content.startswith("import { useState"):
        with open(path, "w", encoding="utf-8") as f:
            f.write(header + content)
        print(f"Fixed imports: {fname}")
    else:
        print(f"Already has imports: {fname}")
