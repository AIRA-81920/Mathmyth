import { Capacitor, registerPlugin } from '@capacitor/core';
const NativeFiles = registerPlugin('MathmythFiles');

function base64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(chunks.join(''));
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
    try { const result = await NativeFiles.saveBackup({ filename: name, data: base64(bytes) }); return result.saved ? '备份已导出。' : '已取消导出。'; }
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
