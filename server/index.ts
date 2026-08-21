import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import aiModelsRouter from "./routes/aiModels";
import workspaceRouter from "./routes/workspace";

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/ping", (_req, res) => {
    res.json({ message: "KForge server is online." });
  });

  app.get("/api/demo", handleDemo);
  app.use("/api/ai-models", aiModelsRouter);
  app.use("/api/workspace", workspaceRouter);

  return app;
}
