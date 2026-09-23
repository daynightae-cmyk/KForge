import { Router, type Response } from "express";
import path from "path";
import { isOptionalOnlineFeatureEnabled } from "../services/localPlatform";
import { listRemoteSources } from "../services/remoteSources/registry";
import { RemoteFetchError } from "../services/remoteSources/fetchPolicy";
import { getMcpServerVersion, getMcpServerVersions, searchMcpServers } from "../services/remoteSources/mcpService";

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
  if (error instanceof Error && /MCP Registry: /.test(error.message)) return { status: 400, code: "REMOTE_SOURCE_BAD_REQUEST" };
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

export default router;
