param([string]$SdkPath, [string]$JdkPath, [string]$Version, [int]$VersionCode = 0, [switch]$NoPrompt)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $SdkPath) { $SdkPath = if (Test-Path "$projectRoot/.android-sdk/platforms") { "$projectRoot/.android-sdk" } else { $env:ANDROID_HOME } }
if (-not $JdkPath) { $JdkPath = if (Test-Path "$projectRoot/.android-sdk/jdk-21/bin/java.exe") { "$projectRoot/.android-sdk/jdk-21" } else { $env:JAVA_HOME } }
if (-not $SdkPath -or -not (Test-Path -LiteralPath "$SdkPath/platforms/android-36")) { throw 'Android SDK 36 is required. Use -SdkPath to specify its directory.' }
if (-not $JdkPath -or -not (Test-Path -LiteralPath "$JdkPath/bin/java.exe")) { throw 'JDK 21 is required. Use -JdkPath to specify its directory.' }
$env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkPath).Path
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkPath).Path
$env:GRADLE_USER_HOME = "$projectRoot/.gradle-cache"
Push-Location $projectRoot
try {
  $versionInfo = & node scripts/version.mjs --info
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read current version' }
  $currentVersion, $currentCode = $versionInfo.Split('|')
  Write-Output "Current version: $currentVersion (Android versionCode $currentCode)"
  if (-not $Version -and -not $NoPrompt) { $Version = Read-Host "Version to build (Enter keeps $currentVersion)" }
  if (-not $Version) { $Version = $currentVersion }
  if (-not $VersionCode) { $VersionCode = if ($Version -eq $currentVersion) { [int]$currentCode } else { [int]$currentCode + 1 } }
  & node scripts/version.mjs --set $Version $VersionCode
  if ($LASTEXITCODE -ne 0) { throw 'Invalid version; no APK built' }
  Write-Output "Building $Version (versionCode $VersionCode). User API Keys remain in device storage."
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
  & node scripts/credential-guard.mjs dist
  if ($LASTEXITCODE -ne 0) { throw 'Credential guard rejected web assets; APK build stopped' }
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'Android sync failed' }
  Push-Location "$projectRoot/android"
  try { & .\gradlew.bat assembleDebug --no-daemon; if ($LASTEXITCODE -ne 0) { throw 'APK build failed' } }
  finally { Pop-Location }
  $sourceApk = "$projectRoot/android/app/build/outputs/apk/debug/app-debug.apk"
  & node scripts/credential-guard.mjs $sourceApk
  if ($LASTEXITCODE -ne 0) { throw 'Credential guard rejected APK; artifact was not published' }
  New-Item -ItemType Directory -Force -Path "$projectRoot/artifacts" | Out-Null
  $artifact = "$projectRoot/artifacts/Mathmyth-v$Version-debug.apk"
  Copy-Item -LiteralPath $sourceApk -Destination $artifact -Force
  Write-Output "APK: $artifact"
  & node --input-type=module -e "import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; console.log('SHA256: '+createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));" $artifact
  if ($LASTEXITCODE -ne 0) { throw 'Cannot calculate APK checksum' }
} finally { Pop-Location }
