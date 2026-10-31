#!/usr/bin/env node
// 出货 APK 核对：R8(minify+shrink) 会按可达性删代码、改类名、裁注解。
// 这里逐名核对"被反射调用的东西"是否真的还在包里——它防的就是相机闪退那一类：
// getPermissionStates() 读不到 @CapacitorPlugin(permissions=...)，getPermissionState() 返回 null。
// 用法：node scripts/verify-release-apk.mjs [apkPath]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const apk = resolve(process.argv[2] ?? 'artifacts/Mathmyth-v' + JSON.parse(readFileSync('package.json', 'utf8')).version + '-release.apk');
const sdk = process.env.ANDROID_HOME ?? resolve(projectRoot, '.android-sdk');
const findTool = (name) => {
  const dir = resolve(sdk, 'build-tools');
  if (!existsSync(dir)) return null;
  for (const version of readdirSync(dir).sort().reverse()) {
    const candidate = resolve(dir, version, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};
const dexdump = findTool('dexdump.exe') ?? findTool('dexdump');
const aapt2 = findTool('aapt2.exe') ?? findTool('aapt2');
if (!existsSync(apk)) { console.error('找不到 APK：' + apk); process.exit(2); }
if (!dexdump || !aapt2) { console.error('找不到 aapt2 / dexdump，检查 ANDROID_HOME'); process.exit(2); }

const run = (command, args) => new Promise((res, rej) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', () => {});
  child.on('error', rej);
  child.on('close', (code) => code === 0 ? res(out) : rej(new Error(command + ' failed (' + code + ')')));
});

// 1) 期望值来自源码，而不是手抄清单
const plugins = JSON.parse(readFileSync('android/app/src/main/assets/capacitor.plugins.json', 'utf8'));
const javaDir = 'android/app/src/main/java/app/mathmyth/mobile';
const sources = readdirSync(javaDir).filter((name) => name.endsWith('.java')).map((name) => ({ name, text: readFileSync(resolve(javaDir, name), 'utf8') }));
const ours = [];
for (const source of sources) {
  const plugin = source.text.match(/@CapacitorPlugin\(\s*name\s*=\s*"([^"]+)"/);
  if (!plugin) continue;
  const methods = [...source.text.matchAll(/@PluginMethod\s+(?:public\s+)?void\s+(\w+)\s*\(/g)].map((m) => m[1]);
  const callbacks = [...source.text.matchAll(/@PermissionCallback\s+(?:private|public\s+)?void\s+(\w+)\s*\(/g)].map((m) => m[1]);
  const permissions = [...source.text.matchAll(/@Permission\(([^)]*)\)/g)].map((m) => m[1])
    .map((body) => ({ alias: (body.match(/alias\s*=\s*"([^"]+)"/) ?? [])[1], strings: [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((x) => x.includes('permission.')) }))
    .filter((entry) => entry.alias);
  ours.push({ className: 'app.mathmyth.mobile.' + source.name.replace(/\.java$/, ''), name: plugin[1], methods, callbacks, permissions });
}
const expectedClasses = [...plugins.map((entry) => entry.classpath), ...ours.map((entry) => entry.className)];

// 2) 解包：dex 与清单
const unzipTo = '.qa/verify-apk';
await run('powershell', ['-NoProfile', '-Command',
  "Remove-Item -Recurse -Force '" + unzipTo + "' -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force '" + unzipTo + "' | Out-Null; " +
  "Add-Type -A System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('" + apk + "'); " +
  "$z.Entries | Where-Object { $_.FullName -match '^classes[0-9]*\.dex$' -or $_.FullName -eq 'assets/capacitor.config.json' } | ForEach-Object { " +
  "$target=Join-Path '" + unzipTo + "' ($_.FullName -replace '/','_'); [IO.Compression.ZipFileExtensions]::ExtractToFile($_,$target,$true) }; $z.Dispose()"]);
const dexFiles = readdirSync(unzipTo).filter((name) => name.endsWith('.dex')).map((name) => resolve(unzipTo, name));
if (!dexFiles.length) { console.error('APK 里没有 classes.dex'); process.exit(2); }

// 3) 逐类解析 dex：类名 → 方法名集合，以及全量注解文本
const classes = new Map();
let annotations = '';
for (const file of dexFiles) {
  const dump = await run(dexdump, ['-a', file]);
  annotations += dump;
  let current = null;
  for (const line of dump.split(/\r?\n/)) {
    const descriptor = line.match(/Class descriptor\s*:\s*'(L[^']+;)'/);
    if (descriptor) { current = descriptor[1].slice(1, -1).replace(/\//g, '.'); if (!classes.has(current)) classes.set(current, new Set()); continue; }
    const name = line.match(/^\s+name\s*:\s*'([^']+)'/);
    if (name && current) classes.get(current).add(name[1]);
  }
}

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
for (const className of expectedClasses) check(classes.has(className), '插件类被裁掉/改名：' + className);
for (const plugin of ours) {
  const members = classes.get(plugin.className) ?? new Set();
  for (const method of plugin.methods) check(members.has(method), plugin.className + ' 少了 @PluginMethod 方法：' + method);
  for (const callback of plugin.callbacks) check(members.has(callback), plugin.className + ' 少了 @PermissionCallback 方法：' + callback);
  check(annotations.includes('name="' + plugin.name + '"'), '注解里的插件名丢了：' + plugin.name);
  for (const permission of plugin.permissions) {
    check(annotations.includes('"' + permission.alias + '"'), plugin.className + ' 的权限别名丢了：' + permission.alias);
    for (const value of permission.strings) check(annotations.includes(value), plugin.className + ' 的权限字符串丢了：' + value);
  }
}

// 4) 清单与出货配置
const badging = await run(aapt2, ['dump', 'badging', apk]);
check(/^package:/m.test(badging), '清单读不出来');
check(!/application-debuggable/.test(badging), '这是 debuggable 包');
const permissionsInApk = await run(aapt2, ['dump', 'permissions', apk]);
for (const plugin of ours) for (const permission of plugin.permissions) for (const value of permission.strings) {
  if (value.endsWith('READ_EXTERNAL_STORAGE')) continue;   // 老系统专用，SDK 33+ 会按 maxSdkVersion 收掉
  check(permissionsInApk.includes(value), '清单缺少插件需要的权限：' + value);
}
const config = JSON.parse(readFileSync(resolve(unzipTo, 'assets_capacitor.config.json'), 'utf8'));
check(config?.android?.webContentsDebuggingEnabled !== true, '出货配置打开了 WebView 远程调试');

if (failures.length) {
  console.error('出货 APK 核对失败（' + failures.length + ' 项）：');
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log('出货 APK 核对通过：' + expectedClasses.length + ' 个插件类、' + ours.reduce((sum, item) => sum + item.methods.length + item.callbacks.length, 0) + ' 个反射方法、' + ours.reduce((sum, item) => sum + item.permissions.length, 0) + ' 组权限别名');
