import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import aiModelsRouter from "./routes/aiModels";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    res.json({ message: "Hello from Express server v2!" });
  });

  app.get("/api/demo", handleDemo);

  // AI Models API routes
  app.use("/api/ai-models", aiModelsRouter);

  return app;
}
