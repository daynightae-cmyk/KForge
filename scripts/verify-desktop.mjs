import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const root = path.resolve(process.cwd());
const electronCli = path.join(root, "node_modules", "electron", "cli.js");
const releaseEvidenceDirectory = path.join(root, "release", "verification");
const smokeDataRoot = mkdtempSync(path.join(os.tmpdir(), "kforge-desktop-verify-"));
const logFile = path.join(smokeDataRoot, "KNOuX Forge", "logs", "desktop.log");
const startedAt = new Date().toISOString();

function fail(message) {
  throw new Error(`Desktop verification failed: ${message}`);
}

if (!existsSync(electronCli)) fail("Electron CLI is not installed. Run npm ci before npm run verify:desktop.");
if (!existsSync(path.join(root, "dist", "server", "productionServer.mjs"))) fail("Production server bundle is missing. Run npm run build first.");
if (!existsSync(path.join(root, "dist", "spa", "index.html"))) fail("Production SPA bundle is missing. Run npm run build first.");

const child = spawnSync(process.execPath, [electronCli, root], {
  cwd: root,
  env: {
    ...process.env,
    LOCALAPPDATA: smokeDataRoot,
    KFORGE_DESKTOP_SMOKE: "1",
    KFORGE_DESKTOP_SMOKE_DELAY_MS: "2500",
  },
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 120_000,
});

try {
  if (child.error) fail(child.error.message);
  if (child.status !== 0) fail(`Electron exited with ${child.status ?? "unknown"}: ${(child.stderr || child.stdout || "").trim()}`);
  if (!existsSync(logFile)) fail("Desktop log was not created under the temporary local app-data root.");

  const log = readFileSync(logFile, "utf8");
  const loopback = log.match(/Loopback engine is ready at (http:\/\/127\.0\.0\.1:\d+)\./);
  if (!log.includes("Starting KNOuX Forge")) fail("Runtime startup metadata was not logged.");
  if (!loopback) fail("Runtime did not bind an allocated 127.0.0.1 loopback URL.");
  if (!log.includes("KNOuX Forge window loaded.")) fail("Electron window did not load the production workspace.");
  if (!log.includes("KNOuX Forge shutdown requested.")) fail("Controlled shutdown was not requested.");
  if (!log.includes("Loopback engine and managed Preview processes stopped.")) fail("Managed loopback and Preview cleanup was not logged.");

  const evidence = {
    verifiedAt: new Date().toISOString(),
    startedAt,
    runtime: "Electron development smoke over built production resources",
    appRoot: root,
    resourceResolution: "dist/server/productionServer.mjs and dist/spa/index.html present",
    loopbackUrl: loopback[1],
    startup: "PASS",
    windowLoad: "PASS",
    safeShutdown: "PASS",
    sourceIndependentInstalledRuntime: "NOT_TESTED_BY_THIS_GATE",
    shellExecution: false,
  };
  mkdirSync(releaseEvidenceDirectory, { recursive: true });
  writeFileSync(path.join(releaseEvidenceDirectory, "desktop-verification.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Desktop verification passed. Loopback: ${loopback[1]}`);
} finally {
  rmSync(smokeDataRoot, { recursive: true, force: true });
}
