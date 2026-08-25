[CmdletBinding()]
param(
  [string]$InstallerPath,
  [switch]$SkipLifecycle
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$releaseDirectory = Join-Path $projectRoot 'release'
if (-not $InstallerPath) {
  $InstallerPath = Join-Path $releaseDirectory "KNOuX-Forge-Setup-v$($package.version)-Windows-x64.exe"
}
$evidenceDirectory = Join-Path $releaseDirectory 'verification'
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer was not found: $InstallerPath" }
$installer = Get-Item -LiteralPath $InstallerPath
if ($installer.Length -lt 10MB) { throw "Installer is unexpectedly small: $($installer.Length) bytes" }

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($InstallerPath)
try {
  $hash = (($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '')
} finally {
  $stream.Dispose()
  $sha256.Dispose()
}
$hashFile = Join-Path $releaseDirectory 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $hashFile -PathType Leaf)) { throw 'SHA256SUMS.txt is missing.' }
if ((Get-Content -LiteralPath $hashFile -Raw).ToLowerInvariant() -notmatch [regex]::Escape($hash)) { throw 'Installer SHA-256 does not match SHA256SUMS.txt.' }

$manifestPath = Join-Path $releaseDirectory 'installer-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'installer-manifest.json is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.artifactFilename -ne $installer.Name -or $manifest.sha256 -ne $hash -or $manifest.signatureState -ne 'UNSIGNED' -or $manifest.installerType -ne 'NSIS') { throw 'Installer manifest is inconsistent with the built artifact.' }

$unpacked = Join-Path $releaseDirectory 'win-unpacked'
if (Test-Path -LiteralPath $unpacked) {
  $unexpectedSecrets = Get-ChildItem -LiteralPath $unpacked -Recurse -Force -File | Where-Object { $_.Name -match '^\.env($|\.)|\.(pem|key)$' }
  if ($unexpectedSecrets) { throw "Unexpected secret-like file(s) found in unpacked output: $($unexpectedSecrets.FullName -join '; ')" }
}

$record = [ordered]@{
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  installerPath = $installer.FullName
  installerSize = $installer.Length
  sha256 = $hash
  manifestVerified = $true
  unpackedSecretCheck = if (Test-Path -LiteralPath $unpacked) { 'PASS' } else { 'NOT_AVAILABLE' }
  signatureState = 'UNSIGNED'
  lifecycle = 'SKIPPED'
}

if (-not $SkipLifecycle) {
  $smokeRoot = Join-Path $env:TEMP ("KForge-NSIS-Smoke-" + [Guid]::NewGuid().ToString('N'))
  try {
    $install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$smokeRoot") -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "Silent NSIS installation failed with exit code $($install.ExitCode)." }
    $app = Get-ChildItem -LiteralPath $smokeRoot -Filter 'KNOuX Forge.exe' -Recurse -File | Select-Object -First 1
    if (-not $app) { throw 'Installed application executable was not found.' }
    $previousSmoke = $env:KFORGE_DESKTOP_SMOKE
    $env:KFORGE_DESKTOP_SMOKE = '1'
    try {
      $launch = Start-Process -FilePath $app.FullName -PassThru
      if (-not $launch.WaitForExit(15000)) { throw 'Installed app did not complete the controlled startup-and-shutdown smoke check within 15 seconds.' }
      if ($launch.ExitCode -ne 0) { throw "Installed app exited during first-launch smoke check with code $($launch.ExitCode)." }
    } finally {
      if ($null -eq $previousSmoke) { Remove-Item Env:KFORGE_DESKTOP_SMOKE -ErrorAction SilentlyContinue } else { $env:KFORGE_DESKTOP_SMOKE = $previousSmoke }
    }
    $uninstaller = Get-ChildItem -LiteralPath $smokeRoot -Filter '*Uninstall*.exe' -Recurse -File | Select-Object -First 1
    if (-not $uninstaller) { throw 'Installed NSIS uninstaller was not found.' }
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "Silent NSIS uninstall failed with exit code $($uninstall.ExitCode)." }
    if (Test-Path -LiteralPath $smokeRoot) { throw 'Install directory remains after silent uninstall.' }
    $record.lifecycle = 'PASS'
  } finally {
    if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

$record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'installer-verification.json') -Encoding UTF8
Write-Output "Installer verification passed. SHA-256: $hash"
