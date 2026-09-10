import express from "express";
import marketplaceLifecycleRouter from "./routes/marketplaceLifecycle";
import operationEvidenceRouter from "./routes/operationEvidence";
import productTruthRouter from "./routes/productTruth";
import providerCommandRouter from "./routes/providerCommandRouter";
import workspaceRouter from "./routes/workspace";

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
