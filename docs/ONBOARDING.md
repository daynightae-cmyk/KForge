# KNOuX Forge Onboarding

Get Started is the canonical onboarding destination: **Projects → Get Started**
(`projects:getting-started`). It is available from the Explorer, from the
projectless fallback (`Setup guide`), and from the Project Center link on the
Projects workspace.

## The rule

Onboarding never advances because a user opened it. A step is complete only when
evidence KForge already owns proves it. The derivation lives in
`client/workbench/gettingStartedModel.ts`; the surface is a reader of that
function, not a second source of truth.

```text
workspace evidence ─┐
project trust ──────┤
operating policy ───┼─→ buildSetupPath() ─→ step status + evidence text
provider inventory ─┤
persisted scan ─────┘
```

## Steps

### Core track

| Step | Evidence read | Complete when | Destination |
| --- | --- | --- | --- |
| Local workspace ready | `GET /api/workspace/projects` root | A workspace root is reported | Projects → Workspace |
| Register a project | Workspace project list | At least one active (non-archived) registration exists | Projects → Workspace / Open Project |
| Review project trust | Active project `trust` | The active project is `trusted` | System → Trust |
| Confirm the operating policy | `localPlatform.mode` and `policy` | A mode is reported, with the policy consequence shown | System → Online / Offline |

### Recommended track

| Step | Evidence read | Status | Destination |
| --- | --- | --- | --- |
| Configure an AI provider | `GET /api/workspace/ai/command-center/providers` | Complete when at least one adapter reports a configured credential; not evaluated when the inventory cannot be read | AI → Providers |
| Set theme and motion | Persisted platform settings | Complete when settings evidence is loaded | System → Settings |
| Run the first project scan | `GET /api/workspace/projects/health-evidence` for the active project path | Complete when persisted health evidence exists | Quality → KForge Sonar |

A provider credential alone is not a connection proof. The provider surface still
requires an explicit connection test before an AI mission may run.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `COMPLETE` | The named evidence exists and proves the step |
| `ACTION_REQUIRED` | Evidence loaded, but the step is not satisfied yet |
| `BLOCKED` | A prerequisite is missing, such as no active project |
| `NOT_EVALUATED` | The evidence source could not be read; no conclusion is drawn |

`NOT_EVALUATED` is never rendered as success. Opening the guide, refreshing it or
navigating between steps changes no status by itself.

## Empty and partial states

- With no active project, the guide shows the real `ProjectStartActions` panel
  (open a local directory or clone with confirmation) and marks project-dependent
  steps `BLOCKED`.
- When the provider or health endpoint cannot be read, the affected steps become
  `NOT_EVALUATED` and the surface reports that some evidence was unavailable.
- The progress meter only counts core steps backed by evidence. The recommended
  track never changes core readiness.

## Verification

```bash
npx vitest --run client/workbench/gettingStartedModel.spec.ts
npx playwright test tests/e2e/brand-onboarding-capabilities.spec.ts
```

The unit spec locks the evidence rules; the Playwright spec proves the surface
renders, settles, exposes real actions and keeps its truth statement. Neither
test claims that provider connectivity or a project scan happened on the
machine that ran them.
