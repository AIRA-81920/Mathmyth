param([string]$SdkPath, [string]$JdkPath, [string]$Version, [int]$VersionCode = 0, [switch]$NoPrompt, [switch]$Release)
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
  $buildType = if ($Release) { 'release' } else { 'debug' }
  if ($Release) {
    # 没有凭据就不许打 release：否则 gradle 会产出一个未签名的 apk，
    # 装到手机上会被系统直接拒绝，或者更糟——被打上"来路不明"的标签发出去。
    if (-not (Test-Path -LiteralPath "$projectRoot/android/keystore.properties")) {
      throw 'android/keystore.properties is missing. A release APK must be signed; restore the keystore + passwords first.'
    }
  }
  Push-Location "$projectRoot/android"
  try { & .\gradlew.bat "assemble$($buildType.Substring(0,1).ToUpper())$($buildType.Substring(1))" --no-daemon; if ($LASTEXITCODE -ne 0) { throw 'APK build failed' } }
  finally { Pop-Location }
  $sourceApk = "$projectRoot/android/app/build/outputs/apk/$buildType/app-$buildType.apk"
  & node scripts/credential-guard.mjs $sourceApk
  if ($LASTEXITCODE -ne 0) { throw 'Credential guard rejected APK; artifact was not published' }
  if ($Release) {
    # 发布前硬校验两件事：签名是不是我们的、包里还能不能调试。
    $apksigner = Get-ChildItem -Path "$env:ANDROID_HOME/build-tools" -Filter 'apksigner.bat' -Recurse | Sort-Object FullName | Select-Object -Last 1
    if (-not $apksigner) { throw 'apksigner not found; cannot verify the release signature' }
    $certs = & $apksigner.FullName verify --print-certs $sourceApk 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Release APK signature check failed: $certs" }
    $signer = ($certs | Select-String -Pattern 'Signer #1 certificate DN').ToString()
    if ($signer -match 'Android Debug') { throw 'Release APK is signed with the debug key; refusing to publish' }
    Write-Output $signer
    $aapt2 = Get-ChildItem -Path "$env:ANDROID_HOME/build-tools" -Filter 'aapt2.exe' -Recurse | Sort-Object FullName | Select-Object -Last 1
    if ($aapt2) {
      $badging = & $aapt2.FullName dump badging $sourceApk 2>&1
      if ($badging -match 'application-debuggable') { throw 'Release APK is still marked debuggable; refusing to publish' }
      Write-Output 'Release APK is not debuggable.'
    }
  }
  if ($Release) {
    # R8 改了名，崩溃堆栈要靠这一版 mapping.txt 才能反混淆，按版本归档。
    $mapping = "$projectRoot/android/app/build/outputs/mapping/release/mapping.txt"
    if (Test-Path -LiteralPath $mapping) {
      New-Item -ItemType Directory -Force -Path "$projectRoot/artifacts/mapping" | Out-Null
      Copy-Item -LiteralPath $mapping -Destination "$projectRoot/artifacts/mapping/Mathmyth-v$Version-mapping.txt" -Force
      Write-Output "mapping: artifacts/mapping/Mathmyth-v$Version-mapping.txt"
    } else {
      throw 'mapping.txt is missing; crash traces from this build could not be decoded'
    }
  }
  if ($Release) {
    # R8 会按可达性删代码、改类名、裁注解。这里逐名核对"被反射调用"的东西
    # （插件类、@PluginMethod、@PermissionCallback、权限别名、清单权限、调试开关），
    # 不通过就不许出包——相机闪退就是缺这一步才漏出去的。核对放在拷贝之前，
    # 失败时 artifacts 里不会留下坏包。
    & node scripts/verify-release-apk.mjs $sourceApk
    if ($LASTEXITCODE -ne 0) { throw 'Release APK verification failed; artifact was not published' }
  }
  New-Item -ItemType Directory -Force -Path "$projectRoot/artifacts" | Out-Null
  $artifact = "$projectRoot/artifacts/Mathmyth-v$Version-$buildType.apk"
  Copy-Item -LiteralPath $sourceApk -Destination $artifact -Force
  Write-Output "APK: $artifact"
  & node --input-type=module -e "import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; console.log('SHA256: '+createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'));" $artifact
  if ($LASTEXITCODE -ne 0) { throw 'Cannot calculate APK checksum' }

} finally { Pop-Location }
