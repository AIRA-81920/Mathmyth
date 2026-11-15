<#
  一键启动安卓模拟器并装上本项目的 APK。

  默认行为：
    1. 找到项目内置的 SDK（.android-sdk），找不到就用 $env:ANDROID_HOME
    2. 模拟器没开就开机（默认显卡渲染 -gpu host），已在跑就直接用
    3. 挑一个 debug 包：artifacts/Mathmyth-*-debug.apk，有多个就让你选；
       一个都没有就现打一个（npm run android:build）
    4. 装上并拉起 app.mathmyth.mobile，最后打印设备/包信息

  常用参数：
    -Release            装正式包（artifacts/Mathmyth-*-release.apk），不是 debug 包
    -Apk <路径>         指定某个 APK，跳过挑选
    -NoInstall          只开机，不装任何包
    -Wipe               先卸载再装（要干净数据时用）
    -Avd mathmyth-qa    指定 AVD 名字
    -Gpu host           渲染方式（host / swiftshader_indirect / off）
#>
param(
  [string]$Avd = 'mathmyth-qa',
  [string]$Apk,
  [switch]$Release,
  [switch]$NoInstall,
  [switch]$Wipe,
  [string]$Gpu = 'host',
  [string]$SdkPath,
  [int]$BootTimeoutSec = 240
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $SdkPath) {
  $local = Join-Path $projectRoot '.android-sdk'
  $SdkPath = if (Test-Path -LiteralPath (Join-Path $local 'emulator')) { $local } else { $env:ANDROID_HOME }
}
if (-not $SdkPath -or -not (Test-Path -LiteralPath (Join-Path $SdkPath 'emulator'))) {
  throw '找不到 Android SDK。用 -SdkPath 指定，或把项目自带的 .android-sdk 放回 frontend/ 下。'
}
$emulator = Join-Path $SdkPath 'emulator/emulator.exe'
$adb = Join-Path $SdkPath 'platform-tools/adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw "找不到 adb：$adb" }

# adb 会把 "* daemon started successfully"、安装失败原因写到 stderr。
# PowerShell 5.1 在 ErrorActionPreference=Stop 下会把它当终止性错误，
# 于是"签名不一致 -> 先卸载再装"这条兜底永远走不到。统一在这里吞掉 stderr。
function Invoke-Adb {
  param([string[]]$Arguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return (& $adb @Arguments 2>&1 | Out-String) } finally { $ErrorActionPreference = $previous }
}

function Get-Devices {
  @((Invoke-Adb @('devices')) -split "`n" | Select-Object -Skip 1 |
    Where-Object { $_ -match '\sdevice\s*$' } |
    ForEach-Object { ($_ -split '\s+')[0].Trim() } |
    Where-Object { $_ })
}

$device = Get-Devices | Where-Object { $_ -like 'emulator-*' } | Select-Object -First 1
if ($device) {
  Write-Host "模拟器已经在跑：$device"
} else {
  Write-Host "启动模拟器 $Avd（-gpu $Gpu），最多等 $BootTimeoutSec 秒…"
  Start-Process -FilePath $emulator -ArgumentList '-avd', $Avd, '-gpu', $Gpu, '-no-boot-anim' -WorkingDirectory $SdkPath | Out-Null
  $deadline = (Get-Date).AddSeconds($BootTimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $device = Get-Devices | Where-Object { $_ -like 'emulator-*' } | Select-Object -First 1
    if (-not $device) { continue }
    if ((Invoke-Adb @('-s', $device, 'shell', 'getprop', 'sys.boot_completed')).Trim() -eq '1') { break }
  }
  if (-not $device) { throw "等了 $BootTimeoutSec 秒还没看到模拟器设备，看看模拟器窗口有没有报错。" }
  Write-Host "开机完成：$device"
}

if ($NoInstall) { Write-Host '按要求只开机，不装包。'; exit 0 }

function Pick-Apk {
  if ($Apk) {
    if (-not (Test-Path -LiteralPath $Apk)) { throw "指定的 APK 不存在：$Apk" }
    return (Resolve-Path -LiteralPath $Apk).Path
  }
  $pattern = if ($Release) { 'Mathmyth-*-release.apk' } else { 'Mathmyth-*-debug.apk' }
  $artifacts = Join-Path $projectRoot 'artifacts'
  $found = @(Get-ChildItem -Path $artifacts -Filter $pattern -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($found.Count -eq 0) {
    if ($Release) { throw "artifacts/ 下没有正式包。先跑：scripts/build-package.ps1 -Target android -Version <版本> -NoPrompt -Release" }
    Write-Host '没有 debug 包，先打一个（npm run android:build）…'
    Push-Location $projectRoot
    try { & npm run android:build } finally { Pop-Location }
    $found = @(Get-ChildItem -Path $artifacts -Filter 'Mathmyth-*-debug.apk' -File | Sort-Object LastWriteTime -Descending)
    if ($found.Count -eq 0) { throw '打包结束了却没看到 debug 包，检查构建输出。' }
  }
  if ($found.Count -eq 1) { return $found[0].FullName }
  if ($found.Count -gt 8) {
    Write-Host "（artifacts/ 下有 $($found.Count) 个，只列最近的 8 个）" -ForegroundColor DarkGray
    $found = @($found | Select-Object -First 8)
  }
  Write-Host ''
  Write-Host '可用的安装包：' -ForegroundColor Cyan
  for ($i = 0; $i -lt $found.Count; $i += 1) {
    $item = $found[$i]
    $size = [math]::Round($item.Length / 1MB, 1)
    Write-Host ("  [{0}] {1}  {2} MB  {3}" -f ($i + 1), $item.Name, $size, $item.LastWriteTime.ToString('MM-dd HH:mm'))
  }
  while ($true) {
    $answer = Read-Host "选一个（1-$($found.Count)），直接回车用第 1 个"
    if (-not $answer) { return $found[0].FullName }
    if ($answer -match '^\d+$' -and [int]$answer -ge 1 -and [int]$answer -le $found.Count) { return $found[[int]$answer - 1].FullName }
    Write-Host '没看懂这个答案，再输一次。'
  }
}

$chosen = Pick-Apk
Write-Host "安装：$chosen"

if ($Wipe) { Write-Host ((Invoke-Adb @('-s', $device, 'uninstall', 'app.mathmyth.mobile')).Trim()) }

$result = Invoke-Adb @('-s', $device, 'install', '-r', $chosen)
if ($result -notmatch 'Success') {
  if ($result -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match|INSTALL_FAILED_VERSION_DOWNGRADE') {
    Write-Host '和模拟器上已装的签名/版本对不上（debug 包 vs 正式包，或版本更低），要先卸载——模拟器里这个 App 的数据会一起清掉。' -ForegroundColor Yellow
    Write-Host ((Invoke-Adb @('-s', $device, 'uninstall', 'app.mathmyth.mobile')).Trim())
    $result = Invoke-Adb @('-s', $device, 'install', '-r', $chosen)
  }
  if ($result -notmatch 'Success') { throw "装不上：$($result.Trim())" }
}
Write-Host '安装成功' -ForegroundColor Green

Invoke-Adb @('-s', $device, 'shell', 'am', 'start', '-n', 'app.mathmyth.mobile/.MainActivity') | Out-Null
Start-Sleep -Seconds 2
$dump = Invoke-Adb @('-s', $device, 'shell', 'dumpsys', 'package', 'app.mathmyth.mobile')
$versionName = ([regex]::Match($dump, 'versionName=([^\s]+)')).Groups[1].Value
$versionCode = ([regex]::Match($dump, 'versionCode=(\d+)')).Groups[1].Value
Write-Host ''
Write-Host "设备：$device"
Write-Host "版本：$versionName（versionCode $versionCode）"
Write-Host '已拉起 Mathmyth，去模拟器窗口里操作就行。'
