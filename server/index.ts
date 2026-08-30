import express from "express";
import marketplaceLifecycleRouter from "./routes/marketplaceLifecycle";
import operationEvidenceRouter from "./routes/operationEvidence";
import productTruthRouter from "./routes/productTruth";
import workspaceRouter from "./routes/workspace";

export function createServer() {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

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
  app.use("/api/workspace", workspaceRouter);

  return app;
}
