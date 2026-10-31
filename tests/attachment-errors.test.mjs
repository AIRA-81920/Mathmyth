import test from 'node:test';
import assert from 'node:assert/strict';
import * as CFB from 'cfb';
import { extractDocx } from '../src/core/files/docx.js';
import { extractLegacyWord } from '../src/core/files/legacyWord.js';
import { readAttachment } from '../src/core/files/input.js';

const chineseError = error => {
  assert.match(error.message, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(error.message, /invalid zip data|RangeError|encoding|DataView/i);
  return true;
};
test('invalid DOCX archive reports an actionable Chinese error', () => {
  assert.throws(() => extractDocx(new Uint8Array([1,2,3,4,5,6,7,8])), chineseError);
});
test('truncated legacy Word stream reports a Chinese error before reading offsets', async () => {
  const archive = CFB.utils.cfb_new();
  CFB.utils.cfb_add(archive, 'WordDocument', new Uint8Array([0xec,0xa5]));
  await assert.rejects(extractLegacyWord(new Uint8Array(CFB.write(archive, { type: 'buffer' }))), chineseError);
});
test('invalid legacy Word container reports a Chinese error', async () => {
  await assert.rejects(extractLegacyWord(new Uint8Array([0xd0,0xcf,0,0])), chineseError);
});
test('invalid text bytes report an actionable Chinese encoding error', async () => {
  await assert.rejects(readAttachment(new File([new Uint8Array([0x81])], 'invalid.txt')), chineseError);
});
test('BOM-less UTF-16LE Chinese math text is decoded correctly', async () => {
  const [file] = await readAttachment(new File([Buffer.from('数学', 'utf16le')], 'math.txt'));
  assert.equal(file.text, '数学');
});
test('BOM-less UTF-16LE with ASCII math and Chinese is decoded correctly', async () => {
  const [file] = await readAttachment(new File([Buffer.from('求极限 x = 1', 'utf16le')], 'math.txt'));
  assert.equal(file.text, '求极限 x = 1');
});
test('ordinary UTF-8 and ASCII attachments are not misdetected as UTF-16', async () => {
  for (const text of ['abcd', '求极限 x = 1', 'sin(x)/x', 'This is a math problem.']) {
    const [file] = await readAttachment(new File([text], 'math.txt'));
    assert.equal(file.text, text);
  }
});
test('incomplete UTF-16 with BOM fails rather than inserting a replacement character', async () => {
  await assert.rejects(readAttachment(new File([new Uint8Array([0xff,0xfe,0x70])], 'invalid.txt')), chineseError);
});
