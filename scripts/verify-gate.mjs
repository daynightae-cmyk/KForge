import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const startedAt = new Date().toISOString();
const evidence = {
  schemaVersion: 1,
  source: "KForge local verification gate",
  platform: process.platform,
  node: process.version,
  startedAt,
  finishedAt: null,
  gate: "RUNNING",
  steps: [],
};

function executable(command) {
  return process.platform === "win32" && ["npm", "npx"].includes(command)
    ? `${command}.cmd`
    : command;
}

async function runStep(id, command, args, options = {}) {
  const stepStarted = Date.now();
  const record = {
    id,
    command: [command, ...args].join(" "),
    state: "RUNNING",
    exitCode: null,
    durationMs: null,
  };
  evidence.steps.push(record);

  const exitCode = await new Promise((resolve) => {
    const child = spawn(executable(command), args, {
      cwd: process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    child.on("error", (error) => {
      console.error(`[verify:gate] ${id} failed to start: ${error.message}`);
      resolve(127);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

  record.exitCode = exitCode;
  record.durationMs = Date.now() - stepStarted;
  record.state = exitCode === 0 ? "PASS" : "FAIL";
  return exitCode === 0;
}

function skipStep(id, command, reason) {
  evidence.steps.push({
    id,
    command,
    state: "SKIPPED",
    exitCode: null,
    durationMs: 0,
    reason,
  });
}

const installOk = await runStep("npm-ci", "npm", ["ci"]);

if (installOk) {
  await runStep("typecheck", "npm", ["run", "typecheck"]);
  await runStep("lint", "npm", ["run", "lint"]);
  await runStep("marketplace", "npx", [
    "vitest",
    "--run",
    "server/services/marketplace.spec.ts",
    "server/routes/marketplaceLifecycle.spec.ts",
  ]);
  await runStep("tests", "npm", ["run", "test"]);
  const buildOk = await runStep("build", "npm", ["run", "build"]);
  if (buildOk) {
    await runStep("e2e", "npm", ["run", "test:e2e"]);
  } else {
    skipStep("e2e", "npm run test:e2e", "Production build failed; E2E server artifact is unavailable.");
  }
} else {
  for (const [id, command] of [
    ["typecheck", "npm run typecheck"],
    ["lint", "npm run lint"],
    ["marketplace", "npx vitest --run server/services/marketplace.spec.ts server/routes/marketplaceLifecycle.spec.ts"],
    ["tests", "npm run test"],
    ["build", "npm run build"],
    ["e2e", "npm run test:e2e"],
  ]) {
    skipStep(id, command, "npm ci failed; dependency-backed verification cannot run truthfully.");
  }
}

const required = ["npm-ci", "typecheck", "lint", "marketplace", "tests", "build", "e2e"];
const byId = new Map(evidence.steps.map((step) => [step.id, step]));
const pass = required.every((id) => byId.get(id)?.state === "PASS");
evidence.gate = pass ? "PASS" : "FAIL";
evidence.finishedAt = new Date().toISOString();

const evidenceDirectory = path.join(process.cwd(), "docs", "verification-evidence");
await fs.mkdir(evidenceDirectory, { recursive: true });
const stamp = startedAt.replace(/[:.]/g, "-");
const evidencePath = path.join(evidenceDirectory, `local-${stamp}.json`);
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(`\nKForge verification gate: ${evidence.gate}`);
console.log(`Evidence: ${path.relative(process.cwd(), evidencePath)}`);
for (const step of evidence.steps) {
  console.log(`${step.id}: ${step.state}${step.exitCode === null ? "" : ` (exit ${step.exitCode})`}`);
}

if (!pass) process.exitCode = 1;
