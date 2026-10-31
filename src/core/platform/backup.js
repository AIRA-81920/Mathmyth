import { Capacitor, registerPlugin } from '@capacitor/core';
import { encodeBase64Chunked } from './base64.js';
const NativeFiles = registerPlugin('MathmythFiles');

// E5：整库备份的 base64 编码优先放进 Worker。50MB+ 的库在主线程上拼 base64 会直接
// 卡住界面（峰值内存也会翻倍），放到 Worker 后主线程保持可响应。传输的是字节副本
//（不动调用方手里的数组）；Worker 不可用（旧 WebView、Node 单测）时退回主线程分块
// 编码，两条路径结果完全一致。
function encodeBackupBase64(bytes) {
  if (typeof Worker !== 'function') return Promise.resolve(encodeBase64Chunked(bytes));
  return new Promise((resolve) => {
    let worker;
    try { worker = new Worker(new URL('./base64.worker.js', import.meta.url), { type: 'module' }); }
    catch { resolve(encodeBase64Chunked(bytes)); return; }
    const id = 'backup';
    const finish = (value) => { worker.terminate(); resolve(value); };
    worker.onmessage = ({ data }) => finish(data?.id === id && typeof data.base64 === 'string' ? data.base64 : encodeBase64Chunked(bytes));
    worker.onerror = () => finish(encodeBase64Chunked(bytes));
    worker.onmessageerror = () => finish(encodeBase64Chunked(bytes));
    worker.postMessage({ id, bytes: bytes.slice().buffer });
  });
}

export async function exportBackupFile(bytes) {
  const name = `Mathmyth-${new Date().toISOString().slice(0,10)}.sqlite`;
  if (globalThis.mathmythDesktop) {
    try { return (await globalThis.mathmythDesktop.saveBackup(bytes,name)).saved ? '备份已导出。' : '已取消导出。'; }
    catch { throw Object.assign(new Error(),{userMessage:'暂时没能导出文件，请重试。'}); }
  }
  if (Capacitor.isNativePlatform()) {
    // Android Storage Access Framework writes directly to the user-selected
    // document, including local Downloads, without a share-target dependency.
    try { const result = await NativeFiles.saveBackup({ filename: name, data: await encodeBackupBase64(bytes) }); return result.saved ? '备份已导出。' : '已取消导出。'; }
    catch (error) {
      const failure = new Error('暂时没能导出文件，请重试。'); failure.userMessage = failure.message; throw failure;
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.sqlite3' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return '备份已导出。';
}
