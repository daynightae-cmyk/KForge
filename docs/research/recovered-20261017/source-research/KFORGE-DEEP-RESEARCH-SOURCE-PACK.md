# KNOuX Forge — Deep Research Source Pack

**Generated:** 2026-09-24T01:19:00+04:00  
**Repository:** `daynightae-cmyk/KForge`  
**Canonical branch:** `main`  
**Research baseline SHA:** `d2a8a58fa295c885d5162092c0257922580b5833`  
**Mission:** source acquisition and integration intelligence only. No repository implementation was performed.

> This document is intentionally evidence-oriented. A source being listed does **not** mean it is trusted to install or execute content. Discovery, integrity, publisher identity, provenance, installation and runtime verification are separate states.

## 1. Executive verdict

KForge does **not** need a cloud database to close its current production gaps. The reviewed repository baseline already has the correct local-first primitives: operating modes, remote-contact evidence, `OnlineAuthorityEvidence`, Marketplace provenance/integrity fields, local lifecycle confirmation, and bounded `.kforge` persistence. The missing layer is primarily a **Remote Source Adapter + Normalization + Cache + Trust** layer.

### P0 sources

- 1. Canonical RemoteSource/Fetch/Cache contracts mapped onto existing OnlineAuthorityEvidence and Marketplace evidence.
- 2. Official MCP Registry adapter: search/detail/versions only; no auto-run.
- 3. Open VSX adapter: search/detail/version/artifact/integrity metadata; existing lifecycle handles install authority.
- 4. OSV adapter: batch package/version vulnerability intelligence into existing Security Quality.
- 5. Hugging Face Hub model catalog adapter: public metadata/revision/files/license/gating; never mark catalog item installed.
- 6. GitHub Releases KForge update discovery: stable/prerelease channels, tag/commit/asset/checksum/signing evidence separation.
- 7. Remote Documentation framework: official OpenAPI → official docs repo/sitemap → same-domain official llms.txt; global search integration.
- 8. Harden existing GitHub read adapters with current API version, conditional requests, least privilege and rate-limit evidence.

### What must remain unchanged

- Opening Online surfaces must not cause uncontrolled network contact.
- Project source must not be sent merely to search a catalog.
- `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, `BLOCKED` and `ERROR` remain real states.
- Remote catalog metadata never becomes local install/runtime truth.
- Existing Marketplace, AI Center, GitHub, Security, Release and Global Search engines remain canonical.
- Supabase/cloud persistence remains optional sync, not a startup/runtime dependency.

## 2. Research audit

- Exa: **207 search-result slots** were reviewed/requested across source-specific workstreams. This is not 207 unique pages; overlapping results were intentionally used to cross-check official sources.
- Google Drive: searches for `KForge` and `KNOuX Forge` returned no matching files, so no private Drive document was treated as authority.
- Hugging Face plugin: the connector was installed/enabled, but its MCP actions returned `tool not found` in this session. Hugging Face facts below were therefore independently verified from the official Hugging Face Hub OpenAPI and documentation using Exa.
- Scite: three research papers were retained for software-supply-chain architectural validation; no editorial notice/retraction was shown for the retained records.
- Repository grounding: the exact supplied SHA was read through the GitHub connector in read-only mode. No branch, file, commit or PR was created.

## 3. Repository truth at the supplied SHA

The exact baseline already proves several important architecture decisions:

- `docs/KFORGE-CAPABILITY-MATRIX.md`: local operating modes and network-transparency boundaries are implemented; Marketplace local lifecycle is complete while remote catalogs are provider-dependent; remote extension lifecycle is blocked without a trustworthy package adapter; remote model/update registries and remote documentation remain external/provider gaps.
- `server/services/onlineControlCenter.ts`: remote contact is cached and redacted; the control center does not contact providers merely by opening. `remote-documentation` and `updates` are explicitly `NOT_CONFIGURED`; `remote-preview` is `UNAVAILABLE`; Marketplace/model registries are provider-gated.
- `server/services/marketplaceCore.ts`: KForge already models publisher, repository, release history, changelog, dependencies, provenance, integrity, lifecycle, compatibility, authority and freshness. Extend this model rather than replacing it.
- `shared/workspace.ts`: Online authority already distinguishes `REMOTE_REGISTRY`, `CACHED_REMOTE`, `CATALOG_ONLY`, `LOCAL_INSTALLED`, etc.; remote writes require confirmation; opening remote surfaces does not contact the network.
- `client/workbench/onlineSurface.tsx`: the current Online experience already has Extensions, Models, Agents, Tools, Integrations, Updates, Providers, Remote Sources, Security, Downloads and Activity views.

## 4. Source Matrix

| Source | Category | Official? | Base URL | Documentation | OpenAPI / schema | Authentication | Rate limits | Caching | License / terms | KForge target | Priority | Risk | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Official MCP Registry | MCP Registry | YES | https://registry.modelcontextprotocol.io | https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md | https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml | Read discovery is suitable for unauthenticated public consumption; publishing uses namespace authentication (GitHub OAuth/OIDC or DNS/HTTP verification). | No numeric public read limit verified in reviewed official reference; adapter must observe 429/Retry-After and provider headers. | No universal cache contract verified; use conditional/provider headers when present and a bounded KForge cache. | OpenAPI declares MIT. Registry service usage still follows project/service policies. | Online Hub, Marketplace, Agents, Tools, MCP Server detail | P0 | MEDIUM | APPROVED_READ_DISCOVERY |
| Open VSX Registry | IDE Extensions | YES | https://open-vsx.org | https://open-vsx.org/swagger-ui/index.html | https://open-vsx.org/v3/api-docs/registry | Public metadata reads do not require publisher authentication; publishing requires authentication. | OpenAPI declares X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset and Retry-After/429. Do not hardcode a numeric quota unless returned/published. | Official server implementation uses cache-control on metadata paths; preserve Cache-Control/ETag if returned. Do not assume one TTL for every endpoint. | OpenAPI termsOfService: https://www.eclipse.org/legal/termsofuse.php ; API project license Eclipse Public License 2.0. | Online Hub, Extensions, Marketplace | P0 | MEDIUM | APPROVED_READ_DISCOVERY |
| npm Public Registry | Package Registry | YES | https://registry.npmjs.org | https://api-docs.npmjs.com/ | Official downloadable OpenAPI from api-docs.npmjs.com | Public package metadata/search is generally readable without auth; authenticated management uses scoped/bearer/OIDC tokens. | No single numeric registry-read quota was established in reviewed official API docs. Website crawling policy is distinct; do not crawl npmjs.com. Respect provider headers/backoff. | Registry metadata supports normal HTTP caching; do not mirror the full registry for KForge. Query on demand. | npm Open Source Terms govern website/public registry. Public registry metadata/full dataset access is documented; website high-velocity crawling is discouraged/limited. | Packages, Marketplace, Security, Project dependency intelligence | P1 | MEDIUM | APPROVED_METADATA_ONLY |
| Python Package Index (PyPI) | Package Registry | YES | https://pypi.org | https://docs.pypi.org/api/ | https://docs.pypi.org/api/index-api/; https://docs.pypi.org/api/integrity/ | Public read APIs are anonymous; upload/management requires auth. | PyPI states no current edge rate limiting for JSON/RSS/Index APIs, but irresponsible use can be blocked. XML-RPC may be rate limited and is not recommended for new integrations. | JSON/RSS/Index responses are CDN cached and expose X-Cache/X-Cache-Hits and ETag. KForge should use If-None-Match. | PyPI Terms of Service and API Terms apply: https://policies.python.org/pypi.org/Terms-of-Service/ | Packages, Marketplace, Security | P1 | LOW | APPROVED_METADATA_ONLY |
| NuGet V3 / nuget.org | Package Registry | YES | https://api.nuget.org/v3/index.json | https://learn.microsoft.com/en-us/nuget/api/overview | https://learn.microsoft.com/en-us/nuget/api/service-index | Public nuget.org read endpoints are public; private sources can require provider-specific auth. | No numeric nuget.org public read quota verified in reviewed docs; respect HTTP/provider headers and bounded concurrency. | Use GET/HEAD and provider cache headers. Resource URLs must be discovered from service index rather than hardcoded. | NuGet/Microsoft service terms apply; individual package licenses vary. | Packages, Marketplace, Security | P1 | LOW | APPROVED_METADATA_ONLY |
| Maven Central Search / Central Repository | Package Registry | YES | https://search.maven.org | https://central.sonatype.org/search/rest-api-guide/ | None verified | Public search/artifact reads. | No numeric quota verified in reviewed docs; use bounded serial requests and provider backoff. | Artifact repositories are CDN/cache friendly; preserve provider HTTP cache headers. | Sonatype/Central terms and each artifact's license apply. Redistribution beyond normal dependency retrieval requires package-specific review. | Packages, Marketplace | P2 | MEDIUM | APPROVED_METADATA_ONLY |
| crates.io | Package Registry | YES | https://crates.io | https://crates.io/data-access | https://crates.io/api/openapi.json | Public reads; management/publish requires auth. | Official policy: API maximum 1 request/second plus identifying User-Agent. Sparse index and static.crates.io currently state no rate limits. | Prefer sparse index/static artifacts; daily DB dumps exist for bulk use. Do not hammer JSON API. | crates.io data-access/terms apply; each crate license varies. | Packages, Marketplace | P2 | LOW | APPROVED_METADATA_ONLY |
| Go Module Proxy + Index + SumDB | Package Registry | YES | https://proxy.golang.org | https://go.dev/ref/mod | None verified | Public modules only. Private-module behavior must honor GOPRIVATE/GONOPROXY/GONOSUMDB and must not leak private module paths. | No numeric proxy quota verified. Separate pkg.go.dev JSON API is documented at 45 QPS per IP block. | proxy.golang.org is a module mirror; cached-only mode exists for bulk/static analysis. SumDB provides auditable checksums. | Go service privacy/terms apply; individual module licenses vary. | Packages, Documentation, Marketplace | P2 | MEDIUM | APPROVED_METADATA_ONLY |
| pkg.go.dev JSON API | Documentation / Package Metadata | YES | https://pkg.go.dev/v1beta | https://pkg.go.dev/v1beta/api | Machine-readable OpenAPI linked from official API docs | Public read API. | 45 QPS per IP block; exceeding returns 429. | Respect HTTP headers; use bounded KForge cache. | Documentation/API service terms and module-specific licenses apply. | Remote Documentation, Packages | P2 | LOW | APPROVED_READ_DISCOVERY |
| Packagist.org | Package Registry | YES | https://packagist.org | https://packagist.org/apidoc | None verified | Many read endpoints anonymous; SAFE/MAIN tokens exist for operations that require authentication. | No single numeric read quota in reviewed doc; official best practice: identify User-Agent, avoid synchronized bursts, <=10 parallel requests (<=20 for static files). | Use HTTP/2, provider cache headers, bounded cache. | Packagist service terms plus individual package licenses; redistribution needs package-specific review. | Packages, Security, Marketplace | P2 | MEDIUM | APPROVED_METADATA_ONLY |
| RubyGems.org | Package Registry | YES | https://rubygems.org | https://guides.rubygems.org/rubygems-org-api/ | https://guides.rubygems.org/rubygems-org-compact-index-api/ | Public read APIs; write/owner operations use API auth. | General API/website guideline: 10 requests/sec; Dependency API: 15 requests/sec. | Compact Index is stable public API with ETag/If-None-Match, Range and Repr-Digest SHA-256. | RubyGems.org Terms: https://index.rubygems.org/policies/terms-of-service ; individual gem licenses vary. | Packages, Marketplace | P2 | LOW | APPROVED_METADATA_ONLY |
| Hugging Face Hub API | Model Registry | YES | https://huggingface.co | https://huggingface.co/.well-known/openapi.md | https://huggingface.co/.well-known/openapi.json | Open endpoints exist for public Hub information; bearer auth is needed for private/gated/user-specific actions and must remain server-side. | No numeric public Hub quota verified in reviewed OpenAPI; obey 429/Retry-After and returned headers. | Respect ETag/Cache-Control where returned and retain revision/SHA as provenance. | Hugging Face Terms of Service apply; every model/repository can carry its own license/gating terms and must be evaluated individually. | AI, Model Hub, Marketplace | P0 | MEDIUM | APPROVED_READ_DISCOVERY |
| Ollama Local API | Local Model Runtime | YES | http://localhost:11434 | https://github.com/ollama/ollama/blob/main/docs/openapi.yaml | https://github.com/ollama/ollama/blob/main/docs/openapi.yaml | Local API OpenAPI currently declares no required auth for loopback use; KForge must keep loopback/origin restrictions. | Local runtime; no provider network rate limit. | Short local inventory cache only; installed/running state must be refreshed from runtime when explicitly requested. | Ollama API OpenAPI declares MIT; installed model licenses are model-specific. | AI, Models, Marketplace local runtime truth | P0 | LOW | APPROVED_LOCAL |
| OpenAI Models API | Cloud Model Registry | YES | https://api.openai.com/v1 | https://developers.openai.com/api/reference/resources/models/methods/list/ | https://developers.openai.com/api/reference/llms-full.txt | Bearer OPENAI_API_KEY; secret must remain server-side. | Account/model-specific; inspect standard OpenAI rate-limit headers/docs rather than hardcoding one global quota. | Short-lived provider catalog cache; do not cache credentials. | OpenAI service terms apply. | AI Provider Studio, Models | P1 | MEDIUM | APPROVED_PROVIDER_METADATA |
| Anthropic Models API | Cloud Model Registry | YES | https://api.anthropic.com | https://platform.claude.com/docs/en/api/models/list | None verified | Anthropic API authentication/version headers; credentials remain server-side. | Plan/account dependent; honor provider headers/current docs. | Short provider catalog cache. | Anthropic commercial/service terms apply. | AI Provider Studio, Models | P1 | MEDIUM | APPROVED_PROVIDER_METADATA |
| Gemini Models API | Cloud Model Registry | YES | https://generativelanguage.googleapis.com | https://ai.google.dev/api/models | None verified | Gemini API key; keep server-side. OAuth may apply to other Google surfaces, but do not conflate them. | Quota/project/model dependent; read current quota headers/docs. | Short provider catalog cache. | Google Gemini API terms apply. | AI Provider Studio, Models | P1 | MEDIUM | APPROVED_PROVIDER_METADATA |
| OpenRouter Models API | Cloud Model Aggregator | YES | https://openrouter.ai/api/v1 | https://openrouter.ai/docs/guides/overview/models | None verified | Public model browsing is documented; user-specific/provider-preference surfaces can require auth. | Plan/provider dependent; honor current headers/docs. | Short catalog cache; pricing/availability is time-sensitive. | OpenRouter service terms plus upstream model/provider terms. | AI, Model comparison | P2 | MEDIUM | OPTIONAL_PROVIDER |
| LM Studio Local API | Local Model Runtime | YES | http://localhost:1234/v1 | https://lmstudio.ai/docs/developer/openai-compat | None verified | Local server configuration dependent; KForge must remain loopback-first and never expose it beyond intended origin. | Local runtime. | Short local runtime cache. | LM Studio product/service terms; model licenses remain model-specific. | AI, Models local runtime | P1 | LOW | APPROVED_LOCAL |
| llama.cpp Server | Local Model Runtime | YES | loopback user-configured | https://github.com/ggml-org/llama.cpp | None verified | Local server configuration dependent. | Local runtime. | Short local cache. | See official llama.cpp repository license; model files retain their own licenses. | AI, Models local runtime | P2 | LOW | VERIFY_AT_IMPLEMENTATION |
| Windows Package Manager Community Repository | Windows Software Source | YES | https://github.com/microsoft/winget-pkgs | https://github.com/microsoft/winget-pkgs/blob/master/doc/manifest/schema/1.12.0/README.md | https://github.com/microsoft/winget-cli/tree/master/schemas/JSON/manifests | Public repository metadata. Microsoft Store is a separate source with different policy/auth. | GitHub/WinGet source dependent. | Local manifest/CLI cache according to WinGet behavior; KForge can cache normalized metadata. | Microsoft/winget-pkgs repository policy and package-specific publisher licenses apply. | Developer Tools, Windows software discovery | P1 | MEDIUM | APPROVED_METADATA_ONLY |
| WinGet REST Source Reference | Windows Software Source | YES | provider-defined | https://github.com/microsoft/winget-cli-restsource | https://github.com/microsoft/winget-cli-restsource/blob/main/documentation/WinGet-1.1.0.yaml | Source-specific. | Source-specific. | Source-specific. | Microsoft open-source project license + source-specific terms. | Developer Tools, Enterprise/private package sources | P2 | MEDIUM | OPTIONAL_PROVIDER |
| Microsoft Store Source | Windows Software Source | YES | Microsoft-managed | https://learn.microsoft.com/windows/package-manager/ | None verified | May require Store/device/account context. | Not established for direct third-party API use. | Provider-controlled. | Microsoft Store terms. | Windows software discovery | P3 | HIGH | OWNER_LEGAL_REVIEW_REQUIRED |
| Chocolatey Community Repository | Windows Software Source | NO / secondary | https://community.chocolatey.org | https://docs.chocolatey.org/ | None verified | Read/install policy varies. | Verify current community repository policy. | Provider-specific. | Chocolatey/community package terms plus package-specific licenses. | Developer Tools | P2 | HIGH | SECONDARY_DISCOVERY_ONLY |
| Scoop Buckets | Windows Software Source | NO / secondary | https://github.com/ScoopInstaller | https://scoop.sh/ | None verified | Public Git repositories. | GitHub API limits if using API. | Git-backed manifests. | Repository and package-specific terms. | Developer Tools | P2 | HIGH | SECONDARY_DISCOVERY_ONLY |
| OSV.dev API | Security Intelligence | YES | https://api.osv.dev | https://google.github.io/osv.dev/api/ | https://ossf.github.io/osv-schema/ | Public read API. | Official docs currently state no API rate limits. | KForge should cache package-version results for a short security TTL and refresh explicitly; malformed refresh must not replace last-good evidence. | OSV/OpenSSF project data licensing varies by upstream source; preserve source attribution/references from each vulnerability record. | Quality, Security, Dependency intelligence | P0 | LOW | APPROVED_READ_DISCOVERY |
| GitHub Dependabot Alerts API | Security Intelligence | YES | https://api.github.com | https://docs.github.com/en/rest/dependabot/alerts?apiVersion=2026-03-10 | None verified | Fine-grained token/GitHub App permissions depend on resource; use least privilege. | GitHub REST limits apply. | Authenticated conditional requests and ETag when supported. | GitHub Terms/API terms. | Remote, Security | P1 | LOW | APPROVED_AUTHENTICATED_READ |
| NIST NVD CVE API 2.0 | Security Intelligence | YES | https://services.nvd.nist.gov/rest/json/cves/2.0 | https://nvd.nist.gov/developers/vulnerabilities | None verified | Public; API key improves service limits. | NVD publishes API-key/non-key limits; verify current numbers immediately before implementation rather than freezing possibly changed values. | CVE data changes over time; cache with lastModified awareness and provider guidance. | NVD/NIST data-use notices apply. | Security enrichment | P2 | LOW | APPROVED_READ_DISCOVERY |
| GitHub REST API | Remote / CI | YES | https://api.github.com | https://docs.github.com/en/rest?apiVersion=2026-03-10 | GitHub REST OpenAPI descriptions in github/rest-api-description | Prefer GitHub App or fine-grained PAT with endpoint-minimum permissions. Never recommend a broad classic PAT by default. | Public unauthenticated: 60/hour. Authenticated user tokens: 5,000/hour; GitHub App installation limits vary/scale. Search and secondary limits can be stricter. | Use authenticated conditional requests. GitHub recommends ETag/conditional requests and notes unchanged authenticated requests returning 304 do not consume primary rate budget. | GitHub Terms/API terms. | Remote, GitHub, CI, Release, Updates, Remote Preview | P0 | LOW | APPROVED_AUTHENTICATED_READ |
| GitHub Releases for KForge Update Discovery | Product Updates | YES | https://api.github.com/repos/daynightae-cmyk/KForge | https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10 | None verified | Published public releases readable anonymously; auth raises rate budget. Drafts require authorized access. | GitHub REST limits apply. | Strong candidate for conditional GET/ETag. Updates should be an explicit refresh or scheduled user-approved check, not an uncontrolled page-open network call. | GitHub terms plus KForge release license. | System / Updates, Release & Distribution | P0 | MEDIUM | APPROVED_READ_DISCOVERY |
| GitHub Deployments & Deployment Statuses | Remote Preview | YES | https://api.github.com | https://docs.github.com/en/rest/deployments/deployments?apiVersion=2026-03-10 | None verified | Public/private repository permissions; least privilege read. | GitHub REST limits. | Conditional reads where available; status freshness short. | GitHub terms. | Remote Preview, Remote | P1 | LOW | APPROVED_AUTHENTICATED_READ |
| Vercel Deployments REST API | Remote Preview | YES | https://api.vercel.com | https://vercel.com/docs/rest-api/deployments/list-deployments | None verified | Bearer token; team/project scoping parameters. | Plan/provider dependent; inspect response headers and current Vercel policy. | Remote-preview status should use short TTL and explicit refresh; never cache secrets/environment variables from owner-only detail. | Vercel API/service terms. | Remote Preview | P1 | MEDIUM | OPTIONAL_PROVIDER |
| Official OpenAPI Documentation Sources | Remote Documentation | YES | allowlisted provider URLs | Provider-specific official OpenAPI URL | None verified | Provider-specific; public docs preferred. Never send project source to fetch docs. | Provider-specific. | ETag/Last-Modified/Cache-Control when present; hash content; preserve canonical URL/version/retrievedAt. | Provider documentation/API terms must be stored per source. | Online / Documentation, Global Search | P0 | LOW | APPROVED_FRAMEWORK |
| Official llms.txt / llms-full.txt when published by provider | Remote Documentation | NO / secondary | provider-defined | https://llmstxt.org/ | None verified | Usually public. | Provider-specific. | Normal HTTP conditional caching. | The convention does not grant content redistribution rights; provider docs terms still apply. | Remote Documentation | P1 | MEDIUM | SECONDARY_OFFICIAL_DISCOVERY |
| electron-updater / electron-builder update metadata | Product Updates | YES | publish-provider dependent | https://www.electron.build/docs/features/auto-update | None verified | Provider-specific; public GitHub releases can be public. | Hosting provider limits. | Updater/provider dependent. | electron-builder/electron-updater open-source license; hosting provider terms. | System / Updates | P2 | HIGH | BLOCK_AUTO_INSTALL_UNTIL_SIGNING_CLOSED |
| Microsoft GalleryRestClient / Azure DevOps Extension API | IDE Extensions | YES | Microsoft Gallery/VSS service | https://learn.microsoft.com/en-us/javascript/api/azure-devops-extension-api/galleryrestclient | None verified | Varies by gallery operation/account context. | Not established for KForge's intended third-party VS Code catalog use. | Provider specific. | Microsoft Marketplace/Azure DevOps terms require explicit review for KForge's use. | Extensions | P2 | HIGH | OWNER_LEGAL_REVIEW_REQUIRED |

## 5. P0 deep dive

### 5.1 Official MCP Registry

**Production base:** `https://registry.modelcontextprotocol.io`  
**Reference:** https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md  
**OpenAPI:** https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml

Verified discovery operations:

- `GET /v0.1/servers`
- `GET /v0.1/servers/{serverName}/versions`
- `GET /v0.1/servers/{serverName}/versions/{version}`

The list endpoint supports `cursor`, `limit`, `search`, `updated_since`, `version` and `include_deleted`. Cursors are opaque and must be replayed exactly. The official registry adds namespace authentication for publishing; KForge's P0 use is read-only discovery.

Useful normalized fields include package registry type/base URL/identifier/version, runtime hints, transports, package/runtime args and environment-variable declarations. Some package kinds can carry SHA-256 metadata.

**Security boundary:** Registry metadata is a discovery statement. It is not proof that the remote/local MCP server exposes a specific tool/resource/prompt at runtime. KForge must keep runtime capability probing after explicit trust/installation/connection.

### 5.2 Open VSX

**Base:** `https://open-vsx.org`  
**Swagger:** https://open-vsx.org/swagger-ui/index.html  
**OpenAPI:** https://open-vsx.org/v3/api-docs/registry  
**Terms:** https://www.eclipse.org/legal/termsofuse.php

Verified read surfaces include query/search, namespace, extension latest, version detail, version references, versions and packaged files. The OpenAPI advertises rate-limit headers and 429/Retry-After semantics. The project also exposes file types for VSIX, manifest, license, changelog, signature and public key.

**KForge mapping:** `Online → Extensions → Marketplace`, reusing the existing lifecycle. The adapter may make `CATALOG_ONLY` items discoverable; the existing install path must still require a verified artifact, explicit confirmation and post-install runtime evidence.

### 5.3 OSV

**Base:** `https://api.osv.dev`  
**Docs:** https://google.github.io/osv.dev/api/

- `POST /v1/query`
- `POST /v1/querybatch`
- `GET /v1/vulns/{id}`

OSV currently documents **no API rate limit**. HTTP/1.1 responses are capped at 32 MiB, while the provider recommends HTTP/2 for large responses. Queries support package version/commit and ecosystem/name or PURL semantics.

**KForge mapping:** existing Security Quality becomes the UI/evidence owner. The new adapter is observational. It may propose a fix/version, but it must not update dependency files by itself.

### 5.4 Hugging Face Hub

**Base:** `https://huggingface.co`  
**Machine-readable OpenAPI:** https://huggingface.co/.well-known/openapi.json  
**Markdown OpenAPI:** https://huggingface.co/.well-known/openapi.md  
**Terms:** https://huggingface.co/terms-of-service

The Hub explicitly documents open endpoints and `/api/models`, a JS client (`huggingface.js`), Python client (`huggingface_hub`) and webhooks. Public model records can be discovered anonymously; private/gated/user-specific access requires bearer authentication and provider terms.

**KForge mapping:** extend the existing AI/Marketplace model center. A Hub record is `CATALOG_ONLY`. License, gating and exact revision/SHA are first-class evidence. Presence on Hugging Face is never equivalent to local installation or executable compatibility.

### 5.5 KForge update discovery with GitHub Releases

**Docs:** https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10

`GET /repos/daynightae-cmyk/KForge/releases` provides release/channel/asset metadata. Current GitHub docs support up to 100 records per page and recommend `X-GitHub-Api-Version: 2026-03-10`.

KForge should treat release metadata as the **update catalog only**. A trusted Windows update requires all of these separately:

1. selected release channel and immutable version/tag,
2. resolved tag/commit evidence,
3. expected Windows x64 NSIS artifact,
4. checksum sidecar from the KForge release process,
5. downloaded-byte checksum verification,
6. Authenticode / Trusted Publisher verification when policy requires it,
7. explicit user authority,
8. installer/runtime verification.

Until trusted Windows publisher evidence exists, `TRUSTED_RELEASE` must remain blocked.

### 5.6 Remote Documentation framework

Use an allowlisted hierarchy:

1. provider-owned OpenAPI/JSON Schema,
2. provider-owned versioned documentation repository,
3. provider-owned sitemap/index,
4. provider-owned same-domain `llms.txt` / `llms-full.txt`,
5. bounded fetch of explicit official pages.

`llms.txt` is an emerging optional convention, not a license or trust certificate. Each `DocumentationRecord` needs canonical URL, provider, version, retrieval time, HTTP validators, content hash and license/terms classification.

Good initial machine-readable sources include:
- Hugging Face OpenAPI: `https://huggingface.co/.well-known/openapi.json`
- MCP Registry OpenAPI
- Open VSX OpenAPI
- Ollama OpenAPI
- OpenAI API `llms-full.txt`

## 6. Package registry strategy

### npm

Use registry APIs, not HTML crawling. Capture `dist.tarball`, `dist.integrity`, registry ECDSA signatures and signing-key identity when present. npm provenance is valuable for source/build traceability, but KForge must implement only a **documented** retrieval/verification flow; do not invent a provenance endpoint.

### PyPI

PyPI is particularly strong for a trust-aware adapter:
- JSON/Simple APIs expose artifact hashes.
- ETag/X-Cache support is explicitly documented.
- Integrity API exposes PEP 740 provenance.
- Trusted Publisher attestations can link artifacts to build/source identity.

### NuGet

Always start from the service index rather than hardcoding every resource endpoint. Repository-signature metadata and official package-signature verification give KForge a clean separation between package bytes, author signatures and repository signatures.

### crates.io

Follow the provider's own access hierarchy: sparse index → static artifacts → dump for bulk → JSON API only when needed. The JSON API has an explicit **1 request/second** limit and identifying User-Agent requirement.

### Go

Honor `GOPRIVATE`, `GONOPROXY` and `GONOSUMDB`; leaking a private module path to a public index is a security defect. Use the module proxy and SumDB for public artifacts and checksums; use pkg.go.dev for searchable documentation/metadata.

### RubyGems

The Compact Index is explicitly stable and cache-oriented: ETag, `If-None-Match`, HTTP Range and `Repr-Digest` SHA-256 are ideal for a local-first adapter.

## 7. AI/model discovery

| Provider | Real catalog surface | What KForge may trust | What KForge must NOT infer |
| --- | --- | --- | --- |
| Hugging Face | Hub `/api/models` + detail/repo APIs | model identity, returned revision/tags/files/license/gating | local install, executable runtime, hardware fitness unless measured |
| Ollama | local `/api/tags`, `/api/show`, `/api/ps` | installed/local model and runtime details | remote library catalog unless official API is documented |
| OpenAI | `GET /v1/models`, `GET /v1/models/{id}` | id, owner/basic provider metadata returned | pricing/context/tools from the basic models response |
| Anthropic | `GET /v1/models` | returned ModelInfo and capability flags | capabilities not present in response |
| Gemini | `GET /v1beta/models` + model get | token limits/supported methods returned | unsupported undocumented modality/pricing fields |
| OpenRouter | `/api/v1/models` | aggregator's pricing/context/supported params | upstream license or local execution truth |
| LM Studio | local `/v1/models` and native model list | local server inventory | cloud/provider truth |
| llama.cpp | current official server contract | loopback runtime data after current-contract verification | endpoints remembered from an older version |

## 8. Developer Tool Discovery Matrix

The tool catalog should discover official source, version and installation authority. A catalog hit never grants execution authority.

| Tool | Official site | Official repository | Version/health probe | Preferred acquisition authority | Priority |
| --- | --- | --- | --- | --- | --- |
| Git | https://git-scm.com/ | https://github.com/git/git | git --version | Official Git / Git for Windows release source; verify Windows publisher/signature | P0 |
| GitHub CLI | https://cli.github.com/ | https://github.com/cli/cli | gh --version | Official GitHub Releases + WinGet manifest where available | P1 |
| Node.js | https://nodejs.org/ | https://github.com/nodejs/node | node --version | Official Node distributions; verify SHASUMS/signatures | P0 |
| npm | https://www.npmjs.com/ | https://github.com/npm/cli | npm --version | Bundled with Node or official npm package | P0 |
| pnpm | https://pnpm.io/ | https://github.com/pnpm/pnpm | pnpm --version | Official project install methods; Corepack where applicable | P1 |
| Yarn | https://yarnpkg.com/ | https://github.com/yarnpkg/berry | yarn --version | Official project/Corepack; preserve project packageManager contract | P1 |
| Bun | https://bun.sh/ | https://github.com/oven-sh/bun | bun --version | Official project installer/releases; verify artifact integrity | P1 |
| Python | https://www.python.org/ | https://github.com/python/cpython | python --version | python.org signed installer / approved WinGet manifest | P0 |
| pip | https://pip.pypa.io/ | https://github.com/pypa/pip | python -m pip --version | Installed with Python/ensurepip; project-specific environments | P0 |
| uv | https://docs.astral.sh/uv/ | https://github.com/astral-sh/uv | uv --version | Official Astral release/install source | P1 |
| Poetry | https://python-poetry.org/ | https://github.com/python-poetry/poetry | poetry --version | Official Poetry installer/pipx; explicit env scope | P1 |
| Rust | https://www.rust-lang.org/tools/install | https://github.com/rust-lang/rust | rustc --version | rustup official bootstrap; confirmation required | P0 |
| Cargo | https://doc.rust-lang.org/cargo/ | https://github.com/rust-lang/cargo | cargo --version | Installed through Rust toolchain | P0 |
| Go | https://go.dev/dl/ | https://github.com/golang/go | go version | Official Go distribution; checksum validation | P0 |
| Java / JDK | https://openjdk.org/ | https://github.com/openjdk/jdk | java -version | Vendor MUST be explicit (OpenJDK/Temurin/Microsoft/Oracle/etc.); no generic auto-install | P1 |
| Maven | https://maven.apache.org/ | https://github.com/apache/maven | mvn -version | Apache official releases/checksums/signatures | P1 |
| Gradle | https://gradle.org/releases/ | https://github.com/gradle/gradle | gradle --version | Gradle official distribution/checksum | P1 |
| .NET SDK | https://dotnet.microsoft.com/ | https://github.com/dotnet/sdk | dotnet --info | Microsoft official installer/WinGet | P0 |
| PowerShell | https://learn.microsoft.com/powershell/ | https://github.com/PowerShell/PowerShell | pwsh --version | Microsoft official release/WinGet | P0 |
| Docker | https://docs.docker.com/ | https://github.com/docker/cli | docker version | Docker Desktop/Engine terms differ; explicit owner acceptance | P1 |
| Docker Compose | https://docs.docker.com/compose/ | https://github.com/docker/compose | docker compose version | Docker plugin/bundled install | P1 |
| kubectl | https://kubernetes.io/docs/tasks/tools/ | https://github.com/kubernetes/kubernetes | kubectl version --client | Kubernetes official binaries/checksums | P2 |
| Helm | https://helm.sh/ | https://github.com/helm/helm | helm version | Official releases/checksums | P2 |
| Terraform | https://developer.hashicorp.com/terraform | https://github.com/hashicorp/terraform | terraform version | HashiCorp official distribution; newer Terraform licensing must be displayed, not assumed OSS | P2 |
| OpenTofu | https://opentofu.org/ | https://github.com/opentofu/opentofu | tofu version | Official releases; license evidence from repo | P2 |
| Ansible | https://docs.ansible.com/ | https://github.com/ansible/ansible | ansible --version | Python package/control-node platform constraints; avoid false Windows-native claim | P2 |
| CMake | https://cmake.org/ | https://github.com/Kitware/CMake | cmake --version | Kitware official release / WinGet | P1 |
| Ninja | https://ninja-build.org/ | https://github.com/ninja-build/ninja | ninja --version | Official GitHub release / package manager | P2 |
| GNU Make | https://www.gnu.org/software/make/ | https://git.savannah.gnu.org/cgit/make.git | make --version | Windows distribution authority varies; discovery yes, generic auto-install no | P2 |
| Gitleaks | https://gitleaks.io/ | https://github.com/gitleaks/gitleaks | gitleaks version | Official GitHub release; verify checksum/signing evidence when provided | P0 |
| Semgrep | https://semgrep.dev/ | https://github.com/semgrep/semgrep | semgrep --version | Official package; remote rules/server contact remains disclosure-gated | P0 |
| SonarScanner | https://docs.sonarsource.com/ | https://github.com/SonarSource/sonar-scanner-cli | sonar-scanner --version | Official Sonar distribution; server connection explicit | P1 |
| ESLint | https://eslint.org/ | https://github.com/eslint/eslint | eslint --version | Project package manager preferred | P0 |
| Prettier | https://prettier.io/ | https://github.com/prettier/prettier | prettier --version | Project package manager preferred | P1 |
| Biome | https://biomejs.dev/ | https://github.com/biomejs/biome | biome --version | Official npm/binary source; project pin preferred | P1 |
| TypeScript | https://www.typescriptlang.org/ | https://github.com/microsoft/TypeScript | tsc --version | Project package manager preferred | P0 |
| Playwright | https://playwright.dev/ | https://github.com/microsoft/playwright | playwright --version | Project dependency + browser binary policy; large downloads require confirmation | P0 |
| Vitest | https://vitest.dev/ | https://github.com/vitest-dev/vitest | vitest --version | Project dependency preferred | P0 |
| Jest | https://jestjs.io/ | https://github.com/jestjs/jest | jest --version | Project dependency preferred | P1 |
| pytest | https://pytest.org/ | https://github.com/pytest-dev/pytest | pytest --version | Python environment/project dependency | P0 |
| ripgrep | https://github.com/BurntSushi/ripgrep | https://github.com/BurntSushi/ripgrep | rg --version | Official releases / approved package manager | P1 |
| fd | https://github.com/sharkdp/fd | https://github.com/sharkdp/fd | fd --version | Official releases / approved package manager | P2 |
| jq | https://jqlang.org/ | https://github.com/jqlang/jq | jq --version | Official releases / package manager | P2 |
| Git LFS | https://git-lfs.com/ | https://github.com/git-lfs/git-lfs | git lfs version | Official release / Git for Windows integration | P1 |

**License rule for the tool matrix:** because this mission did not re-read the license file for every tool release, KForge must store each tool's official repository/license URL and verify it at adapter implementation time. Do not guess license/commercial redistribution rights from package-manager presence. Terraform is an especially important example where version/license family matters.

## 9. Windows source policy

### WinGet

P1. The community manifest schema already provides the metadata KForge needs for safe discovery: PackageIdentifier, version, architecture, installer type/URL, `InstallerSha256`, optional signature hash, scope, switches, dependencies and upgrade behavior.

**Important:** a WinGet community manifest proves that a reviewed manifest exists, not that the publisher identity or installer signature is trusted by KForge. Always cross-check official publisher source and verify Authenticode/signature where applicable.

### Chocolatey / Scoop

Secondary/community discovery only unless the owner explicitly chooses them. They must never silently override a stronger official publisher or WinGet source.

### Microsoft Store

Do not reverse engineer Store APIs. Use only supported WinGet/Store contracts.

## 10. GitHub / CI / Release contract

Current REST version for new code: `2026-03-10`.

Verified provider guidance:
- unauthenticated primary rate limit: 60 requests/hour,
- authenticated user token: 5,000 requests/hour,
- GitHub App installation limits vary and can scale,
- search/secondary limits can be stricter,
- use webhooks instead of polling where practical,
- use authenticated conditional requests,
- preserve 304/caching semantics,
- respect `Retry-After`, `X-RateLimit-*` and `x-poll-interval`,
- serialize/bound requests to reduce secondary-limit risk.

For KForge authentication, prefer GitHub App or fine-grained PAT with the minimum endpoint permission. Do not default to a broad classic PAT.

## 11. Remote Preview

### GitHub Deployments

Deployment statuses can expose `environment_url` and `log_url`. This is enough for a truthful read-only Remote Preview reference when a deployment provider publishes the status.

### Vercel

`GET /v7/deployments` is an official bearer-authenticated read API with project/branch/SHA/state filtering and deployment URL/state fields. This makes Vercel a clean optional P1 remote-preview adapter.

No remote-preview adapter gets permission to upload source or create a deployment merely because read discovery is configured.

## 12. Trust ladder

| State | Meaning |
| --- | --- |
| CATALOG_DISCOVERED | Provider returned metadata. Nothing about local presence or trust is implied. |
| SOURCE_IDENTIFIED | Canonical provider/repository/publisher references are known. |
| LICENSE_CLASSIFIED | License/terms evidence captured; unknown terms remain LEGAL_REVIEW_REQUIRED. |
| ARTIFACT_IDENTIFIED | Specific immutable version/artifact URL selected. |
| INTEGRITY_EXPECTED | Expected hash/digest obtained from an authority distinct from downloaded bytes when possible. |
| ARTIFACT_VERIFIED | Downloaded/staged bytes match expected integrity metadata. |
| SIGNATURE_VERIFIED | Cryptographic signature/certificate verified where supported. |
| PROVENANCE_VERIFIED | Build/source provenance attestation verified where available. |
| COMPATIBILITY_VERIFIED | OS/arch/runtime/project compatibility checked. |
| USER_CONFIRMED | Required disclosure and explicit action approval recorded. |
| INSTALLED | Filesystem/package-manager transaction completed durably. |
| RUNTIME_VERIFIED | Post-install version/health/runtime evidence passed. |

This ladder is deliberately stricter than one boolean `trusted`. Hash verification proves bytes match an expected digest; it does not prove the publisher is benevolent. A signature proves control of a signing identity; it does not prove the code is malware-free. Provenance proves a build/source relationship; it does not grant a license.

## 13. Normalized TypeScript contract proposal

The names below are proposals. The implementation agent should map them to existing KForge types instead of blindly creating duplicates.

```ts
export type SourceAuthority =
  | "OFFICIAL"
  | "FIRST_PARTY"
  | "COMMUNITY"
  | "THIRD_PARTY"
  | "UNVERIFIED";

export type SourceCapability =
  | "SEARCH" | "LIST" | "DETAIL" | "VERSIONS" | "ARTIFACTS"
  | "CHANGELOG" | "DOCUMENTATION" | "SECURITY"
  | "INSTALL_METADATA" | "UPDATE_METADATA" | "DOWNLOAD";

export type EvidenceState =
  | "VERIFIED" | "PRESENT" | "UNKNOWN" | "NOT_AVAILABLE"
  | "NOT_CONFIGURED" | "BLOCKED";

export interface SourcedValue<T> {
  value: T | null;
  state: EvidenceState;
  sourceId: string;
  sourceUrl: string | null;
  authority: SourceAuthority;
  fetchedAt: string | null;
  freshness: "LIVE" | "CURRENT" | "CACHED" | "STALE" | "UNKNOWN";
}

export interface RegistrySource {
  id: string;
  name: string;
  authority: SourceAuthority;
  baseUrl: string;
  docsUrl: string;
  termsUrl?: string;
  capabilities: SourceCapability[];
  authentication: "NONE" | "OPTIONAL" | "REQUIRED";
  allowedOrigins: string[];
}

export interface CatalogArtifact {
  url: SourcedValue<string>;
  fileName: SourcedValue<string>;
  sizeBytes: SourcedValue<number>;
  mediaType: SourcedValue<string>;
  platform: SourcedValue<string>;
  architecture: SourcedValue<string>;
  integrity: IntegrityEvidence[];
  signatures: SignatureEvidence[];
  provenance: ProvenanceEvidence[];
}

export interface IntegrityEvidence {
  algorithm: "sha256" | "sha512" | "sri" | "other";
  digest: string;
  sourceId: string;
  sourceUrl: string;
  state: EvidenceState;
  verifiedAt: string | null;
}

export interface SignatureEvidence {
  scheme: string;
  keyId?: string;
  certificateSubject?: string;
  sourceUrl: string | null;
  state: EvidenceState;
  verifiedAt: string | null;
}

export interface ProvenanceEvidence {
  kind: "SLSA" | "PYPI_PUBLISH" | "NPM_PROVENANCE" | "OTHER";
  sourceRepository?: string;
  sourceCommit?: string;
  builder?: string;
  transparencyLogUrl?: string;
  sourceUrl: string;
  state: EvidenceState;
}

export interface LicenseEvidence {
  spdxId: SourcedValue<string>;
  name: SourcedValue<string>;
  termsUrl: SourcedValue<string>;
  redistribution: "ALLOWED" | "RESTRICTED" | "UNKNOWN";
  commercialUse: "ALLOWED" | "RESTRICTED" | "UNKNOWN";
  attributionRequired: boolean | null;
  legalReviewRequired: boolean;
}

export interface CacheEvidence {
  sourceId: string;
  cacheKey: string;
  retrievedAt: string;
  lastSuccessfulRefresh: string | null;
  lastRefreshAttempt: string | null;
  lastRefreshError: string | null;
  etag: string | null;
  lastModified: string | null;
  expiresAt: string | null;
  responseSha256: string;
  originalAuthority: SourceAuthority;
}

export interface CatalogItem {
  id: string;
  sourceId: string;
  kind: "mcp-server" | "extension" | "model" | "package" | "tool" | "documentation";
  name: SourcedValue<string>;
  description: SourcedValue<string>;
  publisher: PublisherIdentity;
  license: LicenseEvidence;
  repository: SourcedValue<string>;
  versions: CatalogVersion[];
  tags: SourcedValue<string[]>;
  compatibility: CompatibilityEvidence[];
  runtime: RuntimeRequirement[];
  security: SecurityAdvisory[];
  install?: InstallRecipe;
  update?: UpdateRecipe;
  cache: CacheEvidence;
}

export interface CatalogVersion {
  version: string;
  publishedAt: SourcedValue<string>;
  deprecated: SourcedValue<boolean>;
  yanked: SourcedValue<boolean>;
  artifacts: CatalogArtifact[];
  dependencies: SourcedValue<Array<{ name: string; range: string }>>;
}

export interface PublisherIdentity {
  id: SourcedValue<string>;
  name: SourcedValue<string>;
  verified: SourcedValue<boolean>;
}

export interface CompatibilityEvidence {
  os: string[];
  architectures: string[];
  runtimeRanges: Array<{ runtime: string; range: string }>;
  state: EvidenceState;
  sourceUrl: string;
}

export interface RuntimeRequirement {
  runtime: string;
  versionRange: string | null;
  executableHint: string | null;
  sourceUrl: string;
}

export interface SecurityAdvisory {
  id: string;
  aliases: string[];
  ecosystem: string | null;
  packageName: string | null;
  affectedRanges: unknown[];
  fixedVersions: string[];
  severity: unknown[];
  references: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  withdrawnAt: string | null;
  sourceId: string;
}

export interface InstallRecipe {
  method: "package-manager" | "archive" | "installer" | "mcp-package" | "manual";
  requiresConfirmation: true;
  artifact: CatalogArtifact | null;
  commands: string[]; // generated only by a trusted adapter, never copied blindly from remote text
  verificationSteps: string[];
  rollbackSteps: string[];
}

export interface UpdateRecipe extends InstallRecipe {
  fromVersion: string;
  toVersion: string;
}

export interface DocumentationRecord {
  provider: string;
  canonicalUrl: string;
  title: string;
  version: string | null;
  retrievedAt: string;
  etag: string | null;
  lastModified: string | null;
  contentSha256: string;
  authority: SourceAuthority;
  license: LicenseEvidence;
}

export interface ModelMetadata {
  provider: string;
  modelId: string;
  revision: string | null;
  task: string | null;
  formats: string[];
  quantizations: string[];
  gated: boolean | null;
  files: CatalogArtifact[];
}

export interface ExtensionMetadata {
  namespace: string;
  extensionId: string;
  version: string;
  targetPlatform: string | null;
  vsix: CatalogArtifact | null;
}

export interface McpServerMetadata {
  serverName: string;
  version: string;
  packages: unknown[];
  remotes: unknown[];
  environmentVariables: unknown[];
  transports: Array<"stdio" | "streamable-http" | "sse" | string>;
}

export interface PackageMetadata {
  ecosystem: string;
  packageName: string;
  version: string;
  artifacts: CatalogArtifact[];
}

export interface ToolMetadata {
  toolId: string;
  versionCommand: string;
  officialRepository: string;
  acquisitionSources: string[];
}

export interface RemoteFetchEvidence {
  provider: string;
  destination: string;
  method: string;
  requestedAt: string;
  completedAt: string | null;
  result: "SUCCEEDED" | "FAILED" | "BLOCKED" | "NOT_MODIFIED";
  statusCode: number | null;
  dataClasses: string[];
  projectSourceTransmitted: false;
  redactionsApplied: string[];
}
```

### Mapping principle

The important part is not the exact interface names. The important part is that every material value carries:
- source,
- authority,
- freshness,
- verification state,
- retrieval time,
- canonical reference.

This maps cleanly onto KForge's existing `MarketplaceEvidenceField`, `OnlineAuthorityEvidence`, `OnlineRuntimeEvidence` and freshness concepts.

## 14. Shared remote-fetch hardening

```ts
import { z } from "zod";

const MAX_JSON_BYTES = 8 * 1024 * 1024;

export async function fetchProviderJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  opts: {
    headers?: Record<string, string>;
    etag?: string | null;
    timeoutMs?: number;
  } = {},
): Promise<
  | { state: "NOT_MODIFIED"; etag: string | null }
  | { state: "OK"; value: T; etag: string | null; lastModified: string | null }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);

  try {
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": "KNOuX-Forge/remote-catalog",
      ...opts.headers,
    });
    if (opts.etag) headers.set("If-None-Match", opts.etag);

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "error", // provider adapter must explicitly validate redirects/origins
    });

    if (response.status === 304) {
      return { state: "NOT_MODIFIED", etag: opts.etag ?? null };
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`PROVIDER_RATE_LIMITED retry-after=${retryAfter ?? "unknown"}`);
    }

    if (!response.ok) {
      throw new Error(`PROVIDER_HTTP_${response.status}`);
    }

    const declared = Number(response.headers.get("content-length") || "0");
    if (declared && declared > MAX_JSON_BYTES) {
      throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
    }

    const raw: unknown = await response.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error("PROVIDER_SCHEMA_MISMATCH");

    return {
      state: "OK",
      value: parsed.data,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } finally {
    clearTimeout(timer);
  }
}
```

Provider adapters should additionally enforce:
- allowlisted origins,
- redirect validation,
- DNS/private-address SSRF protection,
- response-size limits before and during streaming,
- JSON/schema validation,
- no HTML-as-JSON trust,
- redacted logs,
- bounded retries only for safe idempotent reads,
- no secret-bearing query strings,
- last-known-good cache preservation on refresh failure.

## 15. P0 code seeds

### MCP Registry

```ts
const url = new URL("https://registry.modelcontextprotocol.io/v0.1/servers");
url.searchParams.set("search", query);
url.searchParams.set("version", "latest");
url.searchParams.set("limit", "30");
if (cursor) url.searchParams.set("cursor", cursor);

const page = await fetchProviderJson(url, McpServerListSchema, {
  timeoutMs: 10_000,
});

// Persist metadata.nextCursor exactly as returned.
// Normalize package/transport/env metadata.
// Do NOT mark the MCP server installed or executable from registry metadata alone.
```

### Open VSX

```ts
const url = new URL("https://open-vsx.org/api/-/query");
// Bind query parameters from the CURRENT OpenAPI schema rather than hand-building
// an undocumented Microsoft Marketplace request.
url.searchParams.set("query", query);

const page = await fetchProviderJson(url, OpenVsxQuerySchema, {
  timeoutMs: 10_000,
});

// Save extension identity, namespace, version, verified flag and provider file URLs.
// Before any install: obtain immutable VSIX + provider SHA/signature evidence,
// stage bytes, verify, require confirmation, then use KForge's existing lifecycle.
```

### OSV

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);
try {
  const response = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      queries: dependencies.map((d) => ({
        version: d.version,
        package: { ecosystem: d.osvEcosystem, name: d.name },
      })),
    }),
  });
  if (response.status === 429) throw new Error("OSV_RATE_LIMITED");
  if (!response.ok) throw new Error(`OSV_HTTP_${response.status}`);
  const data = OsvBatchResponseSchema.parse(await response.json());
  // Observational only: normalize advisory IDs/ranges/fixed versions.
  // Do not mutate package manifests here.
} finally {
  clearTimeout(timer);
}
```

### Hugging Face

```ts
const url = new URL("https://huggingface.co/api/models");
url.searchParams.set("search", query);
url.searchParams.set("limit", "20");

const result = await fetchProviderJson(url, HuggingFaceModelListSchema, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
  timeoutMs: 12_000,
});

// Public catalog result => CATALOG_ONLY.
// Capture repo id, revision/SHA, tags/license/gated state/files only when actually
// supplied by the current Hub schema/detail endpoint.
// Never infer local installation from Hub presence.
```

### GitHub Releases / Updates

```ts
const url = new URL(
  "https://api.github.com/repos/daynightae-cmyk/KForge/releases?per_page=20"
);

const releases = await fetchProviderJson(url, GitHubReleasesSchema, {
  headers: {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  etag: cached?.etag,
  timeoutMs: 10_000,
});

// Select channel: stable excludes draft/prerelease; beta is explicit.
// Resolve tag -> commit evidence.
// Find expected Windows-x64 NSIS artifact + checksum/signature/SBOM sidecars.
// Do NOT promote to TRUSTED_RELEASE until existing KForge release/signing gates pass.
```

### Remote Documentation

```ts
const source = configuredDocumentationSources[sourceId];
if (!source) throw new Error("DOC_SOURCE_NOT_CONFIGURED");

const url = new URL(source.openApiUrl);
if (url.protocol !== "https:" || url.hostname !== source.allowedHostname) {
  throw new Error("DOC_SOURCE_ORIGIN_BLOCKED");
}

const doc = await fetchProviderJson(url, OpenApiDocumentSchema, {
  etag: cached?.etag,
  timeoutMs: 10_000,
});

// Store: canonicalUrl, provider, schema/version, retrievedAt, ETag,
// Last-Modified, content hash, authority and license/terms classification.
// Never follow arbitrary URLs from the document as privileged fetch targets.
```

## 16. Cache policy

KForge should not invent provider cache semantics. It should preserve provider headers, then apply a local policy on top.

Recommended **KForge local policy** (these are product defaults, not provider promises):

| Data | Suggested local TTL | Notes |
| --- | ---: | --- |
| interactive search results | 10–30 min | stale may be shown offline with clear label |
| item detail/version metadata | 1–6 h | conditional refresh when provider supports ETag |
| stable package/model versions | 6–24 h | invalidate sooner on explicit refresh |
| OSV package/version lookup | 1–6 h | security refresh button always available |
| documentation metadata/content | 6–24 h | preserve ETag/Last-Modified/content hash |
| KForge update check | 15–60 min | page-open must still obey Online policy |
| GitHub status/Actions | seconds–minutes | use conditional requests/webhooks where possible |
| remote deployment status | 15–60 sec while actively viewed | longer when idle |

Persist:
`sourceId`, canonical request/query key, retrievedAt, last successful refresh, last attempt, last error, ETag, Last-Modified, response SHA-256, schema version, authority, optional expiry.

On a failed refresh:
- keep last-known-good data,
- mark `REFRESH_FAILED` / `STALE`,
- never rewrite it with malformed remote data.

## 17. Database decision

### Option A — existing `.kforge` atomic JSON: **RECOMMENDED FOR P0**

Use for:
- source configuration,
- remote-contact history,
- bounded query/detail cache,
- update evidence,
- normalized recently-used catalog items,
- documentation cache manifests,
- provider health/rate-limit evidence.

Advantages:
- preserves current local-first architecture,
- no native database dependency,
- minimal Electron/Windows packaging impact,
- simple backup/rollback,
- consistent with existing KForge truth stores.

### Option B — embedded indexed database: **NOT REQUIRED YET**

Introduce SQLite/FTS or equivalent only when measured requirements justify it, such as:
- tens/hundreds of thousands of retained normalized records,
- offline cross-provider full-text search,
- frequent incremental index updates,
- large version histories,
- concurrent refresh/search that makes atomic JSON expensive,
- cache sizes roughly around/above 100 MB.

Those are engineering trigger points, not provider requirements.

If adopted:
- hide it behind `RemoteCatalogStore`,
- version migrations,
- WAL/transaction policy,
- backup/export,
- corruption recovery / integrity check,
- never store provider tokens in plaintext,
- verify Electron/native-module packaging on Windows,
- prove uninstall/data-retention behavior.

### Option C — Supabase/cloud DB: **OPTIONAL ONLY**

Possible future uses:
- account profile,
- opt-in cross-device settings sync,
- team catalog favorites/policies,
- shared non-secret annotations.

It must **not** become authority for:
- local project source,
- Git state,
- installed tools,
- local model/runtime state,
- CI evidence,
- installer trust,
- Marketplace lifecycle truth.

## 18. Supply-chain execution policy

Every downloadable artifact should pass as many applicable gates as the provider supports:

`canonical source → immutable version → artifact URL → size bound → expected hash → download to staging → hash verify → signature verify → provenance verify → license policy → compatibility → confirmation → install → version/health verify → evidence → rollback capability`

Reject:
- arbitrary mirrors,
- HTTP downgrade,
- provider-returned URL to a new unapproved origin without validation,
- archive traversal,
- command lines copied from arbitrary remote descriptions,
- “hash” computed only after download with no independent expected value,
- silent installer execution.

## 19. Microsoft Marketplace disposition

Microsoft publishes an official `GalleryRestClient`/`ExtensionQuery` SDK surface, so the ecosystem is not purely undocumented. However, that does **not** by itself establish that KForge may freely mirror/query/download VS Code Marketplace content through raw Gallery endpoints as a third-party desktop client.

Disposition:

**P2 — OWNER_LEGAL_REVIEW_REQUIRED**

Until the exact supported contract and Marketplace terms for this use are confirmed:
- prefer Open VSX,
- do not call guessed `marketplace.visualstudio.com/_apis/...` endpoints,
- do not cache/redistribute Marketplace assets based on reverse engineering.

## 20. Rejected / blocked implementation approaches

| Candidate | Disposition | Reason |
| --- | --- | --- |
| Scraping npmjs.com/PyPI/Open VSX/VS Marketplace HTML | REJECT | official machine APIs exist or terms are clearer |
| Raw undocumented Microsoft Marketplace Gallery requests | BLOCK | supported use/terms not established for KForge |
| Scraping `ollama.com/library` as remote catalog | BLOCK | no official catalog API verified in this mission |
| Third-party MCP directories as install authority | REJECT | can be secondary discovery only; not official trust root |
| Arbitrary GitHub repository releases as trusted binary source | REJECT | repository/release presence is not publisher/integrity proof |
| Microsoft Store reverse engineering | REJECT | use supported contracts only |
| Generic web scraping for Remote Documentation | REJECT | provenance/licensing/SSRF risk |
| `llms.txt` as sole authority | REJECT | optional convention, no license/trust guarantee |
| Full npm/HF/package-world mirror into KForge | REJECT for P0 | huge storage/freshness/legal burden with little product value |
| Auto-update before Windows signing closure | BLOCK | contradicts current KForge release truth boundary |
| Supabase as mandatory core storage | REJECT | violates local-first architecture and solves the wrong gap |

## 21. Academic validation

The strict separation between discovery, integrity, provenance and runtime trust is supported by software-supply-chain research. Williams (2022) describes modern software as layered on reusable dependencies and infrastructure outside an organization's direct trust boundary and discusses provenance/build-process hardening. Vu, Pashchenko, and Massacci (2020) document how package repositories such as npm and PyPI become supply-chain attack vectors through compromised publishing identities and typosquatting. Vu, Newman, and Meyers (2023) show that repository-scale malicious-package detection needs multiple evidence approaches and has practical false-positive/coverage constraints.

No editorial notice/retraction was returned by Scite for these retained papers.

Short evidence excerpts retained from the literature review:

> “software is increasingly built on top of layers of reusable abstractions” (Williams, 2022).

> “Software supply chain attacks occur when an attacker hijacks the complex software development chain to insert malicious code” (Vu et al., 2020).

> “Programming language-specific package repositories ... are both a target for supply chain attacks and a site from which to mount defenses” (Vu et al., 2023).

These excerpts support the architectural decision to keep catalog discovery, artifact integrity, publisher identity, provenance and runtime verification as separate evidence layers.

## 22. Final verdict

### WHAT KFORGE ALREADY HAS

- local-first operating modes and policy,
- no-contact-on-open Online truth boundary,
- Marketplace taxonomy and lifecycle,
- provenance/integrity/publisher/dependency evidence slots,
- local AI and cloud-provider execution controls,
- project/security/quality evidence engines,
- GitHub/remote read surface,
- release source separation,
- explicit confirmation and trust boundaries,
- `.kforge` bounded persistence.

### WHAT DATA KFORGE IS MISSING

- authoritative remote MCP catalog,
- extension catalog with artifact/integrity metadata,
- broad model metadata/revision/license/gating catalog,
- normalized package ecosystem catalog metadata,
- vulnerability intelligence feed,
- remote documentation index/content provenance,
- product-update metadata,
- optional remote deployment/preview metadata,
- normalized developer-tool acquisition metadata.

### WHAT APIS KFORGE IS MISSING

P0: MCP Registry, Open VSX, OSV, Hugging Face Hub, GitHub Releases/update path, Remote Documentation source adapters.

P1: npm, PyPI, NuGet, WinGet, Vercel/GitHub Deployments, richer existing AI-provider model-list endpoints.

P2: Maven, crates.io, Go, Packagist, RubyGems, NVD, OpenRouter, community Windows sources.

### WHAT REGISTRIES KFORGE IS MISSING

A normalized, pluggable remote registry layer behind the **existing** Marketplace/Online contracts. It should not be a second Marketplace.

### WHAT SHOULD NOT BE ADDED

- mandatory Supabase,
- silent remote refresh,
- raw undocumented APIs,
- arbitrary binary mirrors,
- auto-install based on catalog presence,
- one universal `trusted=true` flag,
- a giant mirrored internet database,
- updater installation before signing/trust closure.

### WHETHER A DATABASE IS ACTUALLY REQUIRED

**No, not for P0.** Keep `.kforge` atomic stores and add a clean storage abstraction. Add an embedded indexed DB only after measured catalog/cache/search scale justifies it. Cloud DB remains opt-in sync only.

### P0 IMPLEMENTATION ORDER

1. Canonical RemoteSource/Fetch/Cache contracts mapped onto existing OnlineAuthorityEvidence and Marketplace evidence.
2. Official MCP Registry adapter: search/detail/versions only; no auto-run.
3. Open VSX adapter: search/detail/version/artifact/integrity metadata; existing lifecycle handles install authority.
4. OSV adapter: batch package/version vulnerability intelligence into existing Security Quality.
5. Hugging Face Hub model catalog adapter: public metadata/revision/files/license/gating; never mark catalog item installed.
6. GitHub Releases KForge update discovery: stable/prerelease channels, tag/commit/asset/checksum/signing evidence separation.
7. Remote Documentation framework: official OpenAPI → official docs repo/sitemap → same-domain official llms.txt; global search integration.
8. Harden existing GitHub read adapters with current API version, conditional requests, least privilege and rate-limit evidence.

### RESEARCH GAPS REQUIRING OWNER / IMPLEMENTATION-TIME DECISIONS

1. Whether Microsoft Marketplace is desired strongly enough to perform terms/legal review.
2. Whether KForge should ever install remote extensions/MCP packages directly, or remain discovery + handoff for the first release.
3. Windows code-signing certificate/provider before any trusted auto-update workflow.
4. Which documentation providers are allowlisted in v1.
5. Whether Vercel remote preview is worth P1 implementation or should remain GitHub-deployment-only initially.
6. Cache-size/indexing thresholds before introducing SQLite.
7. Which third-party/community Windows sources are allowed by owner policy.
8. Per-model and per-package license display/acceptance UX.

## 23. References

Williams, L. (2022). *Trusting Trust: Humans in the Software Supply Chain Loop*. IEEE Security & Privacy, 20(5), 7–10. https://doi.org/10.1109/MSEC.2022.3173123

Vu, D.-L., Pashchenko, I., & Massacci, F. (2020). *Towards Using Source Code Repositories to Identify Software Supply Chain Attacks*. Proceedings of the ACM SIGSAC Conference on Computer and Communications Security, 2093–2095. https://doi.org/10.1145/3372297.3420015

Vu, D.-L., Newman, Z., & Meyers, J. S. (2023). *Bad Snakes: Understanding and Improving Python Package Index Malware Scanning*. 2023 IEEE/ACM 45th International Conference on Software Engineering (ICSE), 499–511. https://doi.org/10.1109/ICSE48619.2023.00052

## 24. Primary official source index

The machine-readable `kforge-sources.json` is the canonical source inventory accompanying this document. It contains the exact base/docs/schema URLs, authentication, limits, cache policy, capabilities, priority and disposition for every reviewed adapter candidate.
