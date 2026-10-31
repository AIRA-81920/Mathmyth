// 更新检查：只读 GitHub Releases 的一个公开接口，不需要服务器，也不需要 token。
// 未登录调用有「60 次/小时/IP」的限流，但我们只在用户点「检查更新」时查，
// 外加最多 14 天一次的后台静默检查，碰不到限流；真碰上了也一律静默。
export const UPDATE_REPO = 'AIRA-81920/Mathmyth';
export const AUTO_CHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
const LAST_CHECKED_KEY = 'mathmyth.update.lastCheckedAt';
const PENDING_KEY = 'mathmyth.update.pending';

export function latestReleaseUrl(repo = UPDATE_REPO) {
  return 'https://api.github.com/repos/' + repo + '/releases/latest';
}

export function versionParts(value) {
  return String(value ?? '').trim().replace(/^v/i, '').split(/[.+-]/).map((part) => {
    const number = Number.parseInt(part, 10);
    return Number.isFinite(number) ? number : 0;
  });
}

// 逐段比数字：'3.10.0' 比 '3.9.0' 新。直接按字符串比会答错。
export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export function readRelease(payload) {
  const tag = typeof payload?.tag_name === 'string' ? payload.tag_name.trim() : '';
  if (!tag) return null;
  const apks = (Array.isArray(payload?.assets) ? payload.assets : []).filter((asset) => typeof asset?.browser_download_url === 'string'
    && /\.apk$/i.test(String(asset?.name || asset.browser_download_url)));
  // 同一版里若同时挂了 debug 和 release 包，优先给用户正式签名包。
  const apk = apks.find((asset) => !/debug/i.test(String(asset?.name || ''))) ?? apks[0];
  return {
    version: tag.replace(/^v/i, ''),
    notes: typeof payload?.body === 'string' ? payload.body.trim().slice(0, 1200) : '',
    downloadUrl: typeof apk?.browser_download_url === 'string' ? apk.browser_download_url : '',
    pageUrl: typeof payload?.html_url === 'string' ? payload.html_url : '',
  };
}

export function shouldAutoCheck(lastCheckedAt, now = Date.now()) {
  const stamp = Number(lastCheckedAt);
  if (!Number.isFinite(stamp) || stamp <= 0) return true;
  return now - stamp >= AUTO_CHECK_INTERVAL_MS;
}

function readNumber(storage, key) {
  try {
    const raw = storage?.getItem(key);
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeJson(storage, key, value) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch { /* 存储不可用不该影响使用 */ }
}

export function readLastChecked(storage = globalThis.localStorage) {
  return readNumber(storage, LAST_CHECKED_KEY);
}

export function readPendingUpdate(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PENDING_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.version === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function savePendingUpdate(release, storage = globalThis.localStorage) {
  writeJson(storage, PENDING_KEY, release ?? null);
}

// status: available | current | none(仓库还没有 Release) | error
export async function checkForUpdate({
  current,
  repo = UPDATE_REPO,
  fetchImpl = (...args) => globalThis.fetch(...args),
  signal,
} = {}) {
  let response;
  try {
    response = await fetchImpl(latestReleaseUrl(repo), {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { status: 'error', reason: 'network' };
  }
  // 还没发过 Release 时 GitHub 回 404：这是"暂无更新"，不是错误。
  if (response.status === 404) return { status: 'none' };
  if (response.status === 403 || response.status === 429) return { status: 'error', reason: 'rate-limit' };
  if (!response.ok) return { status: 'error', reason: 'http-' + response.status };
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', reason: 'invalid-json' };
  }
  const release = readRelease(payload);
  if (!release) return { status: 'error', reason: 'invalid-release' };
  return compareVersions(release.version, current) > 0
    ? { status: 'available', release }
    : { status: 'current', release };
}

// 启动时的静默检查：先记时间再发请求，避免一次失败后每次启动都打网络。
export async function autoCheck({
  current,
  storage = globalThis.localStorage,
  now = Date.now(),
  ...rest
} = {}) {
  if (!shouldAutoCheck(readLastChecked(storage), now)) return null;
  writeJson(storage, LAST_CHECKED_KEY, now);
  const result = await checkForUpdate({ current, ...rest });
  if (result.status === 'available') savePendingUpdate(result.release, storage);
  return result;
}
