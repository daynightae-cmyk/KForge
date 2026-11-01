# Registered surface audit boundary

Source: `client/workbench/navigation.ts`. 9 activities, 68 registered views. This is a source inventory, not proof that every action or native path was exercised. The existing `surface-settle-audit.spec.ts` walks all registered views; its fresh execution result must be read from gate evidence.

| Activity | View | Canonical surface | Fresh interaction status |
|---|---|---|---|
| Projects | `workspace` (Workspace) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `health` (Project Health) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `recent` (Recent) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `favorites` (Favorites) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `pinned` (Pinned) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `archive` (Archive) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `open-project` (Open Project) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Projects | `import-project` (Import Project) | `client/workbench/projectsSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| AI | `providers` (Providers) | `client/workbench/aiSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| AI | `models` (Models) | `client/workbench/aiSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| AI | `agents` (Agents) | `client/workbench/aiSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| AI | `tasks` (Tasks) | `client/workbench/aiSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `discover` (Discover) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `marketplace` (Marketplace) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `extensions` (Extensions) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `models` (Models) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `agents` (Agents) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `tools` (Tools) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `integrations` (Integrations) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `installed` (Installed) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `updates` (Updates) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `downloads` (Downloads) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `providers` (Providers) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `remote-sources` (Remote Sources) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `documentation` (Documentation) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `security` (Security) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Online | `activity` (Activity) | `client/workbench/onlineSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Intelligence | `project-graph` (Project Graph) | `client/workbench/intelligenceSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Intelligence | `dependencies` (Dependencies) | `client/workbench/intelligenceSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Intelligence | `impact-analysis` (Impact Analysis) | `client/workbench/intelligenceSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Intelligence | `code-understanding` (Code Understanding) | `client/workbench/intelligenceSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Intelligence | `ask-kforge` (Ask KForge) | `client/workbench/intelligenceSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Intelligence | `architecture` (Architecture) | `client/workbench/intelligenceSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `sonar` (KForge Sonar) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `problems` (Problems) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `solutions` (Solutions) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `security` (Security) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `performance` (Performance) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `technical-debt` (Technical Debt) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `documentation` (Documentation) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Quality | `snapshots` (Snapshots) | `client/workbench/qualitySurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `terminal` (Terminal) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `tests` (Tests) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `build` (Build) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `runtime` (Runtime) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `lint` (Lint) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `logs` (Logs) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `diagnostics` (Diagnostics) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Developer Tools | `preview` (Preview) | `client/workbench/developerSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `git` (Git) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `branches` (Branches) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `commits` (Commits) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `github` (GitHub) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `pull-requests` (Pull Requests) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `issues` (Issues) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `actions` (Actions) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Remote / Git | `releases` (Releases) | `client/workbench/remoteSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Release | `release-gate` (Release Gate) | `client/workbench/releaseSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Release | `release-preparation` (Release Preparation) | `client/workbench/releaseSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Release | `artifacts` (Artifacts) | `client/workbench/releaseSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| Release | `versioning` (Versioning) | `client/workbench/releaseSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `settings` (Settings) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `trust` (Trust) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `permissions` (Permissions) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `storage` (Storage) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `online-offline` (Online / Offline) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `self-audit` (Self Audit) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |
| System | `system-diagnostics` (System Diagnostics) | `client/workbench/systemSurface.tsx` | See gate; action-specific proof not inferred from route settling |

## Existing E2E specifications (discovered, not individually certified)

- `tests/e2e/accessibility-keyboard-evidence.spec.ts`
- `tests/e2e/activity-code-splitting.spec.ts`
- `tests/e2e/agent-mission-evidence.spec.ts`
- `tests/e2e/ai-provider-evidence.spec.ts`
- `tests/e2e/brand-theme-accuracy.spec.ts`
- `tests/e2e/coherent-service-navigation.spec.ts`
- `tests/e2e/developer-build-workbench.spec.ts`
- `tests/e2e/developer-git-surface-evidence.spec.ts`
- `tests/e2e/developer-lint-workbench.spec.ts`
- `tests/e2e/developer-runtime-workbench.spec.ts`
- `tests/e2e/developer-tests-workbench.spec.ts`
- `tests/e2e/execution-evidence-ledger.spec.ts`
- `tests/e2e/git-local-operations.spec.ts`
- `tests/e2e/github-remote-workbench.spec.ts`
- `tests/e2e/global-search-evidence.spec.ts`
- `tests/e2e/inspector-css-code-splitting.spec.ts`
- `tests/e2e/installation-audio-evidence.spec.ts`
- `tests/e2e/installation-logo-evidence.spec.ts`
- `tests/e2e/installation-splash-journey.spec.ts`
- `tests/e2e/kforge.spec.ts`
- `tests/e2e/marketplace-local-lifecycle.spec.ts`
- `tests/e2e/online-control-center-evidence.spec.ts`
- `tests/e2e/online-filtered-selection.spec.ts`
- `tests/e2e/persistent-preview-dock.spec.ts`
- `tests/e2e/preview-studio-modern-evidence.spec.ts`
- `tests/e2e/preview-workbench-evidence.spec.ts`
- `tests/e2e/product-surface-evidence.spec.ts`
- `tests/e2e/project-center-real-evidence.spec.ts`
- `tests/e2e/project-collections-workbench.spec.ts`
- `tests/e2e/project-health-workbench.spec.ts`
- `tests/e2e/project-intelligence-evidence.spec.ts`
- `tests/e2e/provider-command-center.spec.ts`
- `tests/e2e/quality-performance-workbench.spec.ts`
- `tests/e2e/quality-scan-solution-evidence.spec.ts`
- `tests/e2e/quality-security-workbench.spec.ts`
- `tests/e2e/quality-snapshot-evidence.spec.ts`
- `tests/e2e/quality-technical-debt-workbench.spec.ts`
- `tests/e2e/reachable-navigation-audit.spec.ts`
- `tests/e2e/release-distribution-accessibility.spec.ts`
- `tests/e2e/release-evidence.spec.ts`
- `tests/e2e/remote-source-truth-contracts.spec.ts`
- `tests/e2e/route-code-splitting.spec.ts`
- `tests/e2e/self-audit-run-evidence.spec.ts`
- `tests/e2e/settings-platform-evidence.spec.ts`
- `tests/e2e/surface-settle-audit.spec.ts`
- `tests/e2e/system-control-plane.spec.ts`
- `tests/e2e/system-diagnostics-evidence.spec.ts`
- `tests/e2e/system-permissions-center.spec.ts`
- `tests/e2e/system-storage-center.spec.ts`
- `tests/e2e/system-trust-center.spec.ts`
- `tests/e2e/topology-lab.spec.ts`
- `tests/e2e/trust-revocation-enforcement.spec.ts`
- `tests/e2e/workspace-acceptance.spec.ts`
- `tests/e2e/workspace-table-evidence.spec.ts`
