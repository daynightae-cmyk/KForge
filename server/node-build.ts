import path from "path";
import express from "express";
import { createServer } from "./index";

const app = createServer();
const port = Number(process.env.PORT || 3000);
const distPath = path.join(import.meta.dirname, "../spa");

app.use(express.static(distPath));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`KForge Workspace running at http://localhost:${port}`);
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
