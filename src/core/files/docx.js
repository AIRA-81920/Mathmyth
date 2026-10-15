import { unzipSync } from 'fflate';

const local = (node) => node?.localName;
const children = (node) => [...(node?.children ?? [])];
const child = (node, name) => children(node).find((entry) => local(entry) === name);
const latexEscape = (value) => value.replace(/([{}#$%&_])/g, '\\$1');

function math(node) {
  const read = (name) => math(child(node, name));
  switch (local(node)) {
    case 'f': return `\\frac{${read('num')}}{${read('den')}}`;
    case 'sSup': return `{${read('e')}}^{${read('sup')}}`;
    case 'sSub': return `{${read('e')}}_{${read('sub')}}`;
    case 'sSubSup': return `{${read('e')}}_{${read('sub')}}^{${read('sup')}}`;
    case 'rad': return `\\sqrt${read('deg') ? `[${read('deg')}]` : ''}{${read('e')}}`;
    case 't': return node.textContent;
    case 'd': return `\\left(${read('e')}\\right)`;
    case 'm': return `\\begin{matrix}${children(node).filter((entry) => local(entry) === 'mr').map((row) => children(row).filter((entry) => local(entry) === 'e').map(math).join(' & ')).join(' \\\\ ')}\\end{matrix}`;
    default: return children(node).filter((entry) => !/Pr$/.test(local(entry))).map(math).join('');
  }
}
function paragraph(node) {
  let result = '';
  function walk(entry) {
    if (local(entry) === 'oMath' || local(entry) === 'oMathPara') { result += `$${math(entry)}$`; return; }
    if (local(entry) === 't') { result += entry.textContent; return; }
    if (local(entry) === 'tab') { result += '\t'; return; }
    if (['br','cr'].includes(local(entry))) { result += '\n'; return; }
    children(entry).forEach(walk);
  }
  walk(node);
  return result;
}
export function extractDocx(bytes) {
  let expanded=0;
  const files = unzipSync(bytes, { filter: (file) => {
    if (file.originalSize > 25 * 1024 * 1024) throw new Error('Word 内部文件过大，请拆分文档。');
    const include=file.name === 'word/document.xml' || /^word\/media\//.test(file.name);
    if (include && (expanded+=file.originalSize)>64*1024*1024)throw new Error('Word 解压后的内容超过 64 MiB，请只发送需要提问的部分。');
    if (/^word\/embeddings\//.test(file.name) || /^word\/media\/.*\.(emf|wmf|svg)$/i.test(file.name)) throw new Error('Word 含嵌入对象或不支持的矢量图，请另存为 PDF 后发送，以保留题面。');
    return include;
  } });
  if (!files['word/document.xml']) throw new Error('这不是有效的 Word 文档。');
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(files['word/document.xml']), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Word 文档内容损坏。');
  const paragraphs = [...xml.getElementsByTagNameNS('*', 'p')].map(paragraph);
  const text = paragraphs.join('\n\n');
  const images = Object.entries(files).filter(([name]) => /^word\/media\/.*\.(png|jpe?g|gif|webp)$/i.test(name)).map(([name, data]) => new File([data], name.split('/').pop()));
  if (!text.trim() && !images.length) throw new Error('Word 中没有可读取的题面。');
  return { text, images };
}
