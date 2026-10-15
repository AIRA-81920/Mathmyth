import * as CFB from 'cfb';

// Word 97–2007: read the main text story through FibRgFcLcb.fcClx and PlcPcd.
// Embedded Equation Editor objects/diagrams cannot safely be flattened to text.
export async function extractLegacyWord(bytes) {
  if (bytes[0] !== 0xd0 || bytes[1] !== 0xcf) {
    const value = new TextDecoder().decode(bytes);
    if (/^\s*(?:<!doctype html|<html)/i.test(value)) {
      const template=document.createElement('template');template.innerHTML=value;
      if(template.content.querySelector('img,svg,object,math'))throw new Error('Word 含图形或嵌入公式，请另存为 PDF 后发送。');
      template.content.querySelectorAll('script,style').forEach(node=>node.remove());
      return template.content.textContent;
    }
    throw new Error('旧版 Word 格式无法读取，请另存为 .docx 或 PDF。');
  }
  const file = CFB.read(bytes, { type: 'buffer' });
  const stream = (name) => { const value = file.FileIndex.find((entry) => entry.name === name)?.content; return value ? Uint8Array.from(value) : null; };
  const word = stream('WordDocument');
  if (!word) throw new Error('不是有效的 Word 文档。');
  const data = new DataView(word.buffer, word.byteOffset, word.byteLength);
  if (data.getUint16(0, true) !== 0xa5ec || data.getUint16(2, true) < 0xc1) throw new Error('请将此旧版 Word 另存为 .docx 或 PDF。');
  const flags = data.getUint16(10, true);
  if (flags & 0x8100) throw new Error('Word 文件已加密，请先解除密码保护。');
  const table = stream(flags & 0x200 ? '1Table' : '0Table');
  if (!table) throw new Error('Word 文件缺少文本索引。');
  let position = 32;
  const words = data.getUint16(position, true); position += 2 + words * 2;
  const longs = data.getUint16(position, true); position += 2;
  const textLength = data.getUint32(position + 3 * 4, true);
  position += longs * 4;
  const count = data.getUint16(position, true); position += 2;
  if (count <= 33) throw new Error('Word 文本索引不完整。');
  const fcClx = data.getUint32(position + 33 * 8, true), lcbClx = data.getUint32(position + 33 * 8 + 4, true);
  const td = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let cursor = fcClx;
  while (cursor < fcClx + lcbClx && table[cursor] === 1) cursor += 3 + td.getUint16(cursor + 1, true);
  if (table[cursor] !== 2) throw new Error('Word 文本索引损坏。');
  const size = td.getUint32(cursor + 1, true), pieces = (size - 4) / 12;
  cursor += 5;
  if (!Number.isInteger(pieces) || pieces < 0 || cursor + size > table.length) throw new Error('Word 文本索引损坏。');
  let text = '';
  for (let index = 0; index < pieces; index++) {
    const start = td.getUint32(cursor + index * 4, true), end = Math.min(textLength, td.getUint32(cursor + (index + 1) * 4, true));
    if (start >= textLength) break;
    const fc = td.getUint32(cursor + (pieces + 1) * 4 + index * 8 + 2, true);
    const compressed = Boolean(fc & 0x40000000), offset = (fc & 0x3fffffff) / (compressed ? 2 : 1);
    const length = (end - start) * (compressed ? 1 : 2);
    if (end < start || offset + length > word.length) throw new Error('Word 文本内容损坏。');
    text += new TextDecoder(compressed ? 'windows-1252' : 'utf-16le').decode(word.subarray(offset, offset + length));
  }
  if (/[\u0001\u0008]/.test(text)) throw new Error('旧版 Word 含嵌入公式或图形，请另存为 PDF 或 .docx 后发送，以保留题面。');
  return text.replace(/\r/g, '\n').replace(/\u0007/g, '\t').replace(/[\u0000-\u0006\u000b-\u001f]/g, '').trim();
}
