import test from 'node:test';
import assert from 'node:assert/strict';
import { readImageFile, dataUrlToBytes } from '../src/core/images/input.js';

// Real 2x2 image fixtures, created once with Pillow; tests have no dependencies.
const fixtures = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC',
  jpeg: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDx+iiigD//2Q==',
  gif: 'R0lGODdhAgACAIEAACAgIAAAAAAAAAAAACwAAAAAAgACAAAIBgABCAQQEAA7',
  webp: 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAUAmJaQAA3AA/vsXQAA=',
};
const bytesOf = (base64) => Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));

test('real PNG, JPEG, GIF and WebP retain their exact original bytes through base64 round-trip', async () => {
  const ids = new Set();
  for (const [kind, base64] of Object.entries(fixtures)) {
    const original = bytesOf(base64);
    const result = await readImageFile(new File([original], `题目.${kind}`, { type: `image/${kind}` }));
    assert.equal(result.mime, `image/${kind}`);
    assert.equal(result.name, `题目.${kind}`);
    assert.deepEqual(result.bytes, original);
    assert.equal(result.dataUrl, `data:image/${kind};base64,${base64}`);
    assert.deepEqual(dataUrlToBytes(result.dataUrl), original);
    assert.ok(result.id);
    assert.ok(!ids.has(result.id));
    ids.add(result.id);
  }
});

test('header overrides a wrong declared MIME and camera Blob with no name or MIME receives a usable name', async () => {
  const bytes = bytesOf(fixtures.png);
  const mislabeled = await readImageFile(new File([bytes], '相机.jpg', { type: 'image/jpeg' }));
  assert.equal(mislabeled.mime, 'image/png');
  const cameraBlob = await readImageFile(new Blob([bytes]));
  assert.equal(cameraBlob.mime, 'image/png');
  assert.match(cameraBlob.name, /^图片-.+\.png$/);
});

test('declared images, SVG and truncated headers cannot masquerade as accepted images', async () => {
  for (const bytes of [new TextEncoder().encode('not an image'), new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)]) {
    await assert.rejects(readImageFile(new File([bytes], 'fake.png', { type: 'image/png' })), (error) => {
      assert.equal(error.code, 'unsupported_image');
      assert.equal(error.userMessage, error.message);
      return true;
    });
  }
});

test('empty images, declared oversized files and actual oversized reads are rejected', async () => {
  await assert.rejects(readImageFile(new Blob([])), (error) => error.code === 'empty_image');
  await assert.rejects(readImageFile(new Blob([bytesOf(fixtures.png)]), { maxBytes: 10 }), (error) => {
    assert.equal(error.code, 'image_too_large');
    assert.match(error.userMessage, /10 B/);
    return true;
  });
  await assert.rejects(readImageFile({ size: 1, arrayBuffer: async () => bytesOf(fixtures.png).buffer }, { maxBytes: 10 }), (error) => error.code === 'image_too_large');
});

test('read failures are friendly and do not expose raw paths or errors', async () => {
  await assert.rejects(readImageFile({ arrayBuffer: async () => { throw new Error('secret-private-path'); } }), (error) => {
    assert.equal(error.code, 'read_failed');
    assert.ok(!error.userMessage.includes('secret-private-path'));
    return true;
  });
  await assert.rejects(readImageFile(null), (error) => error.code === 'read_failed');
});

test('cancelled reads cannot start or return a late image', async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(readImageFile({ arrayBuffer() { assert.fail('must not read'); } }, { signal: before.signal }), (error) => error.name === 'AbortError');
  const during = new AbortController();
  let finishRead;
  const pending = readImageFile({ arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; }) }, { signal: during.signal });
  during.abort();
  finishRead(bytesOf(fixtures.png).buffer);
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('base64 encoder handles a file larger than a safe function argument chunk', async () => {
  const large = new Uint8Array(200_000);
  large.set(bytesOf(fixtures.jpeg));
  const result = await readImageFile(new Blob([large]));
  assert.deepEqual(dataUrlToBytes(result.dataUrl), large);
});

test('data URL decoder rejects unsupported MIME, invalid base64 and mismatched headers', () => {
  for (const value of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,??==', `data:image/jpeg;base64,${fixtures.png}`, 'data:image/png;base64,AA==', null]) {
    assert.throws(() => dataUrlToBytes(value), (error) => typeof error.userMessage === 'string');
  }
});

test('native data URL conversion preserves verified MIME and stops cancelled FileReader work', async () => {
  const previous = globalThis.FileReader;
  let reader, mode = 'finish';
  globalThis.FileReader = class {
    constructor() { reader = this; }
    readAsDataURL(file) {
      assert.ok(file instanceof Blob);
      if (mode === 'finish') queueMicrotask(() => { this.result = `data:image/jpeg;base64,${fixtures.png}`; this.onload(); });
    }
    abort() { this.cancelled = true; }
  };
  try {
    const accepted = await readImageFile(new File([bytesOf(fixtures.png)], '错误扩展名.jpg', { type: 'image/jpeg' }));
    assert.equal(accepted.dataUrl, `data:image/png;base64,${fixtures.png}`);
    assert.deepEqual(dataUrlToBytes(accepted.dataUrl), bytesOf(fixtures.png));
    mode = 'wait';
    const controller = new AbortController();
    const pending = readImageFile(new Blob([bytesOf(fixtures.png)]), { signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
    assert.equal(reader.cancelled, true);
    assert.equal(reader.onload, null);
    assert.equal(reader.onerror, null);
    assert.equal(reader.onabort, null);
  } finally { globalThis.FileReader = previous; }
});
