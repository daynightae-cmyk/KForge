# KNOuX Forge — Integration Map

**Baseline:** `d2a8a58fa295c885d5162092c0257922580b5833`  
**Purpose:** map verified external sources onto the CURRENT KForge architecture without rebuilding existing engines.

## Architectural rule

```text
EXTERNAL SOURCE
  → source-specific adapter
  → schema validation
  → normalized evidence
  → bounded cache
  → CURRENT KForge service
  → CURRENT Workbench surface
  → explicit action authority
  → verification evidence
```

No adapter writes directly into UI state as truth. No adapter bypasses the existing Marketplace/Online/AI/Security/Release ownership boundaries.

## Current KForge integration anchors

| Existing anchor | Role |
| --- | --- |
| `server/services/onlineControlCenter.ts` | operating mode, remote-contact status, provider truth |
| `server/services/marketplaceCore.ts` | catalog/lifecycle/provenance/integrity/compatibility authority |
| `server/services/providerAdapters.ts` | AI/provider execution adapters |
| `server/services/aiCenter.ts` | local/cloud model runtime state |
| `server/services/securityTools.ts` | local scanner/security execution truth |
| `shared/workspace.ts` | canonical Online authority/freshness/control contracts |
| `client/workbench/onlineSurface.tsx` | Online browsing/Marketplace experience |
| existing GitHub/Remote workbench | repository, checks, Actions, release evidence |
| existing Release workbench | package/signing/release-source separation |
| Global Search | cross-product local/search entity navigation |

## Source-to-KForge map

| Source | Integration owner | User path | Priority | Implementation note |
| --- | --- | --- | --- | --- |
| Official MCP Registry | server/services/marketplaceCore.ts + new source adapter | Online → Marketplace → Agents/Tools → MCP detail | P0 | Normalize remote MCP server metadata into existing MarketplaceItem/evidence fields. Runtime capability probing remains separate and explicit. |
| Open VSX | Marketplace source adapter + onlineSurface extensions view | Online → Extensions → Marketplace | P0 | Catalog/detail/version/artifact metadata only. Installation requires existing trust/confirmation/integrity lifecycle. |
| OSV | new security-intelligence adapter feeding existing Security Quality evidence | Quality → Security; dependency detail | P0 | Observational vulnerability results. Never auto-upgrade. |
| Hugging Face Hub | extend existing aiCenter/provider/marketplace model catalog path | AI → Model Hub → Marketplace | P0 | CATALOG_ONLY until local runtime/install evidence exists. Preserve model license/gated state/revision. |
| GitHub Releases | extend existing Release/Online update state | System → Updates + Release | P0 | Read-only update discovery first; trusted update install stays blocked until checksum + Authenticode/trust gates pass. |
| Official docs adapters | new remote-documentation adapter behind Online Control Center | Online → Documentation + Global Search | P0 | OpenAPI/official repos/sitemap/official llms.txt only; strict origin allowlist and provenance. |
| GitHub REST caching/webhooks | existing GitHub workspace/remote services | Remote → GitHub/CI/Release | P0 | Do not duplicate GitHub engine; add conditional requests, rate-limit evidence, least privilege. |
| npm/PyPI/NuGet | new package catalog adapters normalized into Marketplace | Online → Packages/Tools → Marketplace | P1 | Metadata/integrity/provenance discovery; install through project-aware explicit workflows only. |
| WinGet | developer-tool catalog + install metadata | Developer Tools → Discover/Install | P1 | Manifest hash is integrity evidence, not publisher identity. Prefer official publisher releases. |
| Vercel / GitHub Deployments | optional remote-preview adapters | Remote → Preview | P1 | Read-only deployment URL/status; no source upload/deploy unless separate explicit mutation mission. |
| Maven/crates/Go/Packagist/RubyGems | package ecosystem expansion | Online → Packages | P2 | Provider-specific access strategy and cache policy. |
| NVD | security enrichment | Quality → Security | P2 | CVE enrichment behind OSV package-native lookup. |
| OpenRouter | model comparison metadata | AI → Models | P2 | Aggregator data is not upstream license/runtime truth. |
| Microsoft Gallery SDK | owner/legal-reviewed optional source | Online → Extensions | P2 | Do not bind raw Marketplace endpoints until supported use and terms are confirmed. |

## Recommended new adapter layout

A likely implementation shape, subject to current-repo conventions:

```text
server/services/remoteSources/
  contracts.ts
  fetchPolicy.ts
  cacheStore.ts
  registry.ts
  adapters/
    mcpRegistry.ts
    openVsx.ts
    osv.ts
    huggingFace.ts
    githubReleases.ts
    documentation.ts
    npm.ts            # P1
    pypi.ts           # P1
    nuget.ts          # P1
    winget.ts         # P1
    vercel.ts         # P1
```

This is **not** a requirement to create this exact folder. If KForge's current service conventions favor extending existing files, preserve the repository's ownership model.

## UI information architecture

### Online → Discover

Federated discovery of normalized items, with source filter and authority badges.

### Online → Extensions

Open VSX P0. Microsoft Marketplace remains unavailable/owner-review until supported usage is confirmed.

### Online → Models

Hugging Face catalog + existing local/provider truth. Clearly separate:
- `CATALOG`
- `LOCAL_INSTALLED`
- `RUNNING`
- provider cloud model availability.

### Online → MCP

Either a dedicated Online child view or a first-class Marketplace taxonomy. It should not be buried as generic “tools” if the user needs MCP server-specific package/transport/env configuration.

### Online → Packages

P1 ecosystem adapters. This is package metadata/dependency discovery, not automatic `npm install`/`pip install`.

### Online → Documentation

Official allowlisted remote docs. Search results show provider, canonical URL, version, freshness and authority.

### Online → Updates

KForge's own update channel first. Installed extension/model/package updates can later join this view only when a verified adapter has both installed version and trustworthy upstream version.

### Online → Security

OSV intelligence + existing Marketplace trust/permission evidence. Remote advisory result remains observational.

## Evidence transformations

### Example: Open VSX extension

```text
Open VSX JSON
  → validate against provider schema
  → normalize publisher/namespace/version/files
  → authority = REMOTE_REGISTRY
  → availability = CATALOG
  → runtimeEvidence = NOT_AVAILABLE
  → install eligibility:
      only if immutable VSIX + expected integrity + compatibility + policy are all present
  → user confirmation
  → staging
  → integrity/signature verification
  → existing Marketplace install lifecycle
  → local registration
  → post-install health
```

### Example: Hugging Face model

```text
Hub model record
  → normalize model ID/revision/license/tags/files/gated
  → authority = REMOTE_REGISTRY
  → availability = CATALOG
  → runtimeEvidence != VERIFIED

If the same model is detected in Ollama/LM Studio/local runtime:
  separate LOCAL_INSTALLED evidence is attached.
```

### Example: OSV advisory

```text
project dependency + exact version
  → OSV querybatch
  → advisory IDs
  → hydrate/normalize ranges/fixes/severity/references
  → Security Quality finding
  → fix proposal MAY be generated
  → package manifest mutation remains a separate confirmed workflow
```

### Example: KForge update

```text
GitHub Release
  → channel/version/tag metadata
  → resolve tag/commit
  → identify expected NSIS artifact
  → locate checksum/signature/SBOM sidecars
  → compare current version
  → UPDATE_AVAILABLE (catalog fact)

download:
  separate confirmation

trusted install:
  only after checksum + existing signing/trust policy pass
```

## Storage ownership

Do not centralize all state into one new database.

```text
Online source configuration       → existing platform/settings ownership
Remote contact evidence           → Online Control Center ownership
Marketplace normalized cache      → Marketplace/remote-source cache
Model runtime state               → AI Center
Installed extension/package state → Marketplace lifecycle
Security findings                 → Security/Quality evidence
Update/release truth              → Release/System update evidence
```

If a future embedded DB is introduced, it should be a backend implementation of a cache/catalog store abstraction, not a new authority domain.

## Acceptance gates for each adapter

1. Opening its surface in Offline mode produces **zero** external requests.
2. Explicit search/refresh contacts only allowlisted provider origins.
3. Provider identity/destination is visible in network evidence.
4. malformed response → ERROR/UNAVAILABLE, never success.
5. 429 → bounded retry/backoff or explicit rate-limited state.
6. stale cache remains distinguishable from live data.
7. result source is visible.
8. remote catalog result does not become `INSTALLED`.
9. no renderer API key exposure.
10. install/download requires explicit confirmation.
11. integrity is checked before activation when available/required.
12. all existing tests/builds/Windows release gates remain green on exact head SHA.

## P0 execution order

1. Canonical RemoteSource/Fetch/Cache contracts mapped onto existing OnlineAuthorityEvidence and Marketplace evidence.
2. Official MCP Registry adapter: search/detail/versions only; no auto-run.
3. Open VSX adapter: search/detail/version/artifact/integrity metadata; existing lifecycle handles install authority.
4. OSV adapter: batch package/version vulnerability intelligence into existing Security Quality.
5. Hugging Face Hub model catalog adapter: public metadata/revision/files/license/gating; never mark catalog item installed.
6. GitHub Releases KForge update discovery: stable/prerelease channels, tag/commit/asset/checksum/signing evidence separation.
7. Remote Documentation framework: official OpenAPI → official docs repo/sitemap → same-domain official llms.txt; global search integration.
8. Harden existing GitHub read adapters with current API version, conditional requests, least privilege and rate-limit evidence.
