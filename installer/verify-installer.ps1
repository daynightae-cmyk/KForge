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

function Fail([string]$Message) { throw "Installer verification failed: $Message" }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }

function Get-Sha256([string]$Path) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return (($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

function Get-KForgeUninstallEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  $entries = @()
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $entries += @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
      $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if ($item.DisplayName -eq 'KNOuX Forge') {
        [pscustomobject]@{
          RegistryPath = $_.PSPath
          DisplayName = $item.DisplayName
          DisplayVersion = $item.DisplayVersion
          Publisher = $item.Publisher
          InstallLocation = $item.InstallLocation
          UninstallString = $item.UninstallString
          DisplayIcon = $item.DisplayIcon
        }
      }
    })
  }
  return @($entries)
}

function Get-ShortcutTarget([string]$ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  try { return $shell.CreateShortcut($ShortcutPath).TargetPath } finally { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

function Wait-ForLoopback([string]$LogPath, [int]$TimeoutSeconds = 30, [string]$PreviousUrl = '') {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $LogPath) {
      $matches = [regex]::Matches((Get-Content -LiteralPath $LogPath -Raw), 'Loopback engine is ready at (http://127\.0\.0\.1:\d+)\.')
      if ($matches.Count -gt 0) { $candidate = $matches[$matches.Count - 1].Groups[1].Value; if ($candidate -ne $PreviousUrl) { return $candidate } }
    }
    Start-Sleep -Milliseconds 250
  }
  Fail "No loopback URL was recorded in $LogPath."
}

function Invoke-KForgeJson([string]$BaseUrl, [string]$Endpoint, [string]$Method = 'GET', $Body = $null) {
  $parameters = @{ Uri = "$BaseUrl$Endpoint"; Method = $Method; UseBasicParsing = $true; ErrorAction = 'Stop' }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = ($Body | ConvertTo-Json -Depth 12 -Compress)
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    throw "KForge HTTP $Method $Endpoint failed: $($_.Exception.Message)"
  }
}

function Wait-ForPreview([string]$BaseUrl, [string]$ProjectId, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = Invoke-KForgeJson $BaseUrl "/api/workspace/projects/$ProjectId/preview/health" 'POST' @{}
      $preview = $status.preview
      if ($preview.state -eq 'running' -and $preview.pid -and $preview.port -and $preview.url) { return $preview }
    } catch {
      # Preview and loopback startup are asynchronous; retry until the bounded deadline.
    }
    Start-Sleep -Milliseconds 500
  }
  Fail "Preview did not become running for project $ProjectId."
}

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { Fail "Installer was not found: $InstallerPath" }
$installer = Get-Item -LiteralPath $InstallerPath
if ($installer.Length -lt 10MB) { Fail "Installer is unexpectedly small: $($installer.Length) bytes" }
$hash = Get-Sha256 $InstallerPath

$hashFile = Join-Path $releaseDirectory 'SHA256SUMS.txt'
Assert-True (Test-Path -LiteralPath $hashFile -PathType Leaf) 'SHA256SUMS.txt is missing.'
Assert-True ((Get-Content -LiteralPath $hashFile -Raw).ToLowerInvariant() -match [regex]::Escape($hash)) 'Installer SHA-256 does not match SHA256SUMS.txt.'

$manifestPath = Join-Path $releaseDirectory 'installer-manifest.json'
Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) 'installer-manifest.json is missing.'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Assert-True ($manifest.artifactFilename -eq $installer.Name -and $manifest.sha256 -eq $hash -and $manifest.signatureState -eq 'UNSIGNED' -and $manifest.installerType -eq 'NSIS') 'Installer manifest is inconsistent with the built artifact.'

$unpacked = Join-Path $releaseDirectory 'win-unpacked'
if (Test-Path -LiteralPath $unpacked) {
  $unexpectedSecrets = Get-ChildItem -LiteralPath $unpacked -Recurse -Force -File | Where-Object { $_.Name -match '^\.env($|\.)|\.(pem|key)$' }
  if ($unexpectedSecrets) { Fail "Unexpected secret-like file(s) found in unpacked output: $($unexpectedSecrets.FullName -join '; ')" }
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
  appsAndFeatures = 'NOT_TESTED'
  startMenuShortcut = 'NOT_TESTED'
  desktopShortcut = 'NOT_TESTED'
  installedRuntime = 'NOT_TESTED'
  settingsPersistence = 'NOT_TESTED'
  previewLifecycle = 'NOT_TESTED'
  marketplaceLifecycle = 'NOT_TESTED'
  reinstall = 'NOT_TESTED'
  userDataRetention = 'NOT_TESTED'
  sourceIndependence = 'NOT_TESTED'
}

if (-not $SkipLifecycle) {
  $smokeRoot = Join-Path $env:TEMP ("KForge-NSIS-Smoke-" + [Guid]::NewGuid().ToString('N'))
  $appDataRoot = Join-Path $env:TEMP ("KForge-NSIS-AppData-" + [Guid]::NewGuid().ToString('N'))
  $previewRoot = Join-Path $env:TEMP ("KForge-Preview-Fixture-" + [Guid]::NewGuid().ToString('N'))
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'KNOuX Forge.lnk'
  $startMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\KNOuX Forge.lnk'
  $priorAppData = $env:LOCALAPPDATA
  $priorSmoke = $env:KFORGE_DESKTOP_SMOKE
  $priorDelay = $env:KFORGE_DESKTOP_SMOKE_DELAY_MS
  $smokeTag = Split-Path -Leaf $smokeRoot
  try {
    Assert-True ((Get-KForgeUninstallEntries).Count -eq 0) 'An existing KNOuX Forge Apps & Features entry was found; lifecycle verification refuses to disturb it.'
    Assert-True (-not (Test-Path -LiteralPath $desktopShortcut)) "A pre-existing desktop shortcut exists at $desktopShortcut; lifecycle verification refuses to delete user state."
    Assert-True (-not (Test-Path -LiteralPath $startMenuShortcut)) "A pre-existing Start Menu shortcut exists at $startMenuShortcut; lifecycle verification refuses to delete user state."

    $install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$smokeRoot") -Wait -PassThru
    Assert-True ($install.ExitCode -eq 0) "Silent NSIS installation failed with exit code $($install.ExitCode)."
    $app = Get-ChildItem -LiteralPath $smokeRoot -Filter 'KNOuX Forge.exe' -Recurse -File | Select-Object -First 1
    Assert-True ($null -ne $app) 'Installed application executable was not found.'

    $entries = @(Get-KForgeUninstallEntries | Where-Object { $_.UninstallString -match [regex]::Escape($smokeTag) })
    Assert-True ($entries.Count -ge 1) 'No KNOuX Forge Apps & Features entry was registered for this installation.'
    Assert-True ($entries.Count -eq 1) 'Multiple KNOuX Forge Apps & Features entries were registered for this installation.'
    $entry = $entries[0]
    Assert-True ($entry.DisplayName -eq 'KNOuX Forge') 'Apps & Features DisplayName is incorrect.'
    Assert-True ($entry.DisplayVersion -eq $package.version) 'Apps & Features DisplayVersion does not match package.json.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($entry.Publisher)) 'Apps & Features Publisher is missing.'
    Assert-True ($entry.InstallLocation -eq $smokeRoot) 'Apps & Features InstallLocation does not match the selected per-user install root.'
    Assert-True ($entry.UninstallString -match [regex]::Escape('Uninstall')) 'Apps & Features UninstallString is missing the uninstaller.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($entry.DisplayIcon)) 'Apps & Features DisplayIcon is missing.'
    $record.appsAndFeatures = 'PASS'

    Assert-True (Test-Path -LiteralPath $startMenuShortcut) 'Start Menu shortcut was not created.'
    Assert-True ((Get-ShortcutTarget $startMenuShortcut) -eq $app.FullName) 'Start Menu shortcut target does not point at KNOuX Forge.exe.'
    Assert-True (Test-Path -LiteralPath $desktopShortcut) 'Desktop shortcut was not created by the documented first-install policy.'
    Assert-True ((Get-ShortcutTarget $desktopShortcut) -eq $app.FullName) 'Desktop shortcut target does not point at KNOuX Forge.exe.'
    $record.startMenuShortcut = 'PASS'
    $record.desktopShortcut = 'PASS'

    New-Item -ItemType Directory -Force -Path $previewRoot | Out-Null
    @'
{"name":"kforge-preview-fixture","private":true,"scripts":{"dev":"node server.js","start":"node server.js"}}
'@ | Set-Content -LiteralPath (Join-Path $previewRoot 'package.json') -Encoding ascii
    @'
const http = require("http");
const port = Number(process.env.PORT || 0);
http.createServer((_request, response) => { response.writeHead(200, { "content-type": "text/plain" }); response.end("kforge-preview-ok"); }).listen(port, "127.0.0.1");
'@ | Set-Content -LiteralPath (Join-Path $previewRoot 'server.js') -Encoding ascii

    $env:LOCALAPPDATA = $appDataRoot
    $env:KFORGE_DESKTOP_SMOKE = '1'
    $env:KFORGE_DESKTOP_SMOKE_DELAY_MS = '120000'
    $launch = Start-Process -FilePath $app.FullName -PassThru
    $logPath = Join-Path $appDataRoot 'KNOuX Forge\logs\desktop.log'
    $baseUrl = Wait-ForLoopback $logPath
    $settingsEnvelope = Invoke-KForgeJson $baseUrl '/api/workspace/settings'
    $settings = $settingsEnvelope.settings
    $settings.general.startupCapability = 'Agents'
    $settings.appearance.density = 'compact'
    $settings.appearance.reducedMotion = $true
    $settings.preview.autoHealthCheck = $false
    $savedSettings = (Invoke-KForgeJson $baseUrl '/api/workspace/settings' 'PATCH' $settings).settings
    Assert-True ($savedSettings.general.startupCapability -eq 'Agents' -and $savedSettings.appearance.density -eq 'compact' -and $savedSettings.appearance.reducedMotion) 'Installed settings write did not return saved values.'
    $platform = Invoke-KForgeJson $baseUrl '/api/workspace/platform/mode' 'POST' @{ mode = 'local-first' }
    Assert-True ($platform.mode -eq 'local-first') 'Installed platform mode did not persist local-first.'

    $opened = Invoke-KForgeJson $baseUrl '/api/workspace/projects/open' 'POST' @{ path = $previewRoot }
    $projectId = $opened.project.id
    Assert-True (-not [string]::IsNullOrWhiteSpace($projectId)) 'Installed runtime did not return a project identifier for the local Preview fixture.'
    $trusted = Invoke-KForgeJson $baseUrl "/api/workspace/projects/$projectId/trust" 'POST' @{ confirmed = $true }
    Assert-True ($trusted.trust -eq 'trusted') 'Installed runtime did not persist explicit project trust.'

    $itemId = 'package%3Akforge%3Ajson-inspector'
    $installed = Invoke-KForgeJson $baseUrl "/api/workspace/marketplace/items/$itemId/install" 'POST' @{ confirmed = $true }
    Assert-True ($installed.stage -eq 'INSTALLED') 'First-party Marketplace package did not install in the installed runtime.'
    $healthyPackage = Invoke-KForgeJson $baseUrl "/api/workspace/marketplace/items/$itemId/health"
    Assert-True ($healthyPackage.ok) 'Installed Marketplace package did not pass its health check.'
    $executedPackage = Invoke-KForgeJson $baseUrl "/api/workspace/marketplace/items/$itemId/run" 'POST' @{ confirmed = $true }
    Assert-True ($executedPackage.ok) 'Installed Marketplace package did not execute successfully.'
    $updatedPackage = Invoke-KForgeJson $baseUrl "/api/workspace/marketplace/items/$itemId/update" 'POST' @{ confirmed = $true }
    Assert-True ($updatedPackage.stage -eq 'UPDATED') 'Installed Marketplace package did not update to the included newer fixture.'
    $removedPackage = Invoke-KForgeJson $baseUrl "/api/workspace/marketplace/items/$itemId/uninstall" 'POST' @{ confirmed = $true }
    Assert-True ($removedPackage.stage -eq 'UNINSTALLED') 'Installed Marketplace package did not uninstall cleanly.'
    $record.marketplaceLifecycle = 'PASS'

    $startedPreview = Invoke-KForgeJson $baseUrl "/api/workspace/projects/$projectId/preview/start" 'POST' @{}
    Assert-True ($startedPreview.preview.state -ne 'unavailable') 'Installed Preview is unavailable for the safe local fixture.'
    $preview = Wait-ForPreview $baseUrl $projectId
    Assert-True ((Get-Process -Id ([int]$preview.pid) -ErrorAction SilentlyContinue) -ne $null) 'Reported Preview PID is not running.'
    Assert-True ($preview.url -match '^http://127\.0\.0\.1:\d+') 'Preview URL is not bound to loopback.'
    $restartedPreview = Invoke-KForgeJson $baseUrl "/api/workspace/projects/$projectId/preview/restart" 'POST' @{}
    Assert-True ($restartedPreview.preview.state -ne 'unavailable') 'Installed Preview restart is unavailable for the safe local fixture.'
    $previewAfterRestart = Wait-ForPreview $baseUrl $projectId
    $stoppedPreview = Invoke-KForgeJson $baseUrl "/api/workspace/projects/$projectId/preview/stop" 'POST' @{}
    Assert-True ($stoppedPreview.preview.state -in @('stopped', 'idle')) 'Installed Preview did not report a stopped state.'
    Start-Sleep -Milliseconds 500
    Assert-True ((Get-Process -Id ([int]$previewAfterRestart.pid) -ErrorAction SilentlyContinue) -eq $null) 'KForge-managed Preview child process survived an explicit stop.'
    $record.previewLifecycle = 'PASS'

    Assert-True ($launch.WaitForExit(150000)) 'Installed desktop did not complete its controlled startup-and-shutdown lifecycle.'
    Assert-True ($launch.ExitCode -eq 0) "Installed desktop exited with code $($launch.ExitCode)."
    Assert-True ((Get-Process -Id $launch.Id -ErrorAction SilentlyContinue) -eq $null) 'The installed desktop process remains after controlled shutdown.'
    $log = Get-Content -LiteralPath $logPath -Raw
    Assert-True ($log -match 'Starting KNOuX Forge .*\(packaged runtime\)') 'Installed runtime did not identify itself as packaged.'
    Assert-True ($log -match 'KNOuX Forge window loaded\.') 'Installed application window did not load.'
    Assert-True ($log -match 'Loopback engine and managed Preview and topology processes stopped\.') 'Installed runtime did not log controlled Preview and topology process cleanup.'
    Assert-True ($log -notmatch [regex]::Escape($projectRoot)) 'Installed runtime log unexpectedly depends on the source repository path.'
    $record.installedRuntime = 'PASS'
    $record.sourceIndependence = 'PASS_LOG_AND_RESOURCE_CHECK'

    $env:KFORGE_DESKTOP_SMOKE_DELAY_MS = '6000'
    $restart = Start-Process -FilePath $app.FullName -PassThru
    $restartBaseUrl = Wait-ForLoopback $logPath 30 $baseUrl
    $reloadedSettings = (Invoke-KForgeJson $restartBaseUrl '/api/workspace/settings').settings
    $reloadedPlatform = Invoke-KForgeJson $restartBaseUrl '/api/workspace/platform'
    Assert-True ($reloadedSettings.general.startupCapability -eq 'Agents' -and $reloadedSettings.appearance.density -eq 'compact' -and $reloadedSettings.appearance.reducedMotion) 'Installed settings did not survive a full desktop restart.'
    Assert-True ($reloadedPlatform.mode -eq 'local-first') 'Installed platform mode did not survive a full desktop restart.'
    Assert-True ($restart.WaitForExit(30000) -and $restart.ExitCode -eq 0) 'Restarted desktop did not shut down cleanly.'
    Assert-True ((Get-Process -Id $restart.Id -ErrorAction SilentlyContinue) -eq $null) 'Restarted desktop process remains after controlled shutdown.'
    $record.settingsPersistence = 'PASS'

    $uninstaller = Get-ChildItem -LiteralPath $smokeRoot -Filter '*Uninstall*.exe' -Recurse -File | Select-Object -First 1
    Assert-True ($null -ne $uninstaller) 'Installed NSIS uninstaller was not found.'
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
    Assert-True ($uninstall.ExitCode -eq 0) "Silent NSIS uninstall failed with exit code $($uninstall.ExitCode)."
    Assert-True (-not (Test-Path -LiteralPath $smokeRoot)) 'Install directory remains after silent uninstall.'
    Assert-True (-not (Test-Path -LiteralPath $startMenuShortcut)) 'Start Menu shortcut remains after uninstall.'
    Assert-True (-not (Test-Path -LiteralPath $desktopShortcut)) 'Desktop shortcut remains after uninstall.'
    Assert-True ((Get-KForgeUninstallEntries).Count -eq 0) 'Apps & Features registry entry remains after uninstall.'
    $installProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match [regex]::Escape($smokeTag) })
    Assert-True ($installProcesses.Count -eq 0) 'A KForge process tied to the removed install path remains after uninstall.'
    $retainedSettingsPath = Join-Path $appDataRoot 'KNOuX Forge\workspace\.kforge\platform-settings.json'
    $retainedPlatformPath = Join-Path $appDataRoot 'KNOuX Forge\workspace\.kforge\local-platform.json'
    Assert-True ((Test-Path -LiteralPath $retainedSettingsPath) -and (Test-Path -LiteralPath $retainedPlatformPath)) 'Normal uninstall unexpectedly removed persisted KForge user data.'
    $record.userDataRetention = 'PASS'

    $reinstall = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$smokeRoot") -Wait -PassThru
    Assert-True ($reinstall.ExitCode -eq 0) "Same-version reinstall failed with exit code $($reinstall.ExitCode)."
    Assert-True (Test-Path -LiteralPath $startMenuShortcut) 'Start Menu shortcut was not recreated by same-version reinstall.'
    Assert-True (Test-Path -LiteralPath $desktopShortcut) 'Desktop shortcut was not recreated by same-version reinstall.'
    $reinstallApp = Get-ChildItem -LiteralPath $smokeRoot -Filter 'KNOuX Forge.exe' -Recurse -File | Select-Object -First 1
    Assert-True ($null -ne $reinstallApp) 'Same-version reinstall did not restore the application executable.'
    $secondUninstaller = Get-ChildItem -LiteralPath $smokeRoot -Filter '*Uninstall*.exe' -Recurse -File | Select-Object -First 1
    $secondUninstall = Start-Process -FilePath $secondUninstaller.FullName -ArgumentList '/S' -Wait -PassThru
    Assert-True ($secondUninstall.ExitCode -eq 0 -and -not (Test-Path -LiteralPath $smokeRoot)) 'Same-version reinstall cleanup failed.'
    Assert-True ((Get-KForgeUninstallEntries).Count -eq 0) 'Apps & Features entry remains after same-version reinstall cleanup.'
    $record.reinstall = 'PASS'
    $record.lifecycle = 'PASS'
  } finally {
    $emergencyUninstaller = if (Test-Path -LiteralPath $smokeRoot) { Get-ChildItem -LiteralPath $smokeRoot -Filter '*Uninstall*.exe' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
    if ($emergencyUninstaller) { Start-Process -FilePath $emergencyUninstaller.FullName -ArgumentList '/S' -Wait -ErrorAction SilentlyContinue | Out-Null }
    foreach ($orphan in @(Get-KForgeUninstallEntries | Where-Object { $_.UninstallString -match [regex]::Escape($smokeTag) })) {
      $registeredUninstaller = [regex]::Match($orphan.UninstallString, '"([^"]+\\.exe)"').Groups[1].Value
      if (-not $registeredUninstaller -or -not (Test-Path -LiteralPath $registeredUninstaller)) { Remove-Item -LiteralPath $orphan.RegistryPath -Recurse -Force -ErrorAction SilentlyContinue }
    }
    foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
      if (Test-Path -LiteralPath $shortcut) {
        $shortcutShell = New-Object -ComObject WScript.Shell
        try { $shortcutTarget = $shortcutShell.CreateShortcut($shortcut).TargetPath } finally { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shortcutShell) }
        if ($shortcutTarget -match [regex]::Escape($smokeTag) -and -not (Test-Path -LiteralPath $shortcutTarget)) { Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue }
      }
    }
    if ($null -eq $priorAppData) { Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue } else { $env:LOCALAPPDATA = $priorAppData }
    if ($null -eq $priorSmoke) { Remove-Item Env:KFORGE_DESKTOP_SMOKE -ErrorAction SilentlyContinue } else { $env:KFORGE_DESKTOP_SMOKE = $priorSmoke }
    if ($null -eq $priorDelay) { Remove-Item Env:KFORGE_DESKTOP_SMOKE_DELAY_MS -ErrorAction SilentlyContinue } else { $env:KFORGE_DESKTOP_SMOKE_DELAY_MS = $priorDelay }
    if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $appDataRoot) { Remove-Item -LiteralPath $appDataRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $previewRoot) { Remove-Item -LiteralPath $previewRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'installer-verification.json') -Encoding UTF8
Write-Output "Installer verification passed. SHA-256: $hash"
