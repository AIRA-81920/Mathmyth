import { ImageInputError, readImageFile } from './input.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;

// Coordinates stay relative to the decoded image, so viewport resizing never
// changes the selected pixels. The source and preview use the same EXIF-aware
// browser decoder; no second, manual EXIF rotation is applied.
export function normalizeCrop(rect, { minWidth = 0, minHeight = 0 } = {}) {
  const width = clamp(number(rect?.width, 1), clamp(minWidth, 0, 1), 1);
  const height = clamp(number(rect?.height, 1), clamp(minHeight, 0, 1), 1);
  return {
    x: clamp(number(rect?.x, 0), 0, 1 - width),
    y: clamp(number(rect?.y, 0), 0, 1 - height), width, height,
  };
}

export function moveCrop(rect, deltaX, deltaY) {
  return normalizeCrop({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY });
}

export function resizeCrop(rect, corner, deltaX, deltaY, minimum = {}) {
  const start = normalizeCrop(rect, minimum);
  const minWidth = clamp(number(minimum.minWidth, 0), 0, 1);
  const minHeight = clamp(number(minimum.minHeight, 0), 0, 1);
  let left = start.x, right = start.x + start.width;
  let top = start.y, bottom = start.y + start.height;
  if (corner.includes('w')) left = clamp(left + deltaX, 0, right - minWidth);
  if (corner.includes('e')) right = clamp(right + deltaX, left + minWidth, 1);
  if (corner.includes('n')) top = clamp(top + deltaY, 0, bottom - minHeight);
  if (corner.includes('s')) bottom = clamp(bottom + deltaY, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function cropBetweenPoints(start, end, minimum = {}) {
  return normalizeCrop({
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
  }, minimum);
}

export function cropPixelBounds(rect, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new ImageInputError('图片尺寸无效，请重新选择。', 'invalid_image_size');
  }
  const normalized = normalizeCrop(rect);
  const x = clamp(Math.floor(normalized.x * width), 0, width - 1);
  const y = clamp(Math.floor(normalized.y * height), 0, height - 1);
  const right = clamp(Math.ceil((normalized.x + normalized.width) * width), x + 1, width);
  const bottom = clamp(Math.ceil((normalized.y + normalized.height) * height), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('已取消裁切', 'AbortError');
}

export async function decodeCropImage(dataUrl, { signal } = {}) {
  checkAbort(signal);
  if (!dataUrl?.startsWith('data:image/')) throw new ImageInputError('无法读取原图，请重新选择。', 'invalid_crop_image');
  const image = new Image();
  await new Promise((resolve, reject) => {
    const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); image.src = ''; reject(new DOMException('已取消裁切', 'AbortError')); };
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new ImageInputError('这张图片无法打开，请重新选择。', 'crop_decode_failed')); };
    signal?.addEventListener('abort', abort, { once: true });
    image.src = dataUrl;
  });
  checkAbort(signal);
  if (!image.naturalWidth || !image.naturalHeight) throw new ImageInputError('图片尺寸无效，请重新选择。', 'invalid_image_size');
  return image;
}

function encodeCanvasCrop(image, bounds, signal) {
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width; canvas.height = bounds.height;
  return (async () => {
    try {
      checkAbort(signal);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      checkAbort(signal);
      if (!blob) throw new Error('canvas_encode_failed');
      return blob;
    } finally { canvas.width = 0; canvas.height = 0; }
  })();
}

async function encodeWorkerCrop(image, bounds, signal) {
  // Rasterize the same EXIF-aware decoded image as the fallback. Creating a
  // bitmap directly from a JPEG Image can take a different browser colour path;
  // creating it from the selected canvas preserves the existing crop pixels.
  const selected = document.createElement('canvas');
  selected.width = bounds.width; selected.height = bounds.height;
  let bitmap;
  try {
    const context = selected.getContext('2d');
    if (!context) throw new Error('canvas_unavailable');
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    bitmap = await createImageBitmap(selected);
  } finally { selected.width = 0; selected.height = 0; }
  let worker;
  try {
    checkAbort(signal);
    worker = new Worker(new URL('./crop.worker.js', import.meta.url), { type: 'module' });
    return await new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
      const fail = (error) => { cleanup(); reject(error); };
      const abort = () => fail(new DOMException('已取消裁切', 'AbortError'));
      worker.onerror = () => fail(new Error('crop_worker_unavailable'));
      worker.onmessageerror = () => fail(new Error('crop_worker_unavailable'));
      worker.onmessage = ({ data }) => {
        if (!(data?.blob instanceof Blob) || data.blob.type !== 'image/png') return fail(new Error('crop_worker_encode_failed'));
        cleanup(); resolve(data.blob);
      };
      signal?.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ bitmap }, [bitmap]); } catch (error) { fail(error); }
    });
  } finally {
    worker?.terminate();
    bitmap.close();
  }
}

export async function encodeCropPng(image, bounds, { signal, useWorker = true } = {}) {
  checkAbort(signal);
  // Small crops do not need the cost of starting a worker. Older Android
  // WebViews without these APIs retain the asynchronous canvas export path.
  if (useWorker && bounds.width * bounds.height >= 2_000_000 && typeof Worker === 'function'
    && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function') {
    try { return await encodeWorkerCrop(image, bounds, signal); }
    catch (error) { checkAbort(signal); if (error.name === 'AbortError') throw error; }
  }
  return encodeCanvasCrop(image, bounds, signal);
}

export async function cropImageAttachment(attachment, rect, { signal, decodedImage, useWorker = true } = {}) {
  checkAbort(signal);
  const source = attachment.cropSource || attachment;
  const image = decodedImage || await decodeCropImage(source.dataUrl, { signal });
  const bounds = cropPixelBounds(rect, image.naturalWidth, image.naturalHeight);
  // Avoid unsafe canvas allocations, and never silently reduce resolution.
  if (bounds.width * bounds.height > 32_000_000) {
    throw new ImageInputError('裁切区域超过 3200 万像素，请缩小选区后重试。', 'crop_too_large');
  }
  try {
    const blob = await encodeCropPng(image, bounds, { signal, useWorker });
    checkAbort(signal);
    if (!blob) throw new Error('canvas_encode_failed');
    const name = `${(source.name || '题目').replace(/\.[^.]+$/, '')}-裁切.png`;
    const result = await readImageFile(new File([blob], name, { type: 'image/png' }), { signal });
    checkAbort(signal);
    return { ...result, kind: 'image', ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}), cropSource: source, cropRect: normalizeCrop(rect) };
  } catch (error) {
    checkAbort(signal);
    if (error.userMessage) throw error;
    throw new ImageInputError('裁切失败，原图仍然保留。请缩小选区后重试。', 'crop_failed');
  }
}

export function submissionAttachment(attachment) {
  const { cropSource, cropRect, documentImage, ...result } = attachment;
  return result;
}

export function matchesPendingPhoto(attachment, photo) {
  return Boolean((photo.id && (attachment.id === photo.id || attachment.cropSource?.id === photo.id))
    || (photo.uri && attachment.sourceUri === photo.uri));
}
