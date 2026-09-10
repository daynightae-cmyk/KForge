// Verifies a Windows artifact's Authenticode state and emits artifact-based evidence.
// Usage: node scripts/verify-signing.mjs <artifact-path> [--require-valid] [--json <out-path>]
// Distinguishes build signing material from observed artifact signature.
// Exit code 0 when the requested policy passes; 1 when --require-valid/TRUSTED_RELEASE fails.
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import process from "process";
import { normalizeObservedSignature, resolveReleaseStateFromEnv, trustedArtifactBlocker } from "./release-state.mjs";

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

async function sha256(target) {
  const buffer = await fs.readFile(target);
  return createHash("sha256").update(buffer).digest("hex");
}

const artifactSha256 = await sha256(artifactPath);
let evidence;
if (process.platform === "win32") {
  const observed = queryWindowsSignature(artifactPath);
  const observedStatus = normalizeObservedSignature(observed.status, observed.status !== "UNAVAILABLE");
  const observedSignature = {
    inspected: observed.status !== "UNAVAILABLE",
    status: observedStatus,
    ...(observed.subject ? { subject: observed.subject } : {}),
    ...(observed.issuer ? { issuer: observed.issuer } : {}),
    ...(observed.thumbprint ? { thumbprint: observed.thumbprint } : {}),
    timestamped: observed.timestamped === true,
  };
  const signedValid = observedStatus === "VALID";
  evidence = {
    artifact: path.basename(artifactPath),
    sha256: artifactSha256,
    buildSigningConfigured: releaseState.signingConfigured,
    observedSignature,
    // Legacy compatibility projection. `configured` means build material was
    // present in this process; `status` is always the independently observed
    // artifact status and is never rewritten to UNSIGNED from env state.
    signing: {
      configured: releaseState.signingConfigured,
      status: observedStatus,
      ...(observed.subject ? { subject: observed.subject } : {}),
      ...(observed.issuer ? { issuer: observed.issuer } : {}),
      timestamped: observed.timestamped === true,
      ...(observed.thumbprint ? { thumbprint: observed.thumbprint } : {}),
    },
    releaseMode: releaseState.mode,
    trustStatus: signedValid
      ? (releaseState.mode === "TRUSTED_RELEASE" ? "TRUSTED_RELEASE_VERIFIED" : "SIGNED_VALID_ARTIFACT")
      : "DEVELOPMENT_ARTIFACT",
    trustDecision: signedValid ? "ARTIFACT_SIGNED_VALID" : "ARTIFACT_NOT_VALID_SIGNED",
  };
} else {
  evidence = {
    artifact: path.basename(artifactPath),
    sha256: artifactSha256,
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
if (effectiveRequireValid) {
  const blocker = trustedArtifactBlocker(evidence.observedSignature, {
    // A formal TRUSTED_RELEASE additionally requires signer identity evidence.
    // --require-valid alone is intentionally a pure artifact validity check.
    requireSigner: releaseState.mode === "TRUSTED_RELEASE",
    requireTimestamp: false,
  });
  if (blocker) fail(blocker);
}

if (jsonOut) {
  await fs.mkdir(path.dirname(jsonOut), { recursive: true });
  await fs.writeFile(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(`Signing verification: PASS — observed=${evidence.observedSignature.status} buildConfigured=${evidence.buildSigningConfigured ? "yes" : "no"}`);
console.log(JSON.stringify(evidence, null, 2));
