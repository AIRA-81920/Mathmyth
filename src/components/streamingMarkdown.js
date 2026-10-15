// Only freeze complete blocks. A blank line inside a fence/formula/inline span
// cannot be a checkpoint; the unfinished tail stays escaped React text.
export function splitStreamingMarkdown(text = '') {
  const blocks = [];
  let start = 0, fence = null, math = null, inline = null, bracket = 0;
  const lines = String(text).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let offset = 0;
  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker && !math && !inline) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line.trimEnd())) fence = null;
    } else if (!fence) {
      for (let i = 0; i < line.length; i++) {
        const c = line[i], pair = line.slice(i, i + 2);
        if (c === '\\') {
          if (!inline && (pair === '\\[' || pair === '\\(')) { if (!math) math = pair; i++; continue; }
          if (math && ((math === '\\[' && pair === '\\]') || (math === '\\(' && pair === '\\)'))) { math = null; i++; continue; }
          i++; continue;
        }
        if (inline?.[0] === '`') { if (line.startsWith(inline, i)) { i += inline.length - 1; inline = null; } continue; }
        if (c === '`' && !math) { inline = line.slice(i).match(/^`+/)[0]; i += inline.length - 1; continue; }
        if (c === '$' && !inline) {
          const delimiter = pair === '$$' ? '$$' : '$';
          if (!math) math = delimiter; else if (math === delimiter) math = null;
          i += delimiter.length - 1; continue;
        }
        if (math) continue;
        if (c === '[') bracket++;
        if (c === ']') bracket = Math.max(0, bracket - 1);
        if (c === '(' && line[i - 1] === ']') bracket++;
        if (c === ')' && bracket) bracket--;
        if (c === '*' || c === '_') {
          // Ignore list bullets and underscores inside identifiers.
          if (/^\s*\*\s/.test(line) && i === line.indexOf('*')) continue;
          if (c === '_' && /\w/.test(line[i - 1] ?? '') && /\w/.test(line[i + 1] ?? '')) continue;
          const delimiter = pair === c + c ? pair : c;
          if (!inline) inline = delimiter; else if (inline === delimiter) inline = null;
          i += delimiter.length - 1;
        }
      }
    }
    offset += line.length;
    if (!fence && !math && !inline && !bracket && /^\s*\n$/.test(line)) {
      const block = text.slice(start, offset);
      // Lists/quotes can legally continue across blank lines. Hold them until
      // a different complete block begins, preserving numbering and nesting.
      if (/^ {0,3}(?:[-+*]\s|\d+[.)]\s|>)/m.test(block)) {
        const next = text.slice(offset).match(/^(.*)\n/);
        if (!next || /^\s*$|^\s|^> |^[-+*]\s|^\d+[.)]\s/.test(next[1])) continue;
      }
      // Reference definitions may change earlier blocks; hold the whole message.
      if (/^ {0,3}\[[^\]]+\]:/m.test(block)) return { blocks: [], pending: text };
      if (block.trim()) blocks.push(block);
      start = offset;
    }
  }
  return { blocks, pending: text.slice(start) };
}
