# KNOuX Forge × OpenSumi Phase 2 Acceptance

Baseline KForge:
66a04300a061ee3209c3b50b5001319003d94166

Spike branch:
spike/opensumi-kforge-workbench

## PASS requires

- npm dependency resolution succeeds using npm, not Yarn.
- OpenSumi 3.9.0 packages resolve.
- Electron stays on 44.3.0 for this compatibility probe.
- TypeScript stays on 5.9.3 for this compatibility probe.
- 
pm run build exits 0.
- KForge original services are not rewritten.
- Changes remain isolated under labs/opensumi-workbench/.

## NOT YET CLAIMED

- Runtime launch
- terminal native rebuild
- KForge API wiring
- project discovery wiring
- Preview wiring
- AI Inspector wiring
- production packaging
- migration approval

