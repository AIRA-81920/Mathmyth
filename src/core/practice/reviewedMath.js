// Archived reviews may use Unicode mathematical notation. Convert display
// fragments without changing the saved question text or its fingerprint.
const supers = Object.fromEntries([... '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿ'].map((c, i) => [c, '0123456789-+n'[i]]));
const subs = Object.fromEntries([... '₀₁₂₃₄₅₆₇₈₉'].map((c, i) => [c, String(i)]));
function enclose(source, marker, replacement) {
  let out = '', cursor = 0;
  while (true) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) return out + source.slice(cursor);
    let depth = 1, end = start + marker.length;
    for (; end < source.length && depth; end++) { if (source[end] === '(') depth++; else if (source[end] === ')') depth--; }
    if (depth) return out + source.slice(cursor);
    out += source.slice(cursor, start) + replacement + '{' + source.slice(start + marker.length, end - 1) + '}'; cursor = end;
  }
}
export function reviewedMathMarkdown(value) {
  const text = String(value ?? '');
  if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) return text;
  return text.split(/([\u3400-\u9fff，。；：！？]+)/u).map((fragment) => {
    if (/^[\u3400-\u9fff，。；：！？]+$/u.test(fragment) || !/[=→∫∞√∛²³ⁿ⁻⁺^_∂≤≥≠∈′″/]|\b(?:lim|sin|cos|tan|ln|arctan)\b/.test(fragment)) return fragment;
    const leading = fragment.match(/^\s*/u)?.[0] ?? '', trailing = fragment.match(/\s*$/u)?.[0] ?? '';
    let math = fragment.trim().replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿ]+/gu, (part) => `^{${[...part].map((c) => supers[c]).join('')}}`)
      .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/gu, (c) => `\\text{(${'①②③④⑤⑥⑦⑧⑨⑩'.indexOf(c) + 1})}`)
      .replace(/[₀₁₂₃₄₅₆₇₈₉]+/gu, (part) => `_{${[...part].map((c) => subs[c]).join('')}}`)
      .replace(/″/gu, "''").replace(/‴/gu, "'''").replace(/′/gu, "'")
      .replace(/→/gu, '\\to ').replace(/∞/gu, '\\infty ').replace(/∫/gu, '\\int ').replace(/½/gu, '\\tfrac{1}{2}')
      .replace(/[−–]/gu, '-').replace(/·/gu, '\\cdot ');
    math = enclose(enclose(enclose(math, '√(', '\\sqrt'), '∛(', '\\sqrt[3]'), '^(', '^')
      .replace(/√([a-zA-Z0-9])/gu, '\\sqrt{$1}').replace(/∛([a-zA-Z0-9])/gu, '\\sqrt[3]{$1}')
      .replace(/\^(\\sqrt(?:\[3\])?\{[^{}]*\})/gu, '^{$1}')
      .replace(/\^([+-]?\d{2,})/gu, '^{$1}')
      .replace(/\b(lim|sin|cos|tan|cot|ln|log|exp|arcsin|arccos|arctan)(?=[^a-zA-Z]|$)/gu, '\\$1 ');
    return `${leading}$${math}$${trailing}`;
  }).join('');
}
