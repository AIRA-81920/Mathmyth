import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('release 包必须保留 Capacitor 的权限注解，否则相机插件会在 takePhoto 里空指针闪退', async () => {
  const rules = await read('../android/app/proguard-rules.pro');
  // getPermissionStates() 反射读 @CapacitorPlugin(permissions = ...)，被 R8 裁掉就得到空表，
  // getPermissionState("camera") 变成 null：相机插件当场崩进程，媒体插件则永远读不到相册。
  assert.match(rules, /-keep class com\.getcapacitor\.\*\* \{ \*; \}/);
  assert.match(rules, /RuntimeVisibleAnnotations/);
  assert.match(rules, /-keepattributes[^\n]*\*Annotation\*/);
  assert.match(rules, /-keep class com\.capacitorjs\.plugins\.\*\* \{ \*; \}/);
  assert.match(rules, /-keep class app\.mathmyth\.mobile\.\*\* \{ \*; \}/);
});

test('Android 清单必须声明 CAMERA，否则相机插件跳过运行时申请就直接开相机', async () => {
  const manifest = await read('../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /<uses-permission android:name="android\.permission\.CAMERA" \/>/);
  assert.match(manifest, /android\.permission\.READ_MEDIA_IMAGES/);
  assert.match(manifest, /android\.hardware\.camera/);
});

test('出货配置不能打开 WebView 远程调试', async () => {
  for (const path of ['../capacitor.config.json', '../android/app/src/main/assets/capacitor.config.json']) {
    const config = await read(path);
    assert.doesNotMatch(config, /webContentsDebuggingEnabled\s*:\s*true/, path);
  }
});
