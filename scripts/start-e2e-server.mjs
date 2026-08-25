import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const bundledNpmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCli = process.env.npm_execpath || bundledNpmCli;
const e2eWorkspaceRoot = process.env.KFORGE_WORKSPACE_ROOT || path.join(os.tmpdir(), "kforge-e2e-workspace");
const useDirectNodeNpm = process.platform === "win32" && fs.existsSync(npmCli);
const command = useDirectNodeNpm ? process.execPath : npmExecutable;
const args = useDirectNodeNpm ? [npmCli, "run", "start"] : ["run", "start"];

const child = spawn(command, args, {
  env: { ...process.env, PORT: "4317", KFORGE_WORKSPACE_ROOT: e2eWorkspaceRoot },
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
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
