import test from 'node:test';
import assert from 'node:assert/strict';
import { cropBetweenPoints, cropImageAttachment, cropPixelBounds, decodeCropImage, encodeCropPng, matchesPendingPhoto, moveCrop, normalizeCrop, resizeCrop, submissionAttachment } from '../src/core/images/crop.js';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC'), (value) => value.charCodeAt(0));

test('recent native photos without ids match only their actual URI; desktop crops match their original id', () => {
  assert.equal(matchesPendingPhoto({ id: 'one' }, { uri: 'content://two' }), false);
  assert.equal(matchesPendingPhoto({ id: 'one', sourceUri: 'content://one' }, { uri: 'content://two' }), false);
  assert.equal(matchesPendingPhoto({ id: 'one', sourceUri: 'content://one' }, { uri: 'content://one' }), true);
  assert.equal(matchesPendingPhoto({ id: 'new', cropSource: { id: 'one' } }, { id: 'one' }), true);
  assert.equal(matchesPendingPhoto({ id: 'new' }, { id: 'one' }), false);
});

test('crop selections stay inside the image when dragged beyond every edge', () => {
  const rect = { x: .2, y: .3, width: .4, height: .2 };
  assert.deepEqual(moveCrop(rect, -10, 10), { x: 0, y: .8, width: .4, height: .2 });
  assert.deepEqual(moveCrop(rect, 10, -10), { x: .6, y: 0, width: .4, height: .2 });
  const tiny = normalizeCrop({ x: 3, y: -2, width: .001, height: .002 }, { minWidth: .1, minHeight: .2 });
  assert.deepEqual(tiny, { x: .9, y: 0, width: .1, height: .2 });
});

test('each resize handle preserves its opposite corner and cannot invert the crop', () => {
  const start = { x: .2, y: .2, width: .5, height: .5 }, minimum = { minWidth: .1, minHeight: .1 };
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    for (const delta of [-5, 5]) {
      const rect = resizeCrop(start, corner, delta, -delta, minimum);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.width >= .1 - 1e-12 && rect.height >= .1 - 1e-12);
      assert.ok(rect.x + rect.width <= 1 && rect.y + rect.height <= 1);
      if (corner.includes('w')) assert.ok(Math.abs(rect.x + rect.width - .7) < 1e-12);
      else assert.equal(rect.x, .2);
      if (corner.includes('n')) assert.ok(Math.abs(rect.y + rect.height - .7) < 1e-12);
      else assert.equal(rect.y, .2);
    }
  }
});

test('new selections work when dragging backwards; pixel bounds include the full selected edge', () => {
  assert.deepEqual(cropBetweenPoints({ x: .75, y: .8 }, { x: .25, y: .3 }), { x: .25, y: .3, width: .5, height: .5 });
  assert.deepEqual(cropPixelBounds({ x: .25, y: .125, width: .5, height: .5 }, 400, 800), { x: 100, y: 100, width: 200, height: 400 });
  assert.deepEqual(cropPixelBounds({ x: .999, y: .999, width: .001, height: .001 }, 2, 2), { x: 1, y: 1, width: 1, height: 1 });
  assert.throws(() => cropPixelBounds({}, 0, 100), (error) => error.code === 'invalid_image_size');
});

test('crop encoding uses original pixel dimensions and fresh bytes, while restoration source never enters the submitted attachment', async () => {
  const previous = globalThis.document;
  const drawCalls = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => drawCalls.push(args) }),
    toBlob: (resolve, type) => { assert.equal(type, 'image/png'); assert.equal(canvas.width, 200); assert.equal(canvas.height, 300); resolve(new Blob([png], { type })); } };
  globalThis.document = { createElement: () => canvas };
  try {
    const original = { id: 'original', kind: 'image', name: '相机照片.jpg', mime: 'image/jpeg', sourceUri: 'content://original', dataUrl: 'unused' };
    const decoded = { naturalWidth: 400, naturalHeight: 600 };
    const result = await cropImageAttachment(original, { x: .25, y: .25, width: .5, height: .5 }, { decodedImage: decoded });
    assert.deepEqual(drawCalls[0], [decoded, 100, 150, 200, 300, 0, 0, 200, 300]);
    assert.notEqual(result.id, original.id);
    assert.equal(result.name, '相机照片-裁切.png');
    assert.equal(result.mime, 'image/png');
    assert.deepEqual(result.bytes, png);
    assert.equal(result.cropSource, original);
    assert.equal(result.sourceUri, original.sourceUri);
    const submitted = submissionAttachment({ ...result, documentImage: false });
    assert.ok(!('cropSource' in submitted) && !('cropRect' in submitted) && !('documentImage' in submitted));
    assert.deepEqual(submitted.bytes, png);
    assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  } finally { globalThis.document = previous; }
});

test('late encoding after cancellation cannot replace the original staged image', async () => {
  const previous = globalThis.document;
  let finish;
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: (resolve) => { finish = resolve; } };
  globalThis.document = { createElement: () => canvas };
  try {
    const controller = new AbortController();
    const pending = cropImageAttachment({ id: 'original', name: '题目.png' }, { x: 0, y: 0, width: 1, height: 1 }, {
      decodedImage: { naturalWidth: 100, naturalHeight: 100 }, signal: controller.signal,
    });
    controller.abort(); finish(new Blob([png], { type: 'image/png' }));
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
    await assert.rejects(cropImageAttachment({}, {}, { decodedImage: { naturalWidth: 10000, naturalHeight: 10000 } }), (error) => error.code === 'crop_too_large');
  } finally { globalThis.document = previous; }
});

test('image decoding is cancelled and removes abort listeners without returning a late image', async () => {
  const previous = globalThis.Image;
  let created;
  globalThis.Image = class { constructor() { created = this; } set src(value) { this.source = value; } };
  try {
    const controller = new AbortController();
    const pending = decodeCropImage('data:image/png;base64,AAAA', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(created.source, ''); assert.equal(created.onload, null); assert.equal(created.onerror, null);
  } finally { globalThis.Image = previous; }
});

test('large crops encode once in a worker, and unsupported workers fall back without losing original pixels', async () => {
  const originals = Object.fromEntries(['Worker', 'OffscreenCanvas', 'createImageBitmap', 'document'].map((name) => [name, globalThis[name]]));
  const bounds = { x: 24, y: 48, width: 2000, height: 1600 }, decoded = { naturalWidth: 4000, naturalHeight: 3200 };
  const workers = [], bitmaps = [], draws = [];
  let failWorker = false, canvasEncodes = 0;
  globalThis.OffscreenCanvas = class {};
  globalThis.createImageBitmap = async (...arguments_) => {
    assert.deepEqual(arguments_, [canvas]);
    const bitmap = { close() { this.closed = true; } }; bitmaps.push(bitmap); return bitmap;
  };
  globalThis.Worker = class {
    constructor(url, options) { assert.ok(url.pathname.endsWith('crop.worker.js')); assert.equal(options.type, 'module'); workers.push(this); }
    postMessage(data, transfers) {
      assert.equal(data.bitmap, bitmaps.at(-1)); assert.deepEqual(transfers, [data.bitmap]);
      queueMicrotask(() => this.onmessage({ data: failWorker ? { error: 'unsupported' } : { blob: new Blob([png], { type: 'image/png' }) } }));
    }
    terminate() { this.terminated = true; }
  };
  const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }),
    toBlob: (resolve) => { canvasEncodes++; assert.equal(canvas.width, bounds.width); assert.equal(canvas.height, bounds.height); resolve(new Blob([png], { type: 'image/png' })); } };
  globalThis.document = { createElement: () => canvas };
  try {
    const result = await encodeCropPng(decoded, bounds);
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), png);
    assert.equal(canvasEncodes, 0);
    assert.equal(workers[0].terminated, true); assert.equal(bitmaps[0].closed, true);
    failWorker = true;
    const fallback = await encodeCropPng(decoded, bounds);
    assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()), png);
    assert.equal(canvasEncodes, 1);
    assert.deepEqual(draws[0], [decoded, 24, 48, 2000, 1600, 0, 0, 2000, 1600]);
    assert.equal(workers[1].terminated, true); assert.equal(bitmaps[1].closed, true);
    assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  } finally { for (const [name, value] of Object.entries(originals)) globalThis[name] = value; }
});

test('cancelling a worker crop terminates encoding and never falls back or returns a late PNG', async () => {
  const originals = Object.fromEntries(['Worker', 'OffscreenCanvas', 'createImageBitmap', 'document'].map((name) => [name, globalThis[name]]));
  let worker;
  const bitmap = { close() { this.closed = true; } };
  globalThis.OffscreenCanvas = class {};
  globalThis.createImageBitmap = async () => bitmap;
  globalThis.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob() { assert.fail('cancelled worker must never start a fallback encode'); } };
  globalThis.document = { createElement: () => canvas };
  try {
    const controller = new AbortController();
    const pending = encodeCropPng({}, { x: 0, y: 0, width: 2000, height: 1600 }, { signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(worker.terminated, true); assert.equal(bitmap.closed, true);
    assert.equal(worker.onmessage, null);
  } finally { for (const [name, value] of Object.entries(originals)) globalThis[name] = value; }
});
