import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const bundledNpmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCli = process.env.npm_execpath || bundledNpmCli;
const e2eWorkspaceRoot = process.env.KFORGE_WORKSPACE_ROOT
  || path.join(os.tmpdir(), `kforge-e2e-workspace-${process.pid}-${Date.now()}`);
// Every run owns a fresh workspace. A shared directory let project, trust,
// task, and evidence records accumulate across runs, so the suite became
// dependent on its own history and the growing project list changed the
// workbench layout under test.
fs.mkdirSync(e2eWorkspaceRoot, { recursive: true });
// The release gate can rebuild this repository while the suite is running.
// Serving a snapshot keeps the shell the renderer loads intact even when the
// in-flight project build empties dist/spa.
const spaSnapshotRoot = process.env.KFORGE_SPA_DIST
  || path.join(os.tmpdir(), `kforge-e2e-spa-${process.pid}-${Date.now()}`);
if (!process.env.KFORGE_SPA_DIST) {
  fs.mkdirSync(spaSnapshotRoot, { recursive: true });
  fs.cpSync(path.join(process.cwd(), "dist", "spa"), spaSnapshotRoot, { recursive: true });
}
const useDirectNodeNpm = process.platform === "win32" && fs.existsSync(npmCli);
const command = useDirectNodeNpm ? process.execPath : npmExecutable;
const args = useDirectNodeNpm ? [npmCli, "run", "start"] : ["run", "start"];

const cleanupTempPath = (target) => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // A leftover temporary path must never fail the test run.
  }
};

const cleanupWorkspace = () => {
  if (!process.env.KFORGE_WORKSPACE_ROOT) cleanupTempPath(e2eWorkspaceRoot);
  if (!process.env.KFORGE_SPA_DIST) cleanupTempPath(spaSnapshotRoot);
};
process.on("exit", cleanupWorkspace);

const child = spawn(command, args, {
  env: { ...process.env, PORT: "4317", KFORGE_WORKSPACE_ROOT: e2eWorkspaceRoot, KFORGE_SPA_DIST: spaSnapshotRoot },
  stdio: "inherit",
  windowsHide: true,
  shell: false,
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

child.on("error", (error) => {
  console.error(`KForge E2E server failed to start: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  cleanupWorkspace();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
