# KForge Marketplace Lifecycle Audit

**Generated from live repository inspection**

---

## What Already Exists

### 1. Marketplace Service (`server/services/marketplace.ts`)
- **Core function**: `getMarketplace(workspaceRoot, onlineOptional)` - normalizes marketplace data from multiple sources
- **Project-aware function**: `getProjectMarketplace(workspaceRoot, onlineOptional, project, profile)` - adds project compatibility
- **Preview function**: `previewMarketplaceInstall(workspaceRoot, onlineOptional, itemId)` - validates install readiness
- **Registry adapters**: `listMarketplaceRegistryAdapters(onlineOptional)` - exposes local + configured remote adapters

### 2. Marketplace Data Sources (Priority Order)
| Source | Type | Adapter ID | State | Capabilities |
|--------|------|------------|-------|--------------|
| Local KForge Registry | Local | `local-registry` | AVAILABLE | catalog, extension-metadata |
| Ollama Official Library | Remote | `ollama-official` | NOT_CONFIGURED / OFFLINE | catalog, version, changelog, install |
| Extension Registries | Remote | `extension-registries` | NOT_CONFIGURED / OFFLINE | catalog, extension-metadata, install |

### 3. Marketplace Item Types (Currently Implemented)
- **Models** (from Ollama runtime): `ollama:{modelId}` - installed & recommended
- **Agents**: `agent:kforge:engineer` - built-in, installed, managed locally
- **Tools**: `tool:kforge:{name}` - built-in agent tools (read_file, write_file, typecheck, test, build, etc.)
- **Registered Extensions**: From `.kforge/marketplace-registry.json` (if present)

### 4. Registry Storage
- **File**: `.kforge/marketplace-registry.json` at workspace root
- **Format**: `{ items: MarketplaceItem[] }`
- **Read by**: `readLocalRegistry(workspaceRoot)` in marketplace.ts
- **Items validated by**: `registeredItem()` function

### 5. Permission Model (9 Classes)
```typescript
type MarketplacePermissionClass = 
  | "filesystem-read" 
  | "filesystem-write" 
  | "network" 
  | "process-execution" 
  | "git" 
  | "project-read" 
  | "project-write" 
  | "ai-access" 
  | "external-apis";
```
- Every item exposes all 9 permission classes with `required: boolean` and `detail: string`
- Permissions are evaluated per-item in `permissionReview()`

### 6. Evidence Model
Every item carries explicit evidence fields:
- `security`, `publisher`, `repository`, `releaseHistory`, `changelog`
- `installationState`, `updateState`, `dependencies`
- `provenance`, `integrity`
- All use `MarketplaceEvidenceState`: `VERIFIED` | `UNKNOWN` | `NOT_AVAILABLE` | `NOT_CONFIGURED`

### 7. Lifecycle Stages (18 Stages)
```typescript
type MarketplaceLifecycleStage["id"] = 
  "inspect" | "compatibility" | "security" | "permissions" | "trust" 
  | "confirmation" | "download" | "integrity-verification" | "install" 
  | "register" | "enable" | "runtime-verification" | "disable" 
  | "update" | "verify-updated-version" | "uninstall" 
  | "cleanup-registration" | "restart-reconnect-verification";
```
- Each stage returns state: `VERIFIED` | `READY` | `REQUIRED` | `BLOCKED` | `NOT_CONFIGURED` | `NOT_AVAILABLE` | `NOT_APPLICABLE`
- Stages are computed dynamically by `itemLifecycle(item, onlineOptional)`

### 8. API Endpoints (in `server/routes/workspace.ts`)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workspace/marketplace` | GET | Full marketplace catalog |
| `/api/workspace/projects/:id/marketplace` | GET | Project-aware marketplace with compatibility |
| `/api/workspace/marketplace/items/:id/install-preview` | GET | Install readiness check |

### 9. Client-Side: OnlineHubPanel (`client/pages/KForgeWorkspace.tsx`)
- Single component handles: Marketplace, Extensions, Model Hub, Agent Marketplace, Tool Marketplace, Integrations, Providers, Installed, Updates, Security Center, Remote Sources, Downloads, Activity
- State-driven views via `initialView` prop
- Detail panel shows: metadata, permissions, lifecycle stages, project compatibility flow
- Actions: Inspect, Install (Ollama models), Activate, Remove

---

## What Is Metadata-Only (No Real Backend Action)

| Feature | Current State | Missing Backend |
|---------|---------------|-----------------|
| **Extension install** | `installAction: "INSTALL_REQUIRES_CONFIRMATION"` returned for Ollama models only | No actual download/verify/install for extensions |
| **Extension update** | `updateState: "NOT_CONFIGURED"` for all non-model items | No version comparison adapter |
| **Extension uninstall** | `uninstall: "BLOCKED"` for non-model items | No extension removal adapter |
| **Remote catalog refresh** | Adapters show `NOT_CONFIGURED` | No HTTP catalog fetch implementation |
| **Integrity verification** | `integrity: NOT_AVAILABLE` for all items | No SHA-256 / signature verification |
| **Provenance chain** | `provenance: UNKNOWN` for remote items | No supply chain tracking |

---

## What Is Real (Working End-to-End)

1. **Local model install/uninstall** (Ollama):
   - Uses existing `aiCenter.installOllamaModel` / `deleteOllamaModel`
   - Verified via runtime inventory refresh
   - `installAction: "INSTALL_REQUIRES_CONFIRMATION"` only when `onlineOptional && model.compatible`

2. **Built-in agents/tools**: 
   - Always `installed: true`, `installAction: "MANAGE_LOCAL"`
   - Lifecycle stages correctly show `VERIFIED` for built-in items
   - Project compatibility computed from detected project commands

3. **Local registry read**:
   - Reads `.kforge/marketplace-registry.json` 
   - Validates items via `registeredItem()`
   - Trust evaluation: remote items forced to `UNTRUSTED`

4. **Project compatibility flow**:
   - Complete 9-stage Agent→Marketplace evidence flow
   - Returns `COMPATIBLE` / `INCOMPATIBLE` / `UNKNOWN`
   - Capability gaps reported with full lifecycle evidence

---

## What Is Missing (Real Implementation Gaps)

### 1. No Extension Package Lifecycle
- **No download adapter** for extension packages (zip/tar)
- **No integrity verification** (SHA-256, signature)
- **No staging/install** to local filesystem
- **No registration** in persistent store after install
- **No health check** after install
- **No rollback** on failure

### 2. No First-Party Package Registry
- No curated first-party packages exist
- No package manifest schema for first-party packages
- No publish/release pipeline for first-party packages

### 3. No Remote Catalog Adapter
- `ollama-official` and `extension-registries` are metadata-only
- No HTTP fetch implementation for live catalogs
- No ETag/caching for catalog responses

### 4. No Package Safety Tests
- No tests for: bad SHA, wrong size, path traversal, malformed manifest, unknown permission, incompatible version, dependency failure, install failure, health failure

### 5. Install State Not Durable (for extensions)
- Only Ollama models persist via runtime inventory
- Extension installs would be in-memory only (no `.kforge` persistence)

---

## Where Install Adapters Live

| Adapter | Location | Status |
|---------|----------|--------|
| Ollama model install | `server/services/aiCenter.ts` → `installOllamaModel()` | ✅ Working |
| Ollama model remove | `server/services/aiCenter.ts` → `deleteOllamaModel()` | ✅ Working |
| Extension package install | **MISSING** | ❌ Not implemented |
| Extension package update | **MISSING** | ❌ Not implemented |
| Extension package uninstall | **MISSING** | ❌ Not implemented |

---

## Where Integrity Verification Belongs

- **Should be**: In a new `server/services/packageIntegrity.ts` or extended `marketplace.ts`
- **Must verify**: SHA-256 checksum, package size, archive traversal safety, manifest validation
- **Must run**: After download, before staging, before install claim

---

## Where Local Package State Belongs

- **Current**: `.kforge/marketplace-registry.json` (read-only for registered items)
- **Should extend**: Same file or `.kforge/installed-packages.json` for installed extensions
- **Must survive**: Process restart, server rebuild
- **Must track**: Package ID, version, install path, permissions granted, install timestamp, health status

---

## Next Implementation Steps (Per Requirements)

1. **Add Playwright E2E** (tests/e2e/ + playwright.config.ts)
2. **Extend existing Marketplace** for first-party package lifecycle:
   - Add package manifest schema
   - Add download/verify/stage/install/register flow
   - Add install state persistence
   - Add update/uninstall adapters
3. **Create ONE first-party package** (e.g., "KForge README Auditor")
4. **Add safety tests** for malicious packages
5. **Run full release verification**