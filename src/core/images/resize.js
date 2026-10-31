// 入库前的图片压缩：长边降采样至 ≤1600px，并重新编码为真实 JPEG（q0.85）。
//
// 设计要点：
// 1. 只在具备 createImageBitmap 的浏览器环境下生效。Node 单测环境与过旧的
//    WebView 缺少该 API 时返回 null，调用方保持原图原格式（与裁切 worker 的
//    降级策略一致：宁可不压缩，也不能阻断用户上传）。
// 2. 长边已经 ≤1600px 的 JPEG 跳过重编码，避免无谓的二次有损转换；但 PNG/WebP 这类
//    无损格式即使尺寸达标也一律重编码 —— 同等画面的无损照片常常是 JPEG 的十倍体积。
// 3. 动图（GIF）跳过，避免只保留首帧而丢掉动画。
// 4. 压缩产出的是真实 JPEG 字节，绝不只是改写声明的 MIME——下游 engine 会
//    用字节头校验 MIME（inferImageMime），声明与内容必须一致。
export const MAX_IMAGE_SIDE = 1600;
export const COMPRESS_QUALITY = 0.85;
const SKIP_MIME = new Set(['image/gif']);

function checkAbort(signal) {
  if (signal?.aborted) throw Object.assign(new Error('已取消压缩图片。'), { name: 'AbortError' });
}

// 把位图按目标尺寸编码成 JPEG Blob；优先 OffscreenCanvas（可离线合成），
// 回退到普通 canvas，两者都不可用时返回 null。
async function encodeJpeg(bitmap, width, height, quality) {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  if (typeof globalThis.document?.createElement !== 'function') return null;
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
}

// 返回 { blob, mime } 或 null。null 表示"无需或无法压缩，请保持原图"。
export async function compressImage(file, {
  signal, mime, maxSide = MAX_IMAGE_SIDE, quality = COMPRESS_QUALITY,
} = {}) {
  if (typeof globalThis.createImageBitmap !== 'function') return null;
  if (mime && SKIP_MIME.has(mime)) return null;
  checkAbort(signal);
  let bitmap;
  try { bitmap = await globalThis.createImageBitmap(file); }
  catch { return null; } // 解码失败不阻断上传，直接按原图入库
  try {
    const longest = Math.max(bitmap.width || 0, bitmap.height || 0);
    if (!longest) return null;
    const oversized = longest > maxSide;
    // D1：无损格式（PNG/WebP）即使长边已达标也要重编码 —— 用户真实库里 1436×751 的
    // PNG 就有 1.44MB，远超"每张 ≤500KB"的目标。只有"已是 JPEG 且长边达标"才跳过。
    if (!oversized && mime !== 'image/png' && mime !== 'image/webp') return null;
    const scale = oversized ? maxSide / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const blob = await encodeJpeg(bitmap, width, height, quality);
    checkAbort(signal);
    if (!blob || !blob.size) return null;
    return { blob, mime: 'image/jpeg' };
  } catch (error) {
    checkAbort(signal); // 取消必须继续上抛，不能被这里的兜底吞掉
    return null;
  } finally {
    bitmap.close?.();
  }
}
