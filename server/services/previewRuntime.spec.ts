import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "../../shared/workspace";
import { evaluatePreviewEmbedding, getPreviewStatus, inspectPreviewCapability, inspectPreviewDocument, recordPreviewBrowserConsole, startPreview, stopPreviewAndWait, waitForPreviewHealth } from "./previewRuntime";

const profileWithoutPreview = { packageManager: "npm", scripts: {} } as ProjectProfile;

describe("local Preview runtime", () => {
  it("reports an explicit idle state before a project Preview starts", () => {
    const preview = getPreviewStatus("missing-preview");
    expect(preview).toMatchObject({ projectId: "missing-preview", state: "idle", health: { ok: false } });
    expect(preview.health?.detail).toContain("No Preview process");
    expect(preview.telemetry).toMatchObject({ console: "process-stdout-stderr", network: "loopback-health-probe-only", browserConsoleCaptured: false });
  });

  it("refuses to fabricate a Preview when no detected preview, dev, or start script exists", async () => {
    const preview = await startPreview("missing-command-preview", process.cwd(), profileWithoutPreview);
    expect(preview).toMatchObject({ state: "unavailable", error: "PREVIEW_COMMAND_UNAVAILABLE", health: { ok: false } });
  });

  it("keeps document QA unavailable until a healthy canonical session exists", async () => {
    const inspection = await inspectPreviewDocument("missing-inspection-preview", "/");
    expect(inspection).toMatchObject({ state: "UNAVAILABLE", source: "none", findings: [] });
    expect(inspection.error).toContain("healthy canonical Preview session");
    expect(inspection.limitations.join(" ")).toContain("does not execute application JavaScript");
  });

  it("describes detected Preview eligibility without allocating a fake fixed port", () => {
    const capability = inspectPreviewCapability({
      packageManager: "npm",
      scripts: { dev: "vite" },
    } as unknown as ProjectProfile);
    expect(capability).toMatchObject({
      available: true,
      source: "package.json#scripts.dev",
      command: "npm run dev -- --port <allocated>",
    });
    expect(inspectPreviewCapability(profileWithoutPreview)).toMatchObject({ available: false, reason: expect.stringContaining("UNAVAILABLE") });
  });

  it("keeps iframe eligibility conservative for response framing policies", () => {
    expect(evaluatePreviewEmbedding(new Headers())).toMatchObject({ state: "ALLOWED" });
    expect(evaluatePreviewEmbedding(new Headers({ "x-frame-options": "DENY" }))).toMatchObject({ state: "BLOCKED" });
    expect(evaluatePreviewEmbedding(new Headers({ "x-frame-options": "SAMEORIGIN" }))).toMatchObject({ state: "BLOCKED" });
    expect(evaluatePreviewEmbedding(new Headers({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }))).toMatchObject({ state: "BLOCKED" });
    expect(evaluatePreviewEmbedding(new Headers({ "content-security-policy": "frame-ancestors http://127.0.0.1:*" }))).toMatchObject({ state: "ALLOWED" });
    const explicitAllowlist = evaluatePreviewEmbedding(new Headers({ "content-security-policy": "frame-ancestors https://example.com" }));
    expect(explicitAllowlist).toMatchObject({ state: "UNKNOWN" });
    expect(explicitAllowlist.reason).toContain("cannot prove");
  });

  it("records only attributed packaged-Electron browser console evidence with sensitive values redacted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-preview-console-"));
    const projectId = `preview-console-${Date.now()}-${Math.random()}`;
    const profile = { packageManager: "npm", scripts: { dev: "node server.cjs" } } as unknown as ProjectProfile;
    try {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { dev: "node server.cjs" } }), "utf8");
      await fs.writeFile(path.join(root, "server.cjs"), "require('node:http').createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><html lang=\"en\"><head><title>Fixture</title><meta name=\"viewport\" content=\"width=device-width\"></head><body>ok</body></html>')}).listen(Number(process.env.PORT),'127.0.0.1'); setInterval(()=>{},1000);", "utf8");
      await startPreview(projectId, root, profile);
      const healthy = await waitForPreviewHealth(projectId, 15_000, 200);
      expect(healthy.health?.ok).toBe(true);
      expect(healthy.url).toBeTruthy();

      const sourceUrl = new URL("/token/path-secret/assets/app.js?token=query-secret", healthy.url!).toString();
      expect(recordPreviewBrowserConsole({
        sourceUrl,
        level: "warning",
        message: "token=secret-value password:super-secret Bearer abc123",
        lineNumber: 42,
      })).toBe(true);
      expect(recordPreviewBrowserConsole({ sourceUrl: "http://127.0.0.1:1/unrelated.js", level: "error", message: "must not attach" })).toBe(false);

      const captured = getPreviewStatus(projectId);
      const joined = captured.logs.join("\n");
      expect(captured.telemetry).toMatchObject({ console: "process-stdout-stderr+electron-browser-console", browserConsoleCaptured: true });
      expect(joined).toContain("[browser:warning]");
      expect(joined).toContain("[REDACTED]");
      expect(joined).not.toContain("secret-value");
      expect(joined).not.toContain("super-secret");
      expect(joined).not.toContain("abc123");
      expect(joined).not.toContain("path-secret");
      expect(joined).not.toContain("query-secret");
      expect(joined).not.toContain("must not attach");
    } finally {
      await stopPreviewAndWait(projectId).catch(() => undefined);
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
