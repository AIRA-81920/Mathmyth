// Extract only closed object values of the top-level items array. Never expose
// a half question, unclosed string or guessed JSON repair to practice grading.
export function completeJsonItems(text) {
  const start = /"items"\s*:\s*\[/.exec(text);
  if (!start) return [];
  const values = [];
  let quoted = false, escaped = false, depth = 0, begin = -1;
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth++ === 0) begin = i; }
    else if (char === '}' && --depth === 0 && begin >= 0) { values.push(JSON.parse(text.slice(begin, i + 1))); begin = -1; }
    else if (char === ']' && depth === 0) break;
  }
  return values;
}
