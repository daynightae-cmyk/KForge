# KForge Mock and Placeholder Audit

**Baseline reviewed:** `0447a457226dda2bee7bf0ea0ef90264d676051e`  
**Scope:** `client/`, `server/`, and `shared/`, excluding generated output, dependencies, and the user-owned `.ctrlnode/` directory.

The audit used static matching for `console.log`, `alert`, `TODO`, `FIXME`, `mock`, `placeholder`, `fake`, `Not implemented`, and known placeholder paths. Static matches are not automatically defects; each result was classified according to its runtime role.

| Area | Classification | Evidence and disposition |
|---|---|---|
| `server/routes/workspace.ts` | **REAL** | Project discovery, Git inspection, package-script invocation, npm audit, local opening, repository cloning, scan results, and task output use real filesystem and command results. Empty-array returns only represent unavailable files or no findings. |
| `client/pages/KForgeWorkspace.tsx` | **REAL** | UI state is wired to the Workspace API. Search-field placeholder attributes and the empty-state text are normal UX copy, not fabricated data. |
| `server/node-build.ts` | **REAL** | The startup log is operational output. |
| `client/lib/engineInterfaces.ts` | **MOCK / PARTIAL** | The active `MockVideoEngine`, simulated IDs/paths, and several incomplete AI methods are not valid production engines. They are outside the engineering Workspace data path and are recorded for legacy editor remediation. |
| `client/pages/KnouxVideoEditor.tsx` | **MOCK / PLACEHOLDER** | The selected demo clip and save/open/export/undo/redo console handlers are not connected to a persistent project engine. The TypeScript contract is repaired in this phase; functional editor completion requires an independent media-engine scope. |
| `client/components/knoux/KnouxClipAIControls.tsx` | **MOCK / PARTIAL** | It contains hard-coded effect definitions, simulated responses, and alert/console actions. It is legacy video-editor functionality, not part of the KForge Workspace engine. |
| `client/components/knoux/KnouxSidebar.tsx` | **MOCK / PLACEHOLDER** | Demo media, templates, and AI-tool buttons remain unconnected to the workspace. |
| `client/components/knoux/KnouxTimeline.tsx` | **MOCK / PARTIAL** | Fallback timeline tracks and UI-only control state are legacy editor scaffolding. |
| `client/components/knoux/KnouxInspectorPanel.tsx` | **PARTIAL / PLACEHOLDER** | Some panel actions only log changes and the color panel is explicitly unavailable. |
| `client/pages/Index.tsx` | **DEAD** | The former product landing page is no longer routed after KForge Workspace became the application entry point. It remains untouched to avoid destructive scope expansion. |

## Prioritization

The KForge Workspace has no active fake project, Git, scan, test, build, or task data path. The next implementation work therefore targets its evidence model: richer project discovery, normalized diagnostics, health evidence, problems, snapshots, and permission-gated operations.

The listed Knoux editor items remain an **exact legacy remediation backlog**, not a claim of functional completeness. They must not be represented as KForge Workspace capabilities until wired to persistent engines.
