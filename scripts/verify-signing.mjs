// Verifies a Windows artifact's Authenticode state and emits normalized evidence.
// Usage: node scripts/verify-signing.mjs <artifact-path> [--require-valid] [--json <out-path>]
// Never fabricates signing success. Unsigned artifacts report status UNSIGNED.
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
  const configured = releaseState.signingConfigured;
  const status = configured ? String(observed.status || "Unknown") : "UNSIGNED";
  evidence = {
    artifact: path.basename(artifactPath),
    signing: {
      configured,
      status,
      ...(configured
        ? {
          subject: observed.subject || undefined,
          issuer: observed.issuer || undefined,
          timestamped: observed.timestamped === true,
          ...(observed.thumbprint ? { thumbprint: observed.thumbprint } : {}),
        }
        : {}),
    },
    releaseMode: releaseState.mode,
    trustStatus: configured ? "TRUSTED_RELEASE_CANDIDATE" : "DEVELOPMENT_ARTIFACT",
  };
  // Unsigned files report UnknownError/NotSigned via the OS; normalize to UNSIGNED
  // unless signing material was actually configured for this build.
  if (!configured) evidence.signing.status = "UNSIGNED";
} else {
  evidence = {
    artifact: path.basename(artifactPath),
    signing: {
      configured: releaseState.signingConfigured,
      status: releaseState.signingConfigured ? "NOT_VERIFIED_ON_THIS_PLATFORM" : "UNSIGNED",
    },
    releaseMode: releaseState.mode,
    trustStatus: releaseState.signingConfigured ? "TRUSTED_RELEASE_CANDIDATE" : "DEVELOPMENT_ARTIFACT",
    note: "Authenticode verification requires Windows; this host records configuration truth only.",
  };
}

const effectiveRequireValid = requireValid || releaseState.trustedGateRequiresSignature;
if (effectiveRequireValid && process.platform === "win32") {
  const blocker = trustedReleaseBlocker(releaseState, evidence.signing.status);
  if (blocker) fail(blocker);
} else if (effectiveRequireValid && process.platform !== "win32") {
  fail("TRUSTED_RELEASE verification requires Windows Authenticode evidence; this host cannot prove a Valid signature.");
}

if (jsonOut) {
  await fs.mkdir(path.dirname(jsonOut), { recursive: true });
  await fs.writeFile(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

console.log(`Signing verification: PASS — ${evidence.signing.configured ? evidence.signing.status : "UNSIGNED (certificate not configured)"}`);
console.log(JSON.stringify(evidence, null, 2));
