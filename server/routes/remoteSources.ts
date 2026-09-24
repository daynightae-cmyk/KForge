import { Router, type Response } from "express";
import { promises as fs } from "fs";
import path from "path";
import { isOptionalOnlineFeatureEnabled } from "../services/localPlatform";
import { listRemoteSources } from "../services/remoteSources/registry";
import { RemoteFetchError } from "../services/remoteSources/fetchPolicy";
import { getMcpServerVersion, getMcpServerVersions, searchMcpServers } from "../services/remoteSources/mcpService";
import { getOvsxExtension, getOvsxVersion, getOvsxVersions, searchOvsxExtensions } from "../services/remoteSources/openVsxService";
import { getHfModel, searchHfModels } from "../services/remoteSources/huggingFaceService";
import type { HfSort } from "../services/remoteSources/adapters/huggingFace";
import { getKforgeRelease, getKforgeUpdateStatus, listKforgeReleases } from "../services/remoteSources/kforgeUpdatesService";
import { listAvailableDocumentation, refreshDocumentation, searchCachedDocumentation } from "../services/remoteSources/documentationService";
import { getOsvVuln, queryOsvAdvisories, queryOsvBatch } from "../services/remoteSources/osvService";
import { getModelCenter } from "../services/aiCenter";
import type { OsvPackageQuery } from "../services/remoteSources/adapters/osv";
import { getNpmPackage, getNpmVersion, searchNpmPackages } from "../services/remoteSources/npmService";
import { getPypiPackage, searchPypiPackages } from "../services/remoteSources/pypiService";

/**
 * Explicit remote-source reads (Slice 1).
 *
 * Every route here is an explicit user action: opening the Online surface
 * never touches these endpoints, and OFFLINE mode refuses before any socket
 * opens (or serves bounded cache with CACHED evidence when last-good data
 * exists). All responses carry provenance + freshness + transparency.
 */
const router = Router();

function getWorkspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 30;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("MCP Registry: limit must be an integer between 1 and 100.");
  }
  return limit;
}

function parseOvsxSize(value: unknown): number {
  if (value === undefined) return 20;
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    throw new Error("Open VSX Registry: size must be an integer between 1 and 50.");
  }
  return size;
}

function parseOvsxOffset(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw new Error("Open VSX Registry: offset must be an integer between 0 and 100000.");
  }
  return offset;
}

function parseOptionalText(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`MCP Registry: ${name} must be a string of 1-${maxLength} characters.`);
  }
  return value;
}

function errorStatus(error: unknown): { status: number; code: string; retryAfter?: number } {
  if (error instanceof RemoteFetchError) {
    switch (error.code) {
      case "OFFLINE_BLOCKED":
        return { status: 403, code: "REMOTE_SOURCE_OFFLINE_BLOCKED" };
      case "RATE_LIMITED":
        return { status: 429, code: "REMOTE_SOURCE_RATE_LIMITED", ...(error.retryAfterSeconds !== undefined ? { retryAfter: error.retryAfterSeconds } : {}) };
      case "TIMEOUT":
        return { status: 504, code: "REMOTE_SOURCE_TIMEOUT" };
      case "ORIGIN_NOT_ALLOWED":
      case "SSRF_BLOCKED":
      case "TOO_MANY_REDIRECTS":
      case "TOO_LARGE":
        return { status: 502, code: `REMOTE_SOURCE_${error.code}` };
      case "HTTP_ERROR":
        if (error.httpStatus === 404 || error.httpStatus === 400 || error.httpStatus === 403) {
          return { status: error.httpStatus, code: "REMOTE_SOURCE_NOT_FOUND" };
        }
        return { status: 502, code: "REMOTE_SOURCE_BAD_RESPONSE" };
      case "NETWORK_ERROR":
      case "ABORTED":
        return { status: 502, code: "REMOTE_SOURCE_UNREACHABLE" };
    }
  }
  if (error instanceof Error && /(MCP Registry|Open VSX Registry|OSV\.dev|Hugging Face Hub|KForge Updates|Remote Documentation|npm Registry|PyPI): /.test(error.message)) return { status: 400, code: "REMOTE_SOURCE_BAD_REQUEST" };
  return { status: 500, code: "REMOTE_SOURCE_FAILED" };
}

function sendServiceError(res: Response, error: unknown) {
  const mapped = errorStatus(error);
  const message = error instanceof Error ? error.message.slice(0, 500) : "Remote source request failed.";
  if (mapped.retryAfter !== undefined) res.setHeader("Retry-After", String(mapped.retryAfter));
  return res.status(mapped.status).json({ error: message, code: mapped.code });
}

/** Approved remote sources. LOCAL read; never contacts a provider. */
router.get("/remote-sources", async (_req, res) => {
  return res.json({
    sources: listRemoteSources(),
    transparency: {
      execution: "LOCAL",
      network: "NOT_REQUIRED",
      source: "Approved remote-source registry",
      purpose: "List approved remote metadata sources without contacting any provider.",
    },
  });
});

/** Explicit MCP catalog search. OFFLINE serves cache or refuses with 403. */
router.get("/remote-sources/mcp/servers", async (req, res) => {
  try {
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await searchMcpServers({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      search: parseOptionalText(req.query.search, "search", 200),
      cursor: parseOptionalText(req.query.cursor, "cursor", 2000),
      limit: parseLimit(req.query.limit),
      updatedSince: parseOptionalText(req.query.updated_since, "updated_since", 100),
      version: parseOptionalText(req.query.version, "version", 100),
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit MCP version-history read. Server name travels as a query value so names containing slashes stay intact. */
router.get("/remote-sources/mcp/versions", async (req, res) => {
  try {
    const server = parseOptionalText(req.query.server, "server", 200);
    if (!server) throw new Error("MCP Registry: server must be a string of 1-200 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getMcpServerVersions({ workspaceRoot: getWorkspaceRoot(), networkAllowed, serverName: server });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit MCP version-detail read. */
router.get("/remote-sources/mcp/version", async (req, res) => {
  try {
    const server = parseOptionalText(req.query.server, "server", 200);
    const version = parseOptionalText(req.query.version, "version", 100);
    if (!server) throw new Error("MCP Registry: server must be a string of 1-200 characters.");
    if (!version) throw new Error("MCP Registry: version must be a string of 1-100 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getMcpServerVersion({ workspaceRoot: getWorkspaceRoot(), networkAllowed, serverName: server, version });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit Open VSX catalog search. OFFLINE serves cache or refuses with 403. */
router.get("/remote-sources/open-vsx/search", async (req, res) => {
  try {
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await searchOvsxExtensions({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      query: parseOptionalText(req.query.query, "query", 200),
      category: parseOptionalText(req.query.category, "category", 100),
      size: parseOvsxSize(req.query.size),
      offset: parseOvsxOffset(req.query.offset),
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit Open VSX extension-detail read (latest version). */
router.get("/remote-sources/open-vsx/extension", async (req, res) => {
  try {
    const namespace = parseOptionalText(req.query.namespace, "namespace", 128);
    const extension = parseOptionalText(req.query.extension, "extension", 128);
    if (!namespace) throw new Error("Open VSX Registry: namespace must be a string of 1-128 characters.");
    if (!extension) throw new Error("Open VSX Registry: extension must be a string of 1-128 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getOvsxExtension({ workspaceRoot: getWorkspaceRoot(), networkAllowed, namespace, extension });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit Open VSX version-references read. */
router.get("/remote-sources/open-vsx/versions", async (req, res) => {
  try {
    const namespace = parseOptionalText(req.query.namespace, "namespace", 128);
    const extension = parseOptionalText(req.query.extension, "extension", 128);
    if (!namespace) throw new Error("Open VSX Registry: namespace must be a string of 1-128 characters.");
    if (!extension) throw new Error("Open VSX Registry: extension must be a string of 1-128 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getOvsxVersions({ workspaceRoot: getWorkspaceRoot(), networkAllowed, namespace, extension });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit Open VSX version-detail read. */
router.get("/remote-sources/open-vsx/version", async (req, res) => {
  try {
    const namespace = parseOptionalText(req.query.namespace, "namespace", 128);
    const extension = parseOptionalText(req.query.extension, "extension", 128);
    const version = parseOptionalText(req.query.version, "version", 100);
    if (!namespace) throw new Error("Open VSX Registry: namespace must be a string of 1-128 characters.");
    if (!extension) throw new Error("Open VSX Registry: extension must be a string of 1-128 characters.");
    if (!version) throw new Error("Open VSX Registry: version must be a string of 1-100 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getOvsxVersion({ workspaceRoot: getWorkspaceRoot(), networkAllowed, namespace, extension, version });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

function parseOsvPackage(value: unknown): OsvPackageQuery {
  if (!value || typeof value !== "object") throw new Error("OSV.dev: package must be an object with ecosystem+name, a purl, or a commit hash.");
  const record = value as Record<string, unknown>;
  const query: OsvPackageQuery = {};
  if (record.ecosystem !== undefined) {
    if (typeof record.ecosystem !== "string") throw new Error("OSV.dev: ecosystem must be a string.");
    query.ecosystem = record.ecosystem;
  }
  if (record.name !== undefined) {
    if (typeof record.name !== "string") throw new Error("OSV.dev: package name must be a string.");
    query.name = record.name;
  }
  if (record.purl !== undefined) {
    if (typeof record.purl !== "string") throw new Error("OSV.dev: purl must be a string.");
    query.purl = record.purl;
  }
  if (record.version !== undefined) {
    if (typeof record.version !== "string") throw new Error("OSV.dev: version must be a string.");
    query.version = record.version;
  }
  if (record.commit !== undefined) {
    if (typeof record.commit !== "string") throw new Error("OSV.dev: commit must be a string.");
    query.commit = record.commit;
  }
  return query;
}

/**
 * Explicit OSV package query. Observational: returns advisories with
 * affected ranges and fixed versions; never modifies dependency manifests.
 */
router.post("/remote-sources/osv/query", async (req, res) => {
  try {
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await queryOsvAdvisories({ workspaceRoot: getWorkspaceRoot(), networkAllowed, package: parseOsvPackage(req.body?.package) });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit OSV batch query (bounded). Observational only. */
router.post("/remote-sources/osv/querybatch", async (req, res) => {
  try {
    const queries = req.body?.queries;
    if (!Array.isArray(queries)) throw new Error("OSV.dev: queries must be an array of 1-25 package queries.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await queryOsvBatch({ workspaceRoot: getWorkspaceRoot(), networkAllowed, queries: queries.map(parseOsvPackage) });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit OSV vulnerability-detail read. */
router.get("/remote-sources/osv/vuln", async (req, res) => {
  try {
    const id = parseOptionalText(req.query.id, "id", 100);
    if (!id) throw new Error("OSV.dev: id must be a string of 1-100 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getOsvVuln({ workspaceRoot: getWorkspaceRoot(), networkAllowed, id });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

const HF_SORTS: HfSort[] = ["lastModified", "likes", "downloads"];

/**
 * Best-effort local inventory for separate LOCAL evidence on Hub catalog
 * records. Never throws: when the runtime cannot be consulted, catalog
 * reads proceed with NOT_CHECKED local evidence.
 */
async function resolveLocalModelNames(workspaceRoot: string): Promise<string[] | undefined> {
  try {
    const center = await getModelCenter(workspaceRoot);
    const names = new Set<string>();
    for (const model of center.ollama?.models || []) {
      if (model.id) names.add(model.id);
      if (model.name) names.add(model.name);
    }
    for (const provider of center.providers || []) {
      if (provider.kind !== "local") continue;
      for (const model of provider.models || []) {
        if (model.id) names.add(model.id);
        if (model.name) names.add(model.name);
      }
    }
    return [...names];
  } catch {
    return undefined;
  }
}

/** Explicit Hugging Face catalog search. CATALOG_ONLY; never install truth. */
router.get("/remote-sources/huggingface/models", async (req, res) => {
  try {
    const sort = parseOptionalText(req.query.sort, "sort", 20);
    if (sort !== undefined && !(HF_SORTS as string[]).includes(sort)) {
      throw new Error("Hugging Face Hub: sort must be lastModified, likes, or downloads.");
    }
    const direction = req.query.direction === undefined ? undefined : Number(req.query.direction);
    if (direction !== undefined && direction !== -1 && direction !== 1) {
      throw new Error("Hugging Face Hub: direction must be -1 or 1.");
    }
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Hugging Face Hub: limit must be an integer between 1 and 100.");
    }
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await searchHfModels({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      search: parseOptionalText(req.query.search, "search", 200),
      author: parseOptionalText(req.query.author, "author", 100),
      filter: parseOptionalText(req.query.filter, "filter", 200),
      ...(sort ? { sort: sort as HfSort } : {}),
      ...(direction !== undefined ? { direction: direction as -1 | 1 } : {}),
      limit,
      cursor: parseOptionalText(req.query.cursor, "cursor", 2000),
      // Local inventory is consulted only when a provider read may proceed:
      // refusing OFFLINE callers must not trigger even loopback probes.
      localModelNames: networkAllowed ? await resolveLocalModelNames(getWorkspaceRoot()) : undefined,
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit Hugging Face model-detail read. CATALOG_ONLY; never install truth. */
router.get("/remote-sources/huggingface/model", async (req, res) => {
  try {
    const id = parseOptionalText(req.query.id, "id", 401);
    if (!id) throw new Error("Hugging Face Hub: id must be a namespace/name string.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getHfModel({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      id,
      localModelNames: networkAllowed ? await resolveLocalModelNames(getWorkspaceRoot()) : undefined,
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

function parseUpdatePaging(value: unknown, name: "per_page" | "page", min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`KForge Updates: ${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

/**
 * Best-effort installed version for update comparison. Reads the shipped
 * package.json; falls back to UNKNOWN (availability NOT evaluated) rather
 * than inventing a version.
 */
async function resolveInstalledVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // Fall through to UNKNOWN below.
  }
  return "UNKNOWN";
}

/** Explicit KForge release-list read. Catalog facts only; never install authorization. */
router.get("/remote-sources/kforge-updates/releases", async (req, res) => {
  try {
    const channel = parseOptionalText(req.query.channel, "channel", 20);
    if (channel !== undefined && !["stable", "prerelease", "all"].includes(channel)) {
      throw new Error("KForge Updates: channel must be stable, prerelease, or all.");
    }
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await listKforgeReleases({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      perPage: parseUpdatePaging(req.query.per_page, "per_page", 1, 100, 30),
      page: parseUpdatePaging(req.query.page, "page", 1, 1000, 1),
      ...(channel ? { channel: channel as "stable" | "prerelease" | "all" } : {}),
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit KForge release-detail read by tag. */
router.get("/remote-sources/kforge-updates/release", async (req, res) => {
  try {
    const tag = parseOptionalText(req.query.tag, "tag", 128);
    if (!tag) throw new Error("KForge Updates: tag must be a string of 1-128 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getKforgeRelease({ workspaceRoot: getWorkspaceRoot(), networkAllowed, tag });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit KForge update check vs the installed version. Availability is a catalog fact; trusted install stays blocked. */
router.get("/remote-sources/kforge-updates/status", async (req, res) => {
  try {
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getKforgeUpdateStatus({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      currentVersion: await resolveInstalledVersion(),
      perPage: parseUpdatePaging(req.query.per_page, "per_page", 1, 100, 30),
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

function parseDocumentationSourceId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    throw new Error("Remote Documentation: sourceId must be a string of 1-64 characters.");
  }
  return value;
}

/** Approved documentation sources. LOCAL read; never contacts a provider. */
router.get("/remote-sources/documentation/sources", async (_req, res) => {
  return res.json({
    sources: listAvailableDocumentation(),
    transparency: {
      execution: "LOCAL",
      network: "NOT_REQUIRED",
      source: "Allowlisted provider documentation registry",
      purpose: "List approved provider documentation sources without contacting any provider.",
    },
  });
});

/** Explicit refresh of one allowlisted provider document. OFFLINE serves cache or refuses with 403. */
router.post("/remote-sources/documentation/refresh", async (req, res) => {
  try {
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await refreshDocumentation({
      workspaceRoot: getWorkspaceRoot(),
      networkAllowed,
      sourceId: parseDocumentationSourceId(req.body?.sourceId),
    });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/**
 * Search cached provider documents. LOCAL ONLY: reads bounded cache and
 * never opens a socket. Live provider content arrives exclusively through
 * explicit per-source refresh.
 */
router.get("/remote-sources/documentation/search", async (req, res) => {
  try {
    const query = parseOptionalText(req.query.q, "q", 200);
    if (!query) throw new Error("Remote Documentation: q must be a string of 1-200 characters.");
    const result = await searchCachedDocumentation(getWorkspaceRoot(), query);
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit npm search. OFFLINE serves cache or refuses with 403. */
router.get("/remote-sources/npm/search", async (req, res) => {
  try {
    const text = parseOptionalText(req.query.text, "text", 200);
    if (!text) throw new Error("npm Registry: text must be a string of 1-200 characters.");
    const size = req.query.size === undefined ? undefined : Number(req.query.size);
    const from = req.query.from === undefined ? undefined : Number(req.query.from);
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await searchNpmPackages({ workspaceRoot: getWorkspaceRoot(), networkAllowed, text, ...(size !== undefined ? { size } : {}), ...(from !== undefined ? { from } : {}) });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit npm package detail. */
router.get("/remote-sources/npm/package", async (req, res) => {
  try {
    const name = parseOptionalText(req.query.name, "name", 214);
    if (!name) throw new Error("npm Registry: name must be a string of 1-214 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getNpmPackage({ workspaceRoot: getWorkspaceRoot(), networkAllowed, name });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit npm version detail. */
router.get("/remote-sources/npm/version", async (req, res) => {
  try {
    const name = parseOptionalText(req.query.name, "name", 214);
    const version = parseOptionalText(req.query.version, "version", 100);
    if (!name) throw new Error("npm Registry: name must be a string of 1-214 characters.");
    if (!version) throw new Error("npm Registry: version must be a string of 1-100 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getNpmVersion({ workspaceRoot: getWorkspaceRoot(), networkAllowed, name, version });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit PyPI search (exact-name lookup). */
router.get("/remote-sources/pypi/search", async (req, res) => {
  try {
    const text = parseOptionalText(req.query.text, "text", 200);
    if (!text) throw new Error("PyPI: text must be a string of 1-200 characters.");
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await searchPypiPackages({ workspaceRoot: getWorkspaceRoot(), networkAllowed, text });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

/** Explicit PyPI package detail. */
router.get("/remote-sources/pypi/package", async (req, res) => {
  try {
    const name = parseOptionalText(req.query.name, "name", 214);
    if (!name) throw new Error("PyPI: name must be a string of 1-214 characters.");
    const version = parseOptionalText(req.query.version, "version", 100);
    const networkAllowed = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
    const result = await getPypiPackage({ workspaceRoot: getWorkspaceRoot(), networkAllowed, name, ...(version ? { version } : {}) });
    return res.json(result);
  } catch (error) {
    return sendServiceError(res, error);
  }
});

export default router;
