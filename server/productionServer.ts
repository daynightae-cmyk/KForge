import { existsSync } from "fs";
import { createServer as createHttpServer, type Server } from "http";
import path from "path";
import express from "express";
import { createServer } from "./index";
import { stopAllPreviews } from "./services/previewRuntime";
import { stopAllTopologies } from "./services/topologyRuntime";

export interface KForgeProductionServerOptions {
  applicationRoot: string;
  host?: string;
  port?: number;
}

export interface KForgeProductionServer {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

function assertBundledResources(applicationRoot: string) {
  const required = [
    path.join(applicationRoot, "fixtures", "marketplace-first-party", "manifest.json"),
    path.join(applicationRoot, "fixtures", "marketplace-first-party-v110", "manifest.json"),
    path.join(applicationRoot, "dist", "spa", "index.html"),
  ];
  const missing = required.filter((target) => !existsSync(target));
  if (missing.length) throw new Error(`KForge bundled resources are missing: ${missing.join(", ")}`);
}

function closeHttpServer(server: Server) {
  // A loaded renderer can keep loopback HTTP sockets alive while the desktop
  // window is closing. Close idle and active connections first so shutdown
  // does not leave the product waiting on its own renderer.
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startKForgeProductionServer({
  applicationRoot,
  host = "127.0.0.1",
  port = 0,
}: KForgeProductionServerOptions): Promise<KForgeProductionServer> {
  const resolvedRoot = path.resolve(applicationRoot);
  assertBundledResources(resolvedRoot);

  // Canonical workspace services resolve their state root from this process context.
  // Desktop startup sets KFORGE_WORKSPACE_ROOT before this module is imported.
  // Do not change process.cwd(): KForge can host a selected project independently
  // of its installed resources and other local tasks may share this process.
  process.env.KFORGE_APP_ROOT = resolvedRoot;

  const app = createServer();
  const distPath = path.join(resolvedRoot, "dist", "spa");
  app.disable("x-powered-by");
  app.use(express.static(distPath));
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
      return res.status(404).json({ error: "API endpoint not found" });
    }
    return res.sendFile(path.join(distPath, "index.html"));
  });

  const server = createHttpServer(app);
  const address = await new Promise<{ host: string; port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const value = server.address();
      if (!value || typeof value === "string") {
        reject(new Error("KForge production server did not provide a TCP address."));
        return;
      }
      resolve({ host: value.address === "::" ? host : value.address, port: value.port });
    });
  });

  let closed = false;
  return {
    host: address.host,
    port: address.port,
    url: `http://${address.host}:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all([stopAllPreviews(), stopAllTopologies()]);
      await closeHttpServer(server);
    },
  };
}
