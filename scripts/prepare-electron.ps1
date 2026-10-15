$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  $runtimeVersion = & node -p "require('./node_modules/electron/package.json').version"
  if (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe') {
    if ((Get-Content -LiteralPath 'node_modules/electron/dist/version' -Raw).Trim().TrimStart('v') -eq $runtimeVersion) { Write-Output "Electron $runtimeVersion is ready."; exit 0 }
  }
  $archiveName = "electron-v$runtimeVersion-win32-x64.zip"
  $expectedHash = & node -p "require('./node_modules/electron/checksums.json')['$archiveName']"
  if (-not $expectedHash -or $expectedHash -eq 'undefined') { throw 'Official Electron checksum is missing.' }
  New-Item -ItemType Directory -Force -Path '.electron-cache' | Out-Null
  $archivePath = Join-Path $projectRoot ".electron-cache/$archiveName"
  $ready = (Test-Path -LiteralPath $archivePath) -and ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -eq $expectedHash)
  if (-not $ready) {
    Write-Output 'Downloading official Electron runtime (verified SHA256 required).'
    & curl.exe -L --fail --connect-timeout 10 --max-time 30 --output $archivePath "https://github.com/electron/electron/releases/download/v$runtimeVersion/$archiveName"
    if ($LASTEXITCODE -ne 0) {
      Write-Output 'Official download timed out; using mirror with the SAME official checksum.'
      & curl.exe -L --fail --connect-timeout 15 --max-time 240 --output $archivePath "https://npmmirror.com/mirrors/electron/$runtimeVersion/$archiveName"
      if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed.' }
    }
  }
  if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Electron SHA256 mismatch. Runtime was not installed.' }
  Expand-Archive -LiteralPath $archivePath -DestinationPath 'node_modules/electron/dist' -Force
  [System.IO.File]::WriteAllText((Join-Path $projectRoot 'node_modules/electron/path.txt'), 'electron.exe', [System.Text.Encoding]::ASCII)
  Write-Output "Electron $runtimeVersion verified and installed."
} finally { Pop-Location }
