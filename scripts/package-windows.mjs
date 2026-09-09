import { createHash } from "crypto";
import { existsSync, promises as fs } from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import process from "process";
import { resolveReleaseStateFromEnv, trustedReleaseBlocker } from "./release-state.mjs";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const verificationDir = path.join(releaseDir, "verification");
const expectedInstaller = `KNOuX-Forge-Setup-v${packageJson.version}-Windows-x64.exe`;
const installerPath = path.join(releaseDir, expectedInstaller);
const releaseState = resolveReleaseStateFromEnv(process.env);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, shell: false, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

async function sha256(target) {
  const buffer = await fs.readFile(target);
  return createHash("sha256").update(buffer).digest("hex");
}

async function observeSigningEvidence(target, state) {
  if (process.platform !== "win32") {
    return {
      signing: {
        configured: state.signingConfigured,
        status: state.signingConfigured ? "NOT_VERIFIED_ON_THIS_PLATFORM" : "UNSIGNED",
      },
    };
  }
  try {
    const script = [
      "$cmd = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue",
      "if ($null -eq $cmd) { try { Import-Module Microsoft.PowerShell.Security -ErrorAction Stop } catch { } }",
      "$cmd = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue",
      "if ($null -eq $cmd) { @{ status = 'UNAVAILABLE'; subject = $null; issuer = $null; thumbprint = $null; timestamped = $false } | ConvertTo-Json -Depth 4 -Compress }",
      "else { $sig = Get-AuthenticodeSignature -LiteralPath $env:KFORGE_PACKAGE_SIGNING_TARGET",
      "if ($null -eq $sig) { @{ status = 'UNAVAILABLE'; subject = $null; issuer = $null; thumbprint = $null; timestamped = $false } | ConvertTo-Json -Depth 4 -Compress }",
      "else { $signer = $null",
      "if ($sig.SignerCertificate) { $signer = $sig.SignerCertificate }",
      "$out = [ordered]@{ status = $sig.Status.ToString(); subject = if ($signer) { $signer.Subject } else { $null }; issuer = if ($signer) { $signer.Issuer } else { $null }; thumbprint = if ($signer) { $signer.Thumbprint } else { $null }; timestamped = $null -ne $sig.TimeStamperCertificate }",
      "$out | ConvertTo-Json -Depth 4 -Compress } }",
    ].join("\n");
    const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, KFORGE_PACKAGE_SIGNING_TARGET: target },
    }).trim();
    const observed = JSON.parse(output);
    if (!state.signingConfigured) return { signing: { configured: false, status: "UNSIGNED" } };
    return {
      signing: {
        configured: true,
        status: String(observed.status || "Unknown"),
        ...(observed.subject ? { subject: observed.subject } : {}),
        ...(observed.issuer ? { issuer: observed.issuer } : {}),
        timestamped: observed.timestamped === true,
        ...(observed.thumbprint ? { thumbprint: observed.thumbprint } : {}),
      },
    };
  } catch {
    if (!state.signingConfigured) return { signing: { configured: false, status: "UNSIGNED" } };
    return { signing: { configured: true, status: "Unknown" } };
  }
}

await fs.mkdir(releaseDir, { recursive: true });
await fs.mkdir(verificationDir, { recursive: true });
await fs.rm(installerPath, { force: true });
if (releaseState.trustedGateRequiresSignature && !releaseState.signingConfigured) {
  throw new Error("TRUSTED_RELEASE requires WIN_CSC_LINK/CSC_LINK signing material; none is configured. Build as DEVELOPMENT or RELEASE_CANDIDATE instead.");
}
const electronBuilderCli = path.join(root, "node_modules", "electron-builder", "cli.js");
if (!existsSync(electronBuilderCli)) throw new Error("electron-builder is not installed. Run npm ci before packaging Windows.");
// electron-builder reads WIN_CSC_LINK/CSC_LINK/CSC_KEY_PASSWORD directly from the
// environment; no certificate material is stored in git. When unconfigured the
// build proceeds as an explicitly unsigned development/release-candidate artifact.
run(process.execPath, [electronBuilderCli, "--win", "nsis", "--x64", "--publish", "never"]);

if (!existsSync(installerPath)) throw new Error(`Expected NSIS installer was not produced: ${installerPath}`);
const stat = await fs.stat(installerPath);
if (stat.size < 10 * 1024 * 1024) throw new Error(`NSIS installer is unexpectedly small (${stat.size} bytes).`);
const checksum = await sha256(installerPath);
const generatedAt = new Date().toISOString();
const signingEvidence = await observeSigningEvidence(installerPath, releaseState);
const trustedBlocker = trustedReleaseBlocker(releaseState, signingEvidence.signing.status);
if (trustedBlocker) throw new Error(`Trusted release gate failed: ${trustedBlocker}`);
const manifest = {
  name: "KNOuX Forge",
  version: packageJson.version,
  architecture: "x64",
  buildTimestamp: generatedAt,
  gitSha: gitSha(),
  artifactFilename: expectedInstaller,
  size: stat.size,
  sha256: checksum,
  signatureState: signingEvidence.signing.configured ? signingEvidence.signing.status.toUpperCase() : "UNSIGNED",
  signing: signingEvidence.signing,
  releaseMode: releaseState.mode,
  trustStatus: releaseState.trustStatus,
  installerType: "NSIS",
  runtimeType: "Electron + embedded Node/Express loopback server",
  installScope: "per-user",
};

await fs.writeFile(path.join(releaseDir, "SHA256SUMS.txt"), `${checksum} *${expectedInstaller}\n`, "utf8");
await fs.writeFile(path.join(releaseDir, "installer-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const signingNotes = manifest.signing.configured
  ? `**SIGNED BUILD.** Authenticode status \`${manifest.signing.status}\`${manifest.signing.subject ? `, subject \`${manifest.signing.subject}\`` : ""}${manifest.signing.timestamped ? ", RFC3161 timestamp present" : ", timestamp state recorded in verification evidence"}. See \`release/verification/package-windows.json\` for measured evidence.`
  : `**UNSIGNED DEVELOPMENT/RELEASE ARTIFACT.** No code-signing certificate was supplied or verified for this build (SIGNING_STATUS=UNSIGNED, TRUST_STATUS=DEVELOPMENT_ARTIFACT). Windows reputation and publisher trust are not claimed.`;
await fs.writeFile(path.join(releaseDir, "RELEASE-NOTES.md"), `# KNOuX Forge ${packageJson.version}\n\n## Included changes\n\nThis release introduces the KNOuX Forge Windows desktop shell, a loopback-only embedded production server, safe shutdown of KForge-managed Preview and topology processes, per-user NSIS installation, user-data separation under LocalAppData, runtime diagnostics, and a Settings Center About card sourced from the desktop runtime.\n\n## Installation\n\nRun \`${expectedInstaller}\` from a trusted local download. The installer is a per-user installation and does not require administrator elevation. A Start Menu shortcut and a Desktop shortcut are created by the NSIS installer on first installation.\n\n## Offline and online behavior\n\nKForge still starts in Offline mode. Network use remains opt-in and capability-specific; opening remote surfaces does not itself contact a provider.\n\n## Release mode\n\nMode \`${releaseState.mode}\`. Signing configured: ${releaseState.signingConfigured ? "yes" : "no"}.\n\n## Signing status\n\n${signingNotes}\n\n## Known limitations\n\nA clean-machine Windows VM or Sandbox was not attached to the build environment. The included verification covers the produced artifact and local silent installation path; it does not claim SmartScreen reputation, signing, or external-provider verification.\n`, "utf8");
await fs.writeFile(path.join(verificationDir, "package-windows.json"), `${JSON.stringify({ ...manifest, verifiedAt: generatedAt, checks: { installerExists: true, installerSizeBytes: stat.size, sha256Recorded: true, signatureState: manifest.signatureState } }, null, 2)}\n`, "utf8");
console.log(`Created ${expectedInstaller}`);
console.log(`SHA-256: ${checksum}`);
console.log(`Release mode: ${releaseState.mode}; signing: ${manifest.signing.configured ? manifest.signing.status : "UNSIGNED"}`);
