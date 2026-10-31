import test from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlToBytes, readImageFile } from '../src/core/images/input.js';
import { MAX_IMAGE_SIDE } from '../src/core/images/resize.js';

// 真实 2x2 图片夹具（与 image-input.test.mjs 相同，测试无外部依赖）。
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC'), (value) => value.charCodeAt(0));
const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDx+iiigD//2Q=='), (value) => value.charCodeAt(0));

// 一张"声明上很大"的图片：字节头是合法 PNG（含非零 IHDR 尺寸），长度远超触发压缩的
// 体量。解码交给下面注入的假 createImageBitmap，因此不需要真实的大图。
function oversizedPng(size = 3_000_000) {
  const bytes = new Uint8Array(size);
  bytes.set(png.subarray(0, 33), 0);
  return bytes;
}

async function withFakeEncoder({ width, height, drawn = [], quality = [] }, run) {
  const originals = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas };
  globalThis.createImageBitmap = async () => ({ width, height, close() { this.closed = true; } });
  globalThis.OffscreenCanvas = class {
    constructor(canvasWidth, canvasHeight) { this.width = canvasWidth; this.height = canvasHeight; }
    getContext() { return { drawImage: (bitmap, x, y, w, h) => { drawn.push([w, h]); } }; }
    convertToBlob(options) { quality.push(options.quality); return Promise.resolve(new Blob([jpeg], { type: 'image/jpeg' })); }
  };
  try { return await run(); }
  finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
}

test('an oversized photo is downscaled to the long side limit and stored as real JPEG bytes', async () => {
  const drawn = [], quality = [];
  await withFakeEncoder({ width: 4000, height: 3000, drawn, quality }, async () => {
    const result = await readImageFile(new File([oversizedPng()], '题目.png', { type: 'image/png' }));
    assert.deepEqual(drawn, [[MAX_IMAGE_SIDE, 1200]], '按长边等比缩放到 1600x1200');
    assert.deepEqual(quality, [0.85]);
    // 真的是 JPEG 字节，而不只是改了声明的 MIME。
    assert.equal(result.mime, 'image/jpeg');
    assert.equal(result.name, '题目.jpg');
    assert.deepEqual(result.bytes, jpeg);
    assert.equal(result.dataUrl.startsWith('data:image/jpeg;base64,'), true);
    assert.deepEqual(dataUrlToBytes(result.dataUrl), jpeg);
  });
});

test('a portrait photo uses the long side too, and lossless images are re-encoded even when small', async () => {
  const drawn = [];
  await withFakeEncoder({ width: 900, height: 2400, drawn }, async () => {
    await readImageFile(new File([oversizedPng()], '竖图.png', { type: 'image/png' }));
    assert.deepEqual(drawn, [[600, MAX_IMAGE_SIDE]]);
  });
  const small = [];
  await withFakeEncoder({ width: 100, height: 80, drawn: small }, async () => {
    // D1：PNG 是无损格式，长边达标也要重编码（保持原分辨率，只换编码）；
    // 只有"已经是 JPEG 且长边达标"才真正跳过，避免无谓的二次有损压缩。
    const converted = await readImageFile(new File([png], '小题.png', { type: 'image/png' }));
    assert.deepEqual(small, [[100, 80]], 'PNG 保持原分辨率、只换编码');
    assert.equal(converted.mime, 'image/jpeg');
    assert.equal(converted.name, '小题.jpg');
    const kept = await readImageFile(new File([jpeg], '小照.jpg', { type: 'image/jpeg' }));
    assert.deepEqual(small, [[100, 80]], 'JPEG 长边达标时不再重编码');
    assert.equal(kept.mime, 'image/jpeg');
    assert.deepEqual(kept.bytes, jpeg);
  });
});

test('without a decoding API the original bytes survive untouched, so旧 WebView 与单测都安全', async () => {
  assert.equal(typeof globalThis.createImageBitmap, 'undefined', '本用例依赖 Node 没有该 API');
  const original = oversizedPng(200_000);
  const result = await readImageFile(new File([original], '原图.png', { type: 'image/png' }));
  assert.equal(result.mime, 'image/png');
  assert.equal(result.name, '原图.png');
  assert.deepEqual(result.bytes, original);
  assert.deepEqual(dataUrlToBytes(result.dataUrl), original);
});
