import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CHECK_INTERVAL_MS, autoCheck, checkForUpdate, compareVersions, latestReleaseUrl,
  readLastChecked, readPendingUpdate, readRelease, savePendingUpdate, shouldAutoCheck, versionParts,
} from '../src/core/update/check.js';

const DAY = 24 * 60 * 60 * 1000;
const json = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const release = (tag, extra = {}) => json({ tag_name: tag, body: '修好了横线', html_url: 'https://github.com/x/y/releases/tag/' + tag, assets: [], ...extra });

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    size: () => map.size,
  };
}

test('版本比较按数字逐段比，不是按字符串', () => {
  assert.equal(compareVersions('3.10.0', '3.9.0'), 1);
  assert.equal(compareVersions('3.9.0', '3.10.0'), -1);
  assert.equal(compareVersions('v3.8.7', '3.8.7'), 0);
  assert.equal(compareVersions('3.8.7', '3.8.7.0'), 0);
  assert.equal(compareVersions('4', '3.99.99'), 1);
  assert.deepEqual(versionParts('v3.10.2'), [3, 10, 2]);
});

test('Release 的 tag 去掉 v 前缀，优先挑 apk 附件', () => {
  const parsed = readRelease({
    tag_name: 'v3.9.0',
    body: '  更新说明  ',
    html_url: 'https://github.com/o/r/releases/tag/v3.9.0',
    assets: [
      { name: 'latest.json', browser_download_url: 'https://example.com/latest.json' },
      { name: 'Mathmyth-v3.9.0-release.apk', browser_download_url: 'https://example.com/app.apk' },
    ],
  });
  assert.equal(parsed.version, '3.9.0');
  assert.equal(parsed.notes, '更新说明');
  assert.equal(parsed.downloadUrl, 'https://example.com/app.apk');
  assert.equal(readRelease({}), null);
  // 没有 apk 附件时留空，界面回退到 Release 页面
  assert.equal(readRelease({ tag_name: 'v1', html_url: 'https://p' }).downloadUrl, '');
});

test('同时挂了 debug 和 release 包时，优先给正式签名包', () => {
  const parsed = readRelease({
    tag_name: 'V3.1',
    assets: [
      { name: 'Mathmyth-v3.1.0-debug.apk', browser_download_url: 'https://e/debug.apk' },
      { name: 'Mathmyth-v3.1.0-release.apk', browser_download_url: 'https://e/release.apk' },
      { name: 'Mathmyth-v3.1.0-Setup.exe', browser_download_url: 'https://e/setup.exe' },
    ],
  });
  assert.equal(parsed.downloadUrl, 'https://e/release.apk');
  // 只有 debug 包时也得能用（这就是仓库里现在那个 Release 的样子）
  assert.equal(readRelease({ tag_name: 'V3.1', assets: [{ name: 'Mathmyth-v3.1.0-debug.apk', browser_download_url: 'https://e/debug.apk' }] }).downloadUrl, 'https://e/debug.apk');
});

test('有新版本、已是最新、仓库还没 Release，三种情况分得清', async () => {
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => release('v3.9.0') })).status, 'available');
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => release('3.8.7') })).status, 'current');
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => release('v3.8.6') })).status, 'current');
  // 404 = 还没有任何 Release，不是错误，界面上要显示"暂无更新"而不是红字
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => json({}, 404) })).status, 'none');
});

test('限流、网络断开、坏 JSON 都只返回 error，不抛异常', async () => {
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => json({}, 403) })).status, 'error');
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => json({}, 500) })).status, 'error');
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => { throw new Error('offline'); } })).status, 'error');
  assert.equal((await checkForUpdate({ current: '3.8.7', fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new Error('bad'); } }) })).status, 'error');
});

test('请求的是 releases/latest，且不带任何凭据', async () => {
  let seen;
  await checkForUpdate({ current: '3.8.7', repo: 'o/r', fetchImpl: async (url, options) => { seen = { url, options }; return release('v9.9.9'); } });
  assert.equal(seen.url, 'https://api.github.com/repos/o/r/releases/latest');
  assert.equal(seen.options.credentials, 'omit');
  assert.equal(seen.options.headers.Authorization, undefined);
  assert.equal(latestReleaseUrl('a/b'), 'https://api.github.com/repos/a/b/releases/latest');
});

test('自动检查间隔是 14 天，边界两侧都对齐', () => {
  assert.equal(AUTO_CHECK_INTERVAL_MS, 14 * DAY);
  const now = 1_800_000_000_000;
  assert.equal(shouldAutoCheck(0, now), true);
  assert.equal(shouldAutoCheck(now - 13.9 * DAY, now), false);
  assert.equal(shouldAutoCheck(now - 14 * DAY, now), true);
  assert.equal(shouldAutoCheck(now - 20 * DAY, now), true);
});

test('静默检查先记时间再发请求，失败也不会每次启动都联网', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('offline'); };
  const now = 1_800_000_000_000;
  const first = await autoCheck({ current: '3.8.7', storage, now, fetchImpl });
  assert.equal(first.status, 'error');
  assert.equal(calls, 1);
  assert.equal(readLastChecked(storage), now);
  // 同一天再启动一次：不发请求
  assert.equal(await autoCheck({ current: '3.8.7', storage, now: now + DAY, fetchImpl }), null);
  assert.equal(calls, 1);
  // 14 天后再启动：又查一次
  await autoCheck({ current: '3.8.7', storage, now: now + 14 * DAY, fetchImpl });
  assert.equal(calls, 2);
});

test('发现新版时落盘，设置页下次打开就能显示', async () => {
  const storage = memoryStorage();
  const now = 1_800_000_000_000;
  const result = await autoCheck({ current: '3.8.7', storage, now, fetchImpl: async () => release('v3.9.0', { body: '新题库' }) });
  assert.equal(result.status, 'available');
  assert.equal(readPendingUpdate(storage).version, '3.9.0');
  savePendingUpdate(null, storage);
  assert.equal(readPendingUpdate(storage), null);
  // 存储坏掉时不能崩
  assert.equal(readPendingUpdate({ getItem: () => '{oops' }), null);
});
