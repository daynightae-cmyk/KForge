# Recovered research and isolated source (historical)

Recovered on 2026-11-02 from the local 2026-10-17 recovery directory. These are historical research inputs, not current implementation or evidence of production readiness.

- `source-research/`: the four previously untracked research/source manifest files, preserved byte-for-byte. Original research hashes are historical; `RECOVERY-MANIFEST.json` records the bytes actually recovered.
- `opensumi-spike-source/`: **removed from the working tree on 2026-11-18.** The isolated OpenSumi experiment source, scripts, configuration, license and lockfile were never part of the KForge product graph, runtime, dependencies, build or packaging. Its historical lockfile was also the source of every critical Dependabot finding on this repository, so it no longer participates in dependency scanning. The files remain recoverable from the Git history at commit `021eb05`; no migration to OpenSumi is authorized by preservation.
- Generated OpenSumi `app/` bundles are excluded and were never imported.
- Existing local auth/configuration and screenshots remain outside Git; no credentials were imported.

Do not install dependencies or run these historical scripts as part of KForge verification. The canonical React/Electron workbench remains authoritative.
