import express from "express";
import marketplaceLifecycleRouter from "./routes/marketplaceLifecycle";
import operationEvidenceRouter from "./routes/operationEvidence";
import productTruthRouter from "./routes/productTruth";
import providerCommandRouter from "./routes/providerCommandRouter";
import workspaceRouter from "./routes/workspace";

const PROVIDER_STORAGE_ROUTE_PREFIX = "/api/workspace/ai/command-center/";
const SAFE_PROVIDER_STORAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

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

export function createServer() {
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
  app.use("/api/workspace", workspaceRouter);

  return app;
}
