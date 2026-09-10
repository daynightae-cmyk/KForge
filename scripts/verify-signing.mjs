// Verifies a Windows artifact's Authenticode state and emits artifact-based evidence.
// Usage: node scripts/verify-signing.mjs <artifact-path> [--require-valid] [--json <out-path>]
// Distinguishes build signing material from observed artifact signature.
// Exit code 0 when the requested policy passes; 1 when --require-valid fails.
import { execFileSync } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import process from "process";
import { resolveReleaseStateFromEnv, trustedReleaseBlocker } from "./release-state.mjs";

const [, , artifactArg, ...rest] = process.argv;

function fail(message) {
  console.error(`Signing verification: FAIL — ${message}`);
  process.exit(1);
}

if (!artifactArg) fail("Provide an artifact path: node scripts/verify-signing.mjs <artifact-path>.");
const artifactPath = path.resolve(artifactArg);
if (!existsSync(artifactPath)) fail(`Artifact was not found: ${artifactPath}`);

const requireValid = rest.includes("--require-valid");
const jsonIndex = rest.indexOf("--json");
const jsonOut = jsonIndex >= 0 ? path.resolve(rest[jsonIndex + 1] || "") : null;
if (jsonIndex >= 0 && !rest[jsonIndex + 1]) fail("Provide an output path after --json.");

const releaseState = resolveReleaseStateFromEnv(process.env);

function normalizeObserved(rawStatus, inspected) {
  if (!inspected) return "UNAVAILABLE";
  const normalized = String(rawStatus || "").trim().toLowerCase();
  if (normalized === "valid") return "VALID";
  if (normalized === "notsigned" || normalized === "unsigned" || normalized === "unknownerror") return "UNSIGNED";
  if (!normalized || normalized === "unknown") return "UNKNOWN";
  return "INVALID";
}

function queryWindowsSignature(target) {
  const script = [
    "$cmd = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue",
    "if ($null -eq $cmd) { try { Import-Module Microsoft.PowerShell.Security -ErrorAction Stop } catch { } }",
    "$cmd = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue",
    "if ($null -eq $cmd) { @{ status = 'UNAVAILABLE'; subject = $null; issuer = $null; thumbprint = $null; timestamped = $false } | ConvertTo-Json -Depth 4 -Compress }",
    "else {",
    "$sig = Get-AuthenticodeSignature -LiteralPath $env:KFORGE_VERIFY_SIGNING_TARGET",
    "if ($null -eq $sig) { @{ status = 'UNAVAILABLE'; subject = $null; issuer = $null; thumbprint = $null; timestamped = $false } | ConvertTo-Json -Depth 4 -Compress }",
    "else {",
    "$signer = $null",
    "if ($sig.SignerCertificate) { $signer = $sig.SignerCertificate }",
    "$out = [ordered]@{",
    "  status = $sig.Status.ToString()",
    "  statusValue = [int]$sig.Status",
    "  subject = if ($signer) { $signer.Subject } else { $null }",
    "  issuer = if ($signer) { $signer.Issuer } else { $null }",
    "  thumbprint = if ($signer) { $signer.Thumbprint } else { $null }",
    "  timestamped = $null -ne $sig.TimeStamperCertificate",
    "}",
    "$out | ConvertTo-Json -Depth 4 -Compress } }",
  ].join("\n");
  try {
    const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, KFORGE_VERIFY_SIGNING_TARGET: target },
    }).trim();
    return JSON.parse(output);
  } catch (error) {
    fail(`Get-AuthenticodeSignature failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let evidence;
if (process.platform === "win32") {
  const observed = queryWindowsSignature(artifactPath);
  const observedStatus = normalizeObserved(observed.status, true);
  evidence = {
    artifact: path.basename(artifactPath),
    buildSigningConfigured: releaseState.signingConfigured,
    observedSignature: {
      inspected: true,
      status: observedStatus,
      ...(observed.subject ? { subject: observed.subject } : {}),
      ...(observed.issuer ? { issuer: observed.issuer } : {}),
      ...(observed.thumbprint ? { thumbprint: observed.thumbprint } : {}),
      timestamped: observed.timestamped === true,
    },
    signing: {
      configured: releaseState.signingConfigured,
      status: observedStatus,
      ...(observed.subject ? { subject: observed.subject } : {}),
      ...(observed.issuer ? { issuer: observed.issuer } : {}),
      timestamped: observed.timestamped === true,
      ...(observed.thumbprint ? { thumbprint: observed.thumbprint } : {}),
    },
    releaseMode: releaseState.mode,
    trustStatus: observedStatus === "VALID" && releaseState.signingConfigured ? "TRUSTED_RELEASE_CANDIDATE" : "DEVELOPMENT_ARTIFACT",
    trustDecision: observedStatus === "VALID" ? "ARTIFACT_SIGNED_VALID" : "ARTIFACT_NOT_VALID_SIGNED",
  };
} else {
  evidence = {
    artifact: path.basename(artifactPath),
    buildSigningConfigured: releaseState.signingConfigured,
    observedSignature: {
      inspected: false,
      status: "UNAVAILABLE",
    },
    signing: {
      configured: releaseState.signingConfigured,
      status: "UNAVAILABLE",
    },
    releaseMode: releaseState.mode,
    trustStatus: "DEVELOPMENT_ARTIFACT",
    trustDecision: "NON_WINDOWS_HOST_CANNOT_INSPECT_AUTHENTICODE",
    note: "Authenticode verification requires Windows; this host records configuration truth only.",
  };
}

const effectiveRequireValid = requireValid || releaseState.trustedGateRequiresSignature;
if (effectiveRequireValid && process.platform === "win32") {
  const blocker = trustedReleaseBlocker(releaseState, evidence.observedSignature.status);
  if (blocker) fail(blocker);
} else if (effectiveRequireValid && process.platform !== "win32") {
  fail("TRUSTED_RELEASE verification requires Windows Authenticode evidence; this host cannot prove a Valid signature.");
}

if (jsonOut) {
  await fs.mkdir(path.dirname(jsonOut), { recursive: true });
  await fs.writeFile(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(`Signing verification: PASS — observed=${evidence.observedSignature.status} buildConfigured=${evidence.buildSigningConfigured ? "yes" : "no"}`);
console.log(JSON.stringify(evidence, null, 2));
