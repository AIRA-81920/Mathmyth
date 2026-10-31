import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { DOMParser as XMLParser } from '@xmldom/xmldom';
import katex from 'katex';
import { extractDocx } from '../src/core/files/docx.js';

globalThis.DOMParser = class {
  parseFromString(xml) {
    const document = new XMLParser().parseFromString(xml, 'application/xml');
    document.querySelector = name => document.getElementsByTagName(name)[0] ?? null;
    return document;
  }
};
const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const zip = body => zipSync({ 'word/document.xml': strToU8(`<w:document ${ns}><w:body>${body}</w:body></w:document>`) });
const t = value => `<m:r><m:t>${value}</m:t></m:r>`;
const e = value => `<m:e>${value}</m:e>`;
const formula = value => extractDocx(zip(`<w:p><m:oMath>${value}</m:oMath></w:p>`)).text;
function check(value, expected) {
  const actual = formula(value);
  assert.equal(actual, `$${expected}$`);
  assert.doesNotThrow(() => katex.renderToString(actual.slice(1, -1), { throwOnError: true }));
}
for (const [name, left, right, latexLeft, latexRight] of [
  ['absolute', '|', '|', '|', '|'], ['norm', '‖', '‖', '\\Vert', '\\Vert'],
  ['square', '[', ']', '[', ']'], ['braces', '{', '}', '\\{', '\\}'],
  ['angle', '⟨', '⟩', '\\langle', '\\rangle'], ['invisible', '', '', '.', '.'],
]) test(`Word preserves ${name} delimiters`, () => {
  check(`<m:d><m:dPr><m:begChr m:val="${left}"/><m:endChr m:val="${right}"/></m:dPr>${e(t('x'))}</m:d>`, `\\left${latexLeft} x\\right${latexRight}`);
});
test('Word delimiter separators retain every operand', () => {
  check(`<m:d><m:dPr><m:sepChr m:val=","/></m:dPr>${e(t('a'))}${e(t('b'))}</m:d>`, '\\left( a,b\\right)');
});
for (const [name, symbol, command, low, high] of [
  ['integral', '∫', '\\int', '0', '1'], ['double integral', '∬', '\\iint', 'D', ''],
  ['sum', '∑', '\\sum', 'i=1', 'n'], ['product', '∏', '\\prod', 'k=1', 'n'],
  ['contour', '∮', '\\oint', 'C', ''], ['union', '⋃', '\\bigcup', 'i=1', 'n'],
  ['intersection', '⋂', '\\bigcap', 'i=1', 'n'],
]) test(`Word preserves ${name} operator and limits`, () => {
  check(`<m:nary><m:naryPr><m:chr m:val="${symbol}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${t(low)}</m:sub><m:sup>${t(high)}</m:sup>${e(t('x'))}</m:nary>`, `${command}\\limits${low ? `_{${low}}` : ''}${high ? `^{${high}}` : ''} x`);
});
test('Word hidden superscript is omitted and subSup is explicit', () => {
  check(`<m:nary><m:naryPr><m:supHide m:val="1"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub>${t('0')}</m:sub><m:sup>${t('1')}</m:sup>${e(t('x'))}</m:nary>`, '\\int\\nolimits_{0} x');
});
test('Word hidden subscript is omitted', () => {
  check(`<m:nary><m:naryPr><m:subHide/></m:naryPr><m:sub>${t('0')}</m:sub>${e(t('x'))}</m:nary>`, '\\int x');
});
test('Word nested fraction preserves absolute value', () => {
  check(`<m:f><m:num><m:d><m:dPr><m:begChr m:val="|"/><m:endChr m:val="|"/></m:dPr>${e(t('x'))}</m:d></m:num><m:den>${t('c')}</m:den></m:f>`, '\\frac{\\left| x\\right|}{c}');
});
test('Word combined scripts can contain fractions', () => {
  check(`<m:sSubSup>${e(t('x'))}<m:sub>${t('i')}</m:sub><m:sup><m:f><m:num>${t('1')}</m:num><m:den>${t('2')}</m:den></m:f></m:sup></m:sSubSup>`, '{x}_{i}^{\\frac{1}{2}}');
});
test('Word matrix retains cells and row breaks', () => {
  check(`<m:m><m:mr>${e(t('a'))}${e(t('b'))}</m:mr><m:mr>${e(t('c'))}${e(t('d'))}</m:mr></m:m>`, '\\begin{matrix}a & b \\\\ c & d\\end{matrix}');
});
test('Word equation array retains separate equations', () => {
  check(`<m:eqArr>${e(t('x=1'))}${e(t('y=2'))}</m:eqArr>`, '\\begin{aligned}x=1 \\\\ y=2\\end{aligned}');
});
for (const [symbol, command] of [['̂','hat'], ['⃗','vec'], ['̇','dot'], ['̃','tilde']]) {
  test(`Word accent ${command} survives conversion`, () => check(`<m:acc><m:accPr><m:chr m:val="${symbol}"/></m:accPr>${e(t('x'))}</m:acc>`, `\\${command}{x}`));
}
test('Word overbar survives conversion', () => check(`<m:bar>${e(t('x'))}</m:bar>`, '\\overline{x}'));
test('Word group brace preserves its position', () => check(`<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/><m:pos m:val="bot"/></m:groupChrPr>${e(t('x'))}</m:groupChr>`, '\\underbrace{x}'));
test('Word lower limit is attached to lim', () => check(`<m:limLow>${e(t('lim'))}<m:lim>${t('x→0')}</m:lim></m:limLow>`, '\\mathop{\\lim}\\limits_{x\\to 0}'));
test('Word upper limit survives conversion', () => check(`<m:limUpp>${e(t('max'))}<m:lim>${t('n')}</m:lim></m:limUpp>`, '\\mathop{\\max}\\limits^{n}'));
test('Word named function is separated from its argument', () => check(`<m:func><m:fName>${t('sin')}</m:fName>${e(t('x'))}</m:func>`, '\\sin x'));
test('Word phantom is preserved', () => check(`<m:phant>${e(t('x'))}</m:phant>`, '\\phantom{x}'));
test('Word hidden radical degree is not displayed', () => check(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg>${t('3')}</m:deg>${e(t('x'))}</m:rad>`, '\\sqrt{x}'));
test('Word math text escapes LaTeX control characters', () => check(t('a_1 % # &amp;'), 'a\\_1 \\% \\# \\&'));
test('Word Chinese math text uses text mode', () => check(t('当'), '\\text{当}'));
test('Word unknown formula nodes fail explicitly', () => assert.throws(() => formula(`<m:unknown>${e(t('x'))}</m:unknown>`), /公式.*PDF/));
test('Word AlternateContent textbox appears exactly once', () => {
  const p = '<w:p><w:r><w:t>题面框内</w:t></w:r></w:p>';
  const body = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${p}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:txbxContent>${p}</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
  assert.equal(extractDocx(zip(body)).text.split('题面框内').length - 1, 1);
});
test('Word missing document part is rejected', () => assert.throws(() => extractDocx(zipSync({ 'other.xml': strToU8('x') })), /有效.*Word/));
test('Word malformed XML produces a readable Chinese error', () => assert.throws(() => extractDocx(zipSync({ 'word/document.xml': strToU8('<w:document><bad></w:document>') })), /Word 文档内容损坏/));
test('Word embedded objects remain rejected', () => assert.throws(() => extractDocx(zipSync({ 'word/embeddings/object.bin': new Uint8Array(1) })), /嵌入对象/));
test('Word image-only documents remain readable', () => {
  const result = extractDocx(zipSync({ 'word/document.xml': strToU8(`<w:document ${ns}><w:body/></w:document>`), 'word/media/a.png': new Uint8Array([1,2,3]) }));
  assert.equal(result.images.length, 1); assert.equal(result.text, '');
});
for (const [name, left, right, latexLeft, latexRight] of [
  ['empty begin only', '', '.', '.', '.'],
  ['empty end only', '[', '', '[', '.'],
  ['both empty', '', '', '.', '.'],
  ['unknown symbol', '⟦', '⟧', '.', '.'],
]) test(`Word ${name} delimiter still converts`, () => {
  check(`<m:d><m:dPr><m:begChr m:val="${left}"/><m:endChr m:val="${right}"/></m:dPr>${e(t('x'))}</m:d>`, `\\left${latexLeft} x\\right${latexRight}`);
});
test('Word unknown delimiter separator does not reject the document', () => {
  check(`<m:d><m:dPr><m:sepChr m:val="、"/></m:dPr>${e(t('a'))}${e(t('b'))}</m:d>`, '\\left( a\\text{、}b\\right)');
});
test('Word embedded object over 25 MiB reports the embedded-object hint', () => assert.throws(() => extractDocx(zipSync({ 'word/document.xml': strToU8(`<w:document ${ns}><w:body/></w:document>`), 'word/embeddings/big.bin': new Uint8Array(26 * 1024 * 1024) })), /嵌入对象/));
test('Word rejects an internal file exceeding 25 MiB', () => assert.throws(() => extractDocx(zipSync({ 'word/media/a.png': new Uint8Array(26 * 1024 * 1024) })), /内部文件过大/));
test('Word rejects aggregate expansion exceeding 64 MiB', () => {
  const big = new Uint8Array(24 * 1024 * 1024);
  assert.throws(() => extractDocx(zipSync({ 'word/media/a.png': big, 'word/media/b.png': big, 'word/media/c.png': big })), /64 MiB/);
});
test('Word accepts legal 48 MiB aggregate below the expansion guard', () => {
  const big = new Uint8Array(24 * 1024 * 1024);
  const result = extractDocx(zipSync({ 'word/document.xml': strToU8(`<w:document ${ns}><w:body/></w:document>`), 'word/media/a.png': big, 'word/media/b.png': big }));
  assert.equal(result.images.length, 2);
});
