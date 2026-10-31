import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase64Chunked } from '../src/core/platform/base64.js';

// E5：备份导出用的分块 base64 编码必须与参考实现逐字节一致，覆盖分块边界
//（0x8000 一块）前后的各种长度，避免出现"大库导出后文件损坏"这类问题。
test('backup base64 encoding matches the reference encoder across chunk boundaries', () => {
  for (const size of [0, 1, 2, 0x7fff, 0x8000, 0x8001, 0x10000, 200_000]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 31 + 7) % 256);
    assert.equal(encodeBase64Chunked(bytes), Buffer.from(bytes).toString('base64'), `size ${size}`);
  }
});

test('backup base64 encoding round-trips the exact original bytes', () => {
  const bytes = Uint8Array.from({ length: 90_000 }, (_, index) => index % 251);
  const encoded = encodeBase64Chunked(bytes);
  assert.deepEqual(Uint8Array.from(Buffer.from(encoded, 'base64')), bytes);
});
