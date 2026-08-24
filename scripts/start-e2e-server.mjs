import { spawn } from "child_process";

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmExecutable, ["run", "start"], {
  env: { ...process.env, PORT: "4317" },
  stdio: "inherit",
  windowsHide: true,
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
