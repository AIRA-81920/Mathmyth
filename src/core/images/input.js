const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const MIME_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export class ImageInputError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ImageInputError';
    this.userMessage = message;
    this.code = code;
  }
}

function checkAbort(signal) {
  if (!signal?.aborted) return;
  const error = new ImageInputError('已取消读取图片。', 'aborted');
  error.name = 'AbortError';
  throw error;
}

function matches(bytes, offset, signature) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint32(bytes, offset, littleEndian = false) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian);
}

// File.type and the filename are hints only. These checks inspect the original
// bytes and container header; no canvas conversion or re-encoding is performed.
function detectedMime(bytes) {
  if (bytes.length >= 33 && matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])
    && uint32(bytes, 8) === 13 && ascii(bytes, 12, 4) === 'IHDR'
    && uint32(bytes, 16) > 0 && uint32(bytes, 20) > 0) return 'image/png';
  if (bytes.length >= 4 && matches(bytes, 0, [255, 216, 255]) && bytes[3] !== 0) return 'image/jpeg';
  if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))
    && (bytes[6] | bytes[7] << 8) > 0 && (bytes[8] | bytes[9] << 8) > 0) return 'image/gif';
  if (bytes.length >= 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(bytes, 12, 4))) {
    const containerSize = uint32(bytes, 4, true) + 8;
    const firstChunkSize = uint32(bytes, 16, true);
    if (containerSize <= bytes.length && firstChunkSize > 0
      && 20 + firstChunkSize + firstChunkSize % 2 <= containerSize) return 'image/webp';
  }
  throw new ImageInputError('请选择有效的 JPEG、PNG、GIF 或 WebP 图片。暂不支持 SVG。', 'unsupported_image');
}

function encodeBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

// Native FileReader avoids expanding a large PNG into millions of JavaScript
// characters on the UI thread. Keep the byte-based path for non-browser callers.
async function imageDataUrl(file, bytes, mime, signal) {
  if (typeof FileReader !== 'function' || typeof Blob !== 'function' || !(file instanceof Blob)) {
    return `data:${mime};base64,${encodeBase64(bytes)}`;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => { reader.onload = null; reader.onerror = null; reader.onabort = null; signal?.removeEventListener('abort', abort); };
    const abort = () => {
      cleanup(); reader.abort();
      const error = new ImageInputError('已取消读取图片。', 'aborted'); error.name = 'AbortError'; reject(error);
    };
    reader.onload = () => {
      const value = reader.result; cleanup();
      if (typeof value !== 'string' || !value.includes(',')) return reject(new ImageInputError('图片读取失败，请重新选择。', 'read_failed'));
      // File.type is only a hint; the accepted MIME was verified from bytes.
      resolve(`data:${mime};base64,${value.slice(value.indexOf(',') + 1)}`);
    };
    reader.onerror = () => { cleanup(); reject(new ImageInputError('图片读取失败，请重新选择。', 'read_failed')); };
    reader.onabort = abort;
    signal?.addEventListener('abort', abort, { once: true });
    try { reader.readAsDataURL(file); } catch { cleanup(); reject(new ImageInputError('图片读取失败，请重新选择。', 'read_failed')); }
  });
}

function limitLabel(maxBytes) {
  if (maxBytes >= 1024 * 1024) return `${Number((maxBytes / (1024 * 1024)).toFixed(2))} MiB`;
  if (maxBytes >= 1024) return `${Number((maxBytes / 1024).toFixed(2))} KiB`;
  return `${maxBytes} B`;
}

function checkSize(size, maxBytes) {
  if (size === 0) throw new ImageInputError('图片文件为空，请重新选择。', 'empty_image');
  if (size > maxBytes) {
    throw new ImageInputError(`图片超过大小限制（${limitLabel(maxBytes)}），请换一张较小的图片。`, 'image_too_large');
  }
}

function imageId() {
  return globalThis.crypto?.randomUUID?.() ?? `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// 20 MiB is an app input guard, not a claim about any provider's upload limit.
// Camera Blobs may have no type/name; their byte headers still determine MIME.
export async function readImageFile(file, { maxBytes = DEFAULT_MAX_BYTES, signal } = {}) {
  checkAbort(signal);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new ImageInputError('图片大小限制无效，请重试。', 'invalid_limit');
  }
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new ImageInputError('无法读取这张图片，请重新选择。', 'read_failed');
  }
  if (Number.isFinite(file.size)) checkSize(file.size, maxBytes);

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    checkAbort(signal);
    throw new ImageInputError('图片读取失败，请重新选择。', 'read_failed');
  }
  // Blob.arrayBuffer has no physical cancellation. Never return a late result.
  checkAbort(signal);
  checkSize(bytes.length, maxBytes);
  const mime = detectedMime(bytes);
  const id = imageId();
  const givenName = typeof file.name === 'string' ? file.name.trim().split(/[\\/]/).pop() : '';
  const name = givenName || `图片-${id.slice(0, 8)}.${MIME_EXTENSIONS[mime]}`;
  const dataUrl = await imageDataUrl(file, bytes, mime, signal);
  checkAbort(signal);
  return { id, name, mime, bytes, dataUrl };
}

// Storage can persist bytes rather than a larger base64 string. Only the four
// supported MIME types and a matching byte header are accepted on round-trip.
export function dataUrlToBytes(dataUrl) {
  const match = typeof dataUrl === 'string'
    ? /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    : null;
  if (!match || match[2].length % 4 !== 0) {
    throw new ImageInputError('图片数据无效，请重新选择图片。', 'invalid_data_url');
  }
  let bytes;
  try {
    const binary = atob(match[2]);
    bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
  } catch {
    throw new ImageInputError('图片数据无效，请重新选择图片。', 'invalid_data_url');
  }
  if (detectedMime(bytes) !== match[1]) {
    throw new ImageInputError('图片类型与内容不一致，请重新选择图片。', 'invalid_data_url');
  }
  return bytes;
}
