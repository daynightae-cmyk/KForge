[CmdletBinding()]
param(
  [string]$RepoPath = 'D:\Knoux Projects\Knoux_Project_Center\01_Ready\KForge',
  [int]$Port = 8081,
  [string]$WorkspaceRoot = '',
  [switch]$SkipInstall,
  [switch]$SkipTypecheck
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RemoteUrl = 'https://github.com/daynightae-cmyk/KForge.git'
$PreviewHost = '127.0.0.1'
$PreviewUrl = "http://${PreviewHost}:$Port/workspace"
$PingUrl = "http://${PreviewHost}:$Port/api/ping"

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Escape-SingleQuoted([string]$Value) {
  return $Value.Replace("'", "''")
}

Write-Host 'KNOuX Forge | Local Main Sync + Preview' -ForegroundColor Green
Write-Host "Repository : $RemoteUrl"
Write-Host "Local path : $RepoPath"
Write-Host "Preview    : $PreviewUrl"

Require-Command git
Require-Command node
Require-Command npm

if (-not (Test-Path -LiteralPath $RepoPath)) {
  Write-Step 'Local repository is missing; cloning main'
  $parent = Split-Path -Parent $RepoPath
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  & git clone --branch main --single-branch $RemoteUrl $RepoPath
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed with exit code $LASTEXITCODE."
  }
}

Set-Location -LiteralPath $RepoPath

if (-not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))) {
  throw "The configured RepoPath is not a Git repository: $RepoPath"
}

Write-Step 'Normalizing origin and fetching remote main'
$origin = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($origin)) {
  Invoke-Git remote add origin $RemoteUrl
} elseif ($origin.Trim() -ne $RemoteUrl) {
  Write-Host "Updating origin from '$($origin.Trim())' to '$RemoteUrl'." -ForegroundColor Yellow
  Invoke-Git remote set-url origin $RemoteUrl
}

Invoke-Git fetch origin --prune

$hasLocalMain = $false
& git show-ref --verify --quiet refs/heads/main
if ($LASTEXITCODE -eq 0) { $hasLocalMain = $true }

if ($hasLocalMain) {
  Invoke-Git switch main
} else {
  Invoke-Git switch --create main --track origin/main
}

$dirty = (& git status --porcelain)
$stashCreated = $false
$stashMessage = "kforge-local-sync-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

if ($dirty) {
  Write-Step 'Preserving local uncommitted work before sync'
  & git stash push --include-untracked --message $stashMessage
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to stash local changes safely; remote sync was not attempted.'
  }
  $stashCreated = $true
}

try {
  Write-Step 'Fast-forwarding local main from origin/main'
  Invoke-Git pull --ff-only origin main

  $localSha = (& git rev-parse HEAD).Trim()
  $remoteSha = (& git rev-parse origin/main).Trim()
  if ($localSha -ne $remoteSha) {
    throw "Local main ($localSha) does not match origin/main ($remoteSha) after synchronization."
  }

  Write-Host "Synchronized SHA: $localSha" -ForegroundColor Green
}
finally {
  if ($stashCreated) {
    Write-Step 'Reapplying preserved local work'
    & git stash pop
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'The remote main update is present, but your preserved local changes produced conflicts while being reapplied.' -ForegroundColor Red
      Write-Host 'Resolve the conflicts before starting KForge. The stash entry is retained by Git when pop fails.' -ForegroundColor Yellow
      throw 'Local changes could not be reapplied cleanly.'
    }
  }
}

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = Split-Path -Parent $RepoPath
}
$env:KFORGE_WORKSPACE_ROOT = $WorkspaceRoot

Write-Host "Workspace root: $WorkspaceRoot" -ForegroundColor DarkGray

if (-not $SkipInstall) {
  Write-Step 'Installing the exact locked dependency set'
  & npm ci
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed with exit code $LASTEXITCODE."
  }
}

if (-not $SkipTypecheck) {
  Write-Step 'Running TypeScript verification before preview'
  & npm run typecheck
  if ($LASTEXITCODE -ne 0) {
    throw "npm run typecheck failed with exit code $LASTEXITCODE."
  }
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $processName = 'unknown process'
  try {
    $processName = (Get-Process -Id $listener.OwningProcess -ErrorAction Stop).ProcessName
  } catch {}
  throw "Port $Port is already in use by PID $($listener.OwningProcess) ($processName). No process was terminated automatically."
}

Write-Step "Starting KForge development preview on port $Port"
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh.exe' } else { 'powershell.exe' }
$repoEscaped = Escape-SingleQuoted $RepoPath
$workspaceEscaped = Escape-SingleQuoted $WorkspaceRoot
$command = "Set-Location -LiteralPath '$repoEscaped'; `$env:KFORGE_WORKSPACE_ROOT='$workspaceEscaped'; npm run dev -- --host $PreviewHost --port $Port --strictPort"

$previewProcess = Start-Process -FilePath $shell -ArgumentList @('-NoExit', '-NoLogo', '-Command', $command) -PassThru
Write-Host "Preview terminal PID: $($previewProcess.Id)" -ForegroundColor DarkGray

Write-Step 'Waiting for the local API smoke check'
$ready = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $PingUrl -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
      $ready = $true
      break
    }
  } catch {
    if ($previewProcess.HasExited) {
      throw 'The preview process exited before the local API became ready. Check the preview terminal for the failure.'
    }
  }
}

if (-not $ready) {
  throw "KForge did not answer $PingUrl. Check the preview terminal for details."
}

Write-Host "`nKForge is ready: $PreviewUrl" -ForegroundColor Green
Start-Process $PreviewUrl
