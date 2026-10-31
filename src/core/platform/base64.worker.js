import { encodeBase64Chunked } from './base64.js';

// E5：整库备份的 base64 编码放进 Worker。50MB+ 的库在主线程上拼字符串会直接卡住
// 界面（甚至 OOM），放到 Worker 后主线程保持可响应。结果与主线程编码完全一致。
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, base64: encodeBase64Chunked(new Uint8Array(data.bytes)) });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error) });
  }
};
