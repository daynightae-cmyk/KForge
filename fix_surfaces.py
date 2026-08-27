with open("C:/Users/day night/.traycer/worktrees/daynightae-cmyk__kforge/recovery-world-class-hardening/client/workbench/surfaces.tsx", "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('import type { SurfaceProps, ExecutionSnapshot, InspectorContext as InspectorContract, RecordRow, TaskRow } from "./surfaceContracts";', 'import type { SurfaceProps, ExecutionSnapshot, InspectorContext, RecordRow, TaskRow } from "./surfaceContracts";')
content = content.replace('export { InspectorContext, CanonicalInspector, WorkbenchSurface };', 'export { CanonicalInspector, WorkbenchSurface };\nexport type { InspectorContext } from "./surfaceContracts";')
content = content.replace('import type { KForgeActivity, WorkspaceResponse, ProjectSummary, KForgePlatformSettings, WorkspaceActionDescriptor, WorkspaceResponse } from "@shared/workspace";', 'import type { KForgeActivity, WorkspaceResponse, ProjectSummary, KForgePlatformSettings, WorkspaceActionDescriptor } from "@shared/workspace";')
with open("C:/Users/day night/.traycer/worktrees/daynightae-cmyk__kforge/recovery-world-class-hardening/client/workbench/surfaces.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("Fixed surfaces.tsx conflicts")
