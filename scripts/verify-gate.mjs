import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const startedAt = new Date().toISOString();
const installPlaywright = process.env.KFORGE_INSTALL_PLAYWRIGHT === "1";
const requestedEvidencePath = process.env.KFORGE_VERIFICATION_EVIDENCE_PATH?.trim();
const evidence = {
  schemaVersion: 2,
  source: "KForge verification gate",
  platform: process.platform,
  node: process.version,
  testedSha: process.env.KFORGE_TESTED_SHA || null,
  event: process.env.GITHUB_EVENT_NAME || null,
  runId: process.env.GITHUB_RUN_ID || null,
  startedAt,
  finishedAt: null,
  gate: "RUNNING",
  steps: [],
};

function resolveLocalExecutable(command, args) {
  if (process.platform !== "win32" || !["npm", "npx"].includes(command)) return { command, args };
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const cliDirectory = path.dirname(npmCli);
  const cli = command === "npm" ? npmCli : path.join(cliDirectory, "npx-cli.js");
  return { command: process.execPath, args: [cli, ...args] };
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
    const resolved = resolveLocalExecutable(command, args);

    const child = spawn(resolved.command, resolved.args, {
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

await runStep("workflow-pins", process.execPath, ["scripts/verify-workflow-pins.mjs"]);
const installOk = await runStep("npm-ci", "npm", ["ci"]);

if (installOk) {
  await runStep("typecheck", "npm", ["run", "typecheck"]);
  await runStep("lint", "npm", ["run", "lint"]);
  await runStep("tests", "npm", ["run", "test"]);
  const buildOk = await runStep("build", "npm", ["run", "build"]);

  if (buildOk) {
    let browserOk = true;
    if (installPlaywright) {
      browserOk = await runStep("playwright-browser", "npx", ["playwright", "install", "--with-deps", "chromium"]);
    } else {
      skipStep("playwright-browser", "npx playwright install --with-deps chromium", "Browser installation was not requested; the local environment must already provide the configured Playwright browser.");
    }

    if (browserOk) {
      await runStep("e2e", "npm", ["run", "test:e2e"]);
    } else {
      skipStep("e2e", "npm run test:e2e", "Playwright browser installation failed; production E2E cannot run truthfully.");
    }
  } else {
    skipStep("playwright-browser", "npx playwright install --with-deps chromium", "Production build failed; browser setup is unnecessary.");
    skipStep("e2e", "npm run test:e2e", "Production build failed; E2E server artifact is unavailable.");
  }
} else {
  for (const [id, command] of [
    ["typecheck", "npm run typecheck"],
    ["lint", "npm run lint"],
    ["tests", "npm run test"],
    ["build", "npm run build"],
    ["playwright-browser", "npx playwright install --with-deps chromium"],
    ["e2e", "npm run test:e2e"],
  ]) {
    skipStep(id, command, "npm ci failed; dependency-backed verification cannot run truthfully.");
  }
}

const required = ["workflow-pins", "npm-ci", "typecheck", "lint", "tests", "build", "e2e"];
if (installPlaywright) required.splice(required.length - 1, 0, "playwright-browser");
const byId = new Map(evidence.steps.map((step) => [step.id, step]));
const pass = required.every((id) => byId.get(id)?.state === "PASS");
evidence.gate = pass ? "PASS" : "FAIL";
evidence.finishedAt = new Date().toISOString();

let evidencePath;
if (requestedEvidencePath) {
  evidencePath = path.resolve(process.cwd(), requestedEvidencePath);
} else {
  const evidenceDirectory = path.join(process.cwd(), "docs", "verification-evidence");
  const stamp = startedAt.replace(/[:.]/g, "-");
  evidencePath = path.join(evidenceDirectory, `local-${stamp}.json`);
}
await fs.mkdir(path.dirname(evidencePath), { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(`\nKForge verification gate: ${evidence.gate}`);
console.log(`Evidence: ${path.relative(process.cwd(), evidencePath)}`);
for (const step of evidence.steps) {
  console.log(`${step.id}: ${step.state}${step.exitCode === null ? "" : ` (exit ${step.exitCode})`}`);
}

if (!pass) process.exitCode = 1;
