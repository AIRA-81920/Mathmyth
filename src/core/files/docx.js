import { unzipSync } from 'fflate';

const local = (node) => node?.localName;
const children = (node) => [...(node?.children ?? [])];
const child = (node, name) => children(node).find((entry) => local(entry) === name);
const latexEscape = (value) => value.replace(/[\\{}#$%&_^~]/g, char => ({ '\\': '\\backslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' }[char] ?? `\\${char}`));
const unsafeMath = () => new Error('这份 Word 里有暂时无法安全转换的公式，请另存为 PDF 或截图后发送，以保留题面。');
function property(node, group, name, fallback) {
  const entry = child(child(node, group), name);
  if (!entry) return fallback;
  return [...entry.attributes].find(attribute => attribute.localName === 'val')?.value ?? '';
}
const flag = (node, group, name) => {
  const value = property(node, group, name, null);
  return value !== null && !['0', 'false', 'off'].includes(value);
};
const operators = { '∫': '\\int', '∬': '\\iint', '∮': '\\oint', '∑': '\\sum', '∏': '\\prod', '⋃': '\\bigcup', '⋂': '\\bigcap' };
const functions = new Set(['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','log','ln','exp','lim','limsup','liminf','min','max','sup','inf','det','gcd']);
function mathText(value) {
  if (functions.has(value)) return `\\${value}`;
  return value.split(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef]+)/u).map(part =>
    /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(part) ? `\\text{${latexEscape(part)}}`
      : latexEscape(part).replace(/→/g, '\\to ').replace(/∞/g, '\\infty ')).join('');
}
// 空定界与少见符号都退回 \left. / \right. 一类的安全写法：单处定界符不能拖垮整篇转换。
function delimiter(value) {
  const symbols = { '': '.', '.': '.', '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}', '|': '|', '/': '/', '<': '<', '>': '>', '‖': '\\Vert', '∥': '\\Vert', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor' };
  return symbols[value] ?? '.';
}

function math(node) {
  if (!node) return '';
  const read = (name) => math(child(node, name));
  switch (local(node)) {
    case 'f': return `\\frac{${read('num')}}{${read('den')}}`;
    case 'sSup': return `{${read('e')}}^{${read('sup')}}`;
    case 'sSub': return `{${read('e')}}_{${read('sub')}}`;
    case 'sSubSup': return `{${read('e')}}_{${read('sub')}}^{${read('sup')}}`;
    case 'rad': return `\\sqrt${!flag(node, 'radPr', 'degHide') && read('deg') ? `[${read('deg')}]` : ''}{${read('e')}}`;
    case 't': return mathText(node.textContent);
    case 'd': {
      const separator = property(node, 'dPr', 'sepChr', '|');
      const entries = children(node).filter(entry => local(entry) === 'e').map(math);
      return `\\left${delimiter(property(node, 'dPr', 'begChr', '('))} ${entries.join(separator ? mathText(separator) : '')}\\right${delimiter(property(node, 'dPr', 'endChr', ')'))}`;
    }
    case 'nary': {
      const operator = operators[property(node, 'naryPr', 'chr', '∫')];
      if (!operator) throw unsafeMath();
      const location = property(node, 'naryPr', 'limLoc', '');
      if (!['','subSup','undOvr'].includes(location)) throw unsafeMath();
      const low = flag(node, 'naryPr', 'subHide') ? '' : read('sub');
      const high = flag(node, 'naryPr', 'supHide') ? '' : read('sup');
      return `${operator}${location === 'undOvr' ? '\\limits' : location === 'subSup' ? '\\nolimits' : ''}${low ? `_{${low}}` : ''}${high ? `^{${high}}` : ''} ${read('e')}`;
    }
    case 'acc': {
      const accent = { '̂':'hat', '^':'hat', '⃗':'vec', '→':'vec', '̇':'dot', '˙':'dot', '̃':'tilde', '~':'tilde', '̈':'ddot', '̌':'check', '̆':'breve' }[property(node, 'accPr', 'chr', '̂')];
      if (!accent) throw unsafeMath();
      return `\\${accent}{${read('e')}}`;
    }
    case 'bar': return `\\${property(node, 'barPr', 'pos', 'top') === 'bot' ? 'underline' : 'overline'}{${read('e')}}`;
    case 'groupChr': {
      const symbol = property(node, 'groupChrPr', 'chr', '⏟');
      const command = { '⏟':'underbrace', '⏞':'overbrace', '⏝':'underparen', '⏜':'overparen' }[symbol];
      if (!command || command.endsWith('paren')) throw unsafeMath();
      return `\\${command}{${read('e')}}`;
    }
    case 'limLow': return `\\mathop{${read('e')}}\\limits_{${read('lim')}}`;
    case 'limUpp': return `\\mathop{${read('e')}}\\limits^{${read('lim')}}`;
    case 'func': {
      const name = read('fName');
      return `${/^\\[a-z]+$/.test(name) ? name : `\\operatorname{${name}}`} ${read('e')}`;
    }
    case 'eqArr': return `\\begin{aligned}${children(node).filter(entry => local(entry) === 'e').map(math).join(' \\\\ ')}\\end{aligned}`;
    case 'phant': return `\\phantom{${read('e')}}`;
    case 'm': return `\\begin{matrix}${children(node).filter((entry) => local(entry) === 'mr').map((row) => children(row).filter((entry) => local(entry) === 'e').map(math).join(' & ')).join(' \\\\ ')}\\end{matrix}`;
    case 'oMath': case 'oMathPara': case 'r': case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName':
      return children(node).filter(entry => !/Pr$/.test(local(entry))).map(math).join('');
    default: throw unsafeMath();
  }
}
function selectedChildren(node) {
  if (local(node) !== 'AlternateContent') return children(node);
  const branch = child(node, 'Choice') ?? child(node, 'Fallback');
  return branch ? [branch] : [];
}
function paragraph(node) {
  let result = '';
  function walk(entry) {
    if (entry !== node && local(entry) === 'p') { result += `\n${paragraph(entry)}\n`; return; }
    if (local(entry) === 'oMath' || local(entry) === 'oMathPara') { result += `$${math(entry)}$`; return; }
    if (local(entry) === 't') { result += entry.textContent; return; }
    if (local(entry) === 'tab') { result += '\t'; return; }
    if (['br','cr'].includes(local(entry))) { result += '\n'; return; }
    selectedChildren(entry).forEach(walk);
  }
  walk(node);
  return result;
}
export function extractDocx(bytes) {
  let expanded=0;
  let files;
  try { files = unzipSync(bytes, { filter: (file) => {
    // 先按路径判定嵌入对象/矢量图，再判体积：提示要指向正确的那步操作。
    if (/^word\/embeddings\//.test(file.name) || /^word\/media\/.*\.(emf|wmf|svg)$/i.test(file.name)) throw new Error('Word 含嵌入对象或不支持的矢量图，请另存为 PDF 后发送，以保留题面。');
    if (file.originalSize > 25 * 1024 * 1024) throw new Error('Word 内部文件过大，请拆分文档。');
    const include=file.name === 'word/document.xml' || /^word\/media\//.test(file.name);
    if (include && (expanded+=file.originalSize)>64*1024*1024)throw new Error('Word 解压后的内容超过 64 MiB，请只发送需要提问的部分。');
    return include;
  } }); } catch (error) {
    if (/^Word /.test(error.message ?? '')) throw error;
    throw new Error('这不是有效的 Word 文档，请另存为 .docx 或 PDF 后发送。');
  }
  if (!files['word/document.xml']) throw new Error('这不是有效的 Word 文档。');
  let xml;
  try { xml = new DOMParser().parseFromString(new TextDecoder('utf-8', { fatal: true }).decode(files['word/document.xml']), 'application/xml'); }
  catch { throw new Error('Word 文档内容损坏。'); }
  if (xml.querySelector('parsererror')) throw new Error('Word 文档内容损坏。');
  const paragraphs = [];
  function collect(node) {
    if (local(node) === 'p') { paragraphs.push(paragraph(node)); return; }
    selectedChildren(node).forEach(collect);
  }
  collect(xml.documentElement);
  const text = paragraphs.join('\n\n');
  const images = Object.entries(files).filter(([name]) => /^word\/media\/.*\.(png|jpe?g|gif|webp)$/i.test(name)).map(([name, data]) => new File([data], name.split('/').pop()));
  if (!text.trim() && !images.length) throw new Error('Word 中没有可读取的题面。');
  return { text, images };
}
