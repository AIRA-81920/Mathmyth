// E5：字节 → base64 的唯一实现，供主线程与备份 Worker 共用。
// 分块拼接避免 String.fromCharCode(...大数组) 爆栈；纯函数，便于单测覆盖大输入。
export function encodeBase64Chunked(bytes) {
  const CHUNK = 0x8000;
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)));
  }
  return btoa(chunks.join(''));
}
