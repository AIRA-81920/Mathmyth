import { readImageFile } from '../images/input.js';

const abort = (signal) => { if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError'); };
export const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.txt,.md,.csv,.docx,.doc,.pdf';
const MAX_SIZE = 25 * 1024 * 1024;
function decodeText(bytes) {
  try {
    const decode = encoding => new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (bytes[0] === 255 && bytes[1] === 254) return decode('utf-16le');
    if (bytes[0] === 254 && bytes[1] === 255) return decode('utf-16be');
    if (bytes.length >= 4 && bytes.length % 2 === 0) {
      const pairs = Math.min(bytes.length / 2, 2048);
      let evenZero = 0, oddZero = 0;
      for (let index = 0; index < pairs; index++) {
        if (bytes[index * 2] === 0) evenZero++;
        if (bytes[index * 2 + 1] === 0) oddZero++;
      }
      if (oddZero / pairs > .2 && evenZero === 0) return decode('utf-16le');
      if (evenZero / pairs > .2 && oddZero === 0) return decode('utf-16be');
      // Pure Chinese UTF-16 need not contain any zero bytes (数学 is 70 65 66 5b).
      // Use conservative language evidence as a second heuristic, rather than
      // interpreting every even-length ASCII file as UTF-16.
      const common = /[数学求极限导函积分微方程证明计算已知设令当如果则为的在上下一二三四五六七八九十零正负无穷大于小等于连续可变常数]/g;
      const candidates = ['utf-16le','utf-16be'].map(encoding => {
        try {
          const text = decode(encoding), han = text.match(/\p{Script=Han}/gu) ?? [];
          const known = text.match(common) ?? [];
          return { text, score: han.length >= 2 && known.length / han.length >= .8 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text) ? known.length : 0 };
        } catch { return { score: 0 }; }
      }).sort((a, b) => b.score - a.score);
      if (candidates[0].score > 0 && candidates[0].score > candidates[1].score) return candidates[0].text;
    }
    try { return decode('utf-8'); }
    catch { return decode('gb18030'); }
  } catch { throw new Error('附件文字编码无法识别，请另存为 UTF-8 文本，或改用 PDF 后发送。'); }
}

// compress 透传给 readImageFile：显式传 null 表示「只读入、不压缩」，用于选图/拍照时
// 立刻出预览、把压缩推迟到真正发送那一刻；不传时由 readImageFile 用默认压缩实现。
export async function readAttachment(file, { signal, supportsImage, onProgress = () => {}, compress } = {}) {
  abort(signal);
  if (/\.(png|jpe?g|gif|webp)$/i.test(file.name) || file.type?.startsWith('image/')) {
    if (!supportsImage) throw new Error('请在设置中确认模型支持图片后勾选图片能力。');
    return [{ ...await readImageFile(file, { signal, compress }), kind: 'image' }];
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
    images = await Promise.all(result.images.map(async (image) => ({ ...await readImageFile(image, { signal, compress }), kind: 'image' })));
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
