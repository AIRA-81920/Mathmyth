param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('desktop', 'android', 'all')]
  [string]$Target,
  [string]$Version,
  [switch]$NoPrompt,
  [switch]$Release
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required. Install Node.js and reopen this window.' }
  if (-not (Test-Path -LiteralPath 'node_modules')) { throw 'Dependencies are missing. Run npm ci in frontend first.' }
  $versionInfo = & node scripts/version.mjs --info
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read current version.' }
  $currentVersion, $currentCode = $versionInfo.Trim().Split('|')
  Write-Host "Current version: $currentVersion (Android versionCode $currentCode)"
  if (-not $Version -and -not $NoPrompt) {
    do {
      $Version = (Read-Host "New version (example: 1.5.1; Enter keeps $currentVersion)").Trim()
      if (-not $Version) { $Version = $currentVersion }
      $validVersion = $Version -match '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$'
      if (-not $validVersion) { Write-Host 'Please use a version like 1.5.1.' }
    } until ($validVersion)
  }
  if (-not $Version) { $Version = $currentVersion }
  $nextCode = if ($Version -eq $currentVersion) { [int]$currentCode } else { [int]$currentCode + 1 }
  & node scripts/version.mjs --set $Version $nextCode
  if ($LASTEXITCODE -ne 0) { throw 'Invalid version; packaging stopped.' }
  Write-Host "Building $Target, version $Version. Credential checks are enabled."
  if ($Target -eq 'android' -or $Target -eq 'all') {
    & "$PSScriptRoot/build-android.ps1" -Version $Version -VersionCode $nextCode -NoPrompt -Release:$Release
    if ($LASTEXITCODE -ne 0) { throw 'Android packaging failed.' }
  }
  if ($Target -eq 'desktop' -or $Target -eq 'all') {
    # A running Mathmyth.exe holds win-unpacked\resources\app.asar, so electron-builder
    # fails with EPERM when overwriting it. Detect and refuse; never kill anything here.
    # Keep this block ASCII: PowerShell 5.1 decodes this file with the ANSI code page.
    $runningApp = @(Get-Process -Name 'Mathmyth' -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and $_.Path.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($runningApp.Count -gt 0) {
      $pids = ($runningApp | ForEach-Object { $_.Id }) -join ', '
      throw "Mathmyth.exe is still running (PID $pids) and locks win-unpacked resources app.asar. Close it, then run packaging again."
    }
    & npm.cmd run desktop:build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed.' }
  }
  Write-Host ''
  Write-Host 'BUILD SUCCEEDED'
  if ($Target -eq 'android' -or $Target -eq 'all') {
    $kind = if ($Release) { 'release' } else { 'debug' }
    Write-Host "APK: $projectRoot/artifacts/Mathmyth-v$Version-$kind.apk"
  }
  if ($Target -eq 'desktop' -or $Target -eq 'all') { Write-Host "EXE: $projectRoot/artifacts/desktop/Mathmyth-v$Version-Setup.exe" }
  exit 0
} catch {
  Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Pop-Location
}
