[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$ConfirmPurge
)

$ErrorActionPreference = 'Stop'
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if ([string]::IsNullOrWhiteSpace($localAppData)) { throw 'Windows LocalApplicationData could not be resolved.' }
$dataRoot = Join-Path $localAppData 'KNOuX Forge'

if (-not $ConfirmPurge) {
  [Console]::Error.WriteLine("Refusing to delete KNOuX Forge user data. Re-run with -ConfirmPurge after exporting any settings, task evidence, snapshots, logs, and Marketplace state you need to keep.")
  exit 2
}

if (-not (Test-Path -LiteralPath $dataRoot)) {
  Write-Output "No KNOuX Forge user-data directory exists at $dataRoot."
  exit 0
}

$resolved = (Resolve-Path -LiteralPath $dataRoot).Path.TrimEnd('\\')
$expected = [IO.Path]::GetFullPath($dataRoot).TrimEnd('\\')
if (-not $resolved.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to purge an unexpected resolved path: $resolved"
}

if ($PSCmdlet.ShouldProcess($resolved, 'Permanently delete KNOuX Forge user data')) {
  Remove-Item -LiteralPath $resolved -Recurse -Force
  Write-Output "Purged KNOuX Forge user data from $resolved."
}
