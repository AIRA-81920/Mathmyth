// 备份档案里的图片降采样：导出前把保留下来的图片（收藏图）重编码为真实 JPEG
//（长边 ≤1600、q0.85），让备份体积不再取决于用户拍照/裁切的原始分辨率。
//
// 设计要点（与入库压缩 resize.js 保持同一套策略）：
// 1. 只在具备 createImageBitmap + OffscreenCanvas 的环境生效。数据库 Worker 在
//    Chromium / 现代 WebView 上具备；Node 单测与老旧 WebView 缺少时返回 null，
//    调用方保持原图 —— 宁可不压，也不能阻断导出。
// 2. 动图（GIF）跳过，避免只留首帧丢掉动画。
// 3. 已经满足「是 JPEG 且长边 ≤1600」的图无需重编码。
// 4. 产出的是真实 JPEG 字节，声明的 mime 同步改为 image/jpeg（下游按字节头校验）。
export const BACKUP_IMAGE_SIDE = 1600;
export const BACKUP_IMAGE_QUALITY = 0.85;
const SKIP_MIME = new Set(['image/gif']);

export async function reencodeBackupImage(bytes, mime, {
  maxSide = BACKUP_IMAGE_SIDE, quality = BACKUP_IMAGE_QUALITY,
} = {}) {
  if (typeof globalThis.createImageBitmap !== 'function' || typeof globalThis.OffscreenCanvas !== 'function') return null;
  if (SKIP_MIME.has(mime)) return null;
  let bitmap;
  try { bitmap = await globalThis.createImageBitmap(new Blob([bytes], { type: mime })); }
  catch { return null; } // 解码失败不阻断导出，直接保持原图
  try {
    const longest = Math.max(bitmap.width || 0, bitmap.height || 0);
    if (!longest) return null;
    const scale = longest > maxSide ? maxSide / longest : 1;
    if (scale === 1 && mime === 'image/jpeg') return null;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new globalThis.OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const out = new Uint8Array(await blob.arrayBuffer());
    return out.length ? { bytes: out, mime: 'image/jpeg' } : null;
  } catch { return null; }
  finally { bitmap.close?.(); }
}
