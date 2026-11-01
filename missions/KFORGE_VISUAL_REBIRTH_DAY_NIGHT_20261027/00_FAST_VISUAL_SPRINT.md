# Design-first implementation and quick checkpoints

Objective: MAXIMUM ACTUAL INTERNAL KFORGE UI delivered, not prolonged test-and-audit loops. First: verify Git and save/avoid dirty work. Do not manipulate other agents' worktrees. Use one isolated visual integration branch; do not merge into main automatically.

For each actual screen: inspect relevant code → implement DAY and NIGHT UI → make two quick real screenshots if possible → quick compile/lint smoke → commit/push working screen to one visual branch → continue automatically. No owner approval wait between normal safe UI-only edits. Full suite/packaged tests deferred to later QA; record NOT RUN honestly. Do not continue if basic compile is broken; fix or document and isolate.

NO static image-as-app, no invented project counts/runs/provider connections/scores, no fake loading or tool actions. Preserve existing security, offline/online gating, project isolation, tab semantics, keyboard/focus, reduced motion, IPC and real backend hooks. **Do not rewrite completed intro.**

For missing reference images, mark IMAGE_PENDING; do not stop all real UI work solely because images are unavailable. Continue using task design contracts and screenshot descriptions; produce distinct references when an actual image generator is accessible.
