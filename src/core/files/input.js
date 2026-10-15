import { readImageFile } from '../images/input.js';

const abort = (signal) => { if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError'); };
export const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.txt,.md,.csv,.docx,.doc,.pdf';
const MAX_SIZE = 25 * 1024 * 1024;
function decodeText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}

export async function readAttachment(file, { signal, supportsImage, onProgress = () => {} } = {}) {
  abort(signal);
  if (/\.(png|jpe?g|gif|webp)$/i.test(file.name) || file.type?.startsWith('image/')) {
    if (!supportsImage) throw new Error('请在设置中确认模型支持图片后勾选图片能力。');
    return [{ ...await readImageFile(file, { signal }), kind: 'image' }];
  }
  if (!file.size || file.size > MAX_SIZE) throw new Error('附件需小于 25 MiB，且不能是空文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  abort(signal);
  let text = '', images = [];
  const extension = file.name.split('.').pop().toLowerCase();
  if (['txt','md','csv'].includes(extension) || file.type === 'text/plain') text = decodeText(bytes);
  else if (extension === 'docx') {
    const { extractDocx } = await import('./docx.js');
    const result = extractDocx(bytes); text = result.text;
    if (result.images.length && !supportsImage) throw new Error('Word 含图片或图形，请开启图片能力后发送，或改用纯文本题面。');
    images = await Promise.all(result.images.map(async (image) => ({ ...await readImageFile(image, { signal }), kind: 'image' })));
  } else if (extension === 'pdf') {
    const { extractPdf } = await import('./pdf.js');
    ({ text, images } = await extractPdf(bytes.slice(), { signal, supportsImage, onProgress }));
  } else if (extension === 'doc') {
    const { extractLegacyWord } = await import('./legacyWord.js');
    text = await extractLegacyWord(bytes);
  } else throw new Error('支持图片、纯文本、Word 和 PDF 文件。');
  abort(signal);
  if (!text.trim() && !images.length) throw new Error('附件中没有可读取的题面。');
  if (text.length > 80000) throw new Error('附件文字超过 8 万字，请只发送需要提问的部分。');
  return [{ id: crypto.randomUUID(), kind: 'document', name: file.name, mime: file.type || `application/${extension}`, bytes, text }, ...images];
}
