import express from "express";
import { rateLimit } from "express-rate-limit";
import marketplaceLifecycleRouter from "./routes/marketplaceLifecycle";
import operationEvidenceRouter from "./routes/operationEvidence";
import productTruthRouter from "./routes/productTruth";
import providerCommandRouter from "./routes/providerCommandRouter";
import remoteSourcesRouter from "./routes/remoteSources";
import workspaceRouter from "./routes/workspace";

const PROVIDER_STORAGE_ROUTE_PREFIX = "/api/workspace/ai/command-center/";
const SAFE_PROVIDER_STORAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const LOOPBACK_API_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export interface CreateServerOptions {
  enforceLoopbackHostHeader?: boolean;
  requestAllowancePerMinute?: number;
}

/**
 * The loopback API is reachable by every local process and by browser pages, so
 * request volume is bounded per client address. The ceiling is deliberately far
 * above interactive workbench and end-to-end traffic: it exists to stop a
 * runaway or hostile local caller, not to shape normal product behaviour.
 */
function localRequestAllowance(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "KForge local runtime request allowance exceeded. Retry shortly.", code: "KFORGE_RATE_LIMITED" },
  });
}


function parseAuthorityHost(value: string): string | null {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Loopback API callers are only the packaged workbench origin. A browser page on
 * another site can still send loopback "simple" requests whose response it
 * cannot read, and a rebound DNS name can make such a page same-origin with
 * this API. Both shapes are refused here so no workspace, provider, marketplace
 * or remote-source route depends on browser-enforced origin alone.
 */
function rejectUntrustedLocalCaller({ enforceLoopbackHostHeader }: CreateServerOptions) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith("/api/")) return next();

    const host = (req.get("host") || "").trim();
    const hostname = host ? parseAuthorityHost(host) : null;
    if (enforceLoopbackHostHeader && (!hostname || !LOOPBACK_API_HOSTNAMES.has(hostname))) {
      return res.status(403).json({ error: "KForge API requests require a loopback Host header.", code: "KFORGE_HOST_REJECTED" });
    }

    if ((req.get("sec-fetch-site") || "").toLowerCase() === "cross-site") {
      return res.status(403).json({ error: "Cross-site browser requests cannot reach the KForge API.", code: "KFORGE_CROSS_SITE_REJECTED" });
    }

    const origin = req.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = null;
      }
      if (!originHost || !host || originHost !== host.toLowerCase()) {
        return res.status(403).json({ error: "Cross-origin browser requests cannot reach the KForge API.", code: "KFORGE_CROSS_ORIGIN_REJECTED" });
      }
    }

    return next();
  };
}

function rejectUnsafeProviderStorageIdentifiers(req: express.Request, res: express.Response, next: express.NextFunction) {
  const rawPath = req.originalUrl.split("?", 1)[0] || "";
  if (!rawPath.startsWith(PROVIDER_STORAGE_ROUTE_PREFIX)) return next();

  const segments = rawPath.split("/").filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== "providers" && segments[index] !== "sessions") continue;
    const rawId = segments[index + 1];
    let decodedId: string;
    try {
      decodedId = decodeURIComponent(rawId);
    } catch {
      return res.status(400).json({ error: "Invalid provider command identifier." });
    }
    if (!SAFE_PROVIDER_STORAGE_ID.test(decodedId) || decodedId === "." || decodedId === ".." || decodedId.includes("..")) {
      return res.status(400).json({ error: "Invalid provider command identifier." });
    }
  }

  return next();
}

export function createServer(options: CreateServerOptions = {}) {
  const app = express();

  // Loopback-first desktop runtime: disable fingerprinting, bound body sizes,
  // normalize malformed-JSON errors without leaking stacks. HSTS/CSP-at-edge
  // are intentionally not applied here: this API is served over loopback HTTP
  // by the packaged Electron shell (which applies its own CSP frame policy),
  // so internet-edge headers would be security decoration, not a boundary.
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in (error as unknown as Record<string, unknown>)) {
      return res.status(400).json({ error: "Malformed JSON body." });
    }
    return next(error);
  });

  // Local-caller boundary: the packaged runtime only ever serves its own
  // workbench origin, so browser cross-site and rebound-host callers are
  // refused before any route can observe or mutate workspace truth.
  app.use(rejectUntrustedLocalCaller(options));
  app.use(localRequestAllowance(options.requestAllowancePerMinute ?? 5_000));

  app.get("/api/ping", (_req, res) => {
    res.json({ message: "KForge server is online." });
  });

  // Provider/session identifiers are later reused as local .kforge storage keys.
  // Reject traversal/path-separator payloads at the HTTP boundary before any
  // provider-command service can derive a filesystem path from route input.
  app.use(rejectUnsafeProviderStorageIdentifiers);

  // Marketplace lifecycle mutations reuse the canonical Marketplace service.
  // The router intentionally defines no root GET route, so the existing
  // /api/workspace/marketplace catalog remains owned by workspaceRouter.
  app.use("/api/workspace/marketplace", marketplaceLifecycleRouter);
  // Product-truth hardening routes are narrow overlays that reuse the canonical
  // workspace engines and persist only explicit local evidence/authority state.
  app.use("/api/workspace", productTruthRouter);
  // Execution-evidence overlay observes only the canonical workspace action
  // response and persists its already-computed transparency contract. It never
  // executes a project action or changes the workspace authority decision.
  app.use("/api/workspace", operationEvidenceRouter);
  // Provider Command Center Phase 2 owns only the /ai/command-center subtree.
  // It is mounted before the historical workspace endpoints so upgraded secure
  // vault/session routes take ownership without duplicating core project engines.
  app.use("/api/workspace", providerCommandRouter);
  // Explicit remote-source reads (MCP Registry first). Every endpoint is an
  // explicit user action: opening Online never calls these, OFFLINE refuses
  // before any socket opens, and results normalize onto Marketplace evidence.
  app.use("/api/workspace", remoteSourcesRouter);
  app.use("/api/workspace", workspaceRouter);

  return app;
}
