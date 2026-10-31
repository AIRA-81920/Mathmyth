// 从"还没写完"的 JSON 文本里逐块取出 question 的值。
// 用途：AI 出题边流边显示题面（不必等整段 JSON 收尾）。
// 只做一件事，所以可单测：截断在 \" 、\\ 、\u 中间都必须安全。
const KEY = /"question"\s*:\s*"/;

export function createQuestionExtractor() {
  let raw = '';            // 用于找 key 的缓冲（找到后不再增长）
  let started = false;
  let done = false;
  let value = '';
  let escaped = false;
  let unicode = null;      // 收集 \uXXXX 的四位

  return {
    push(chunk) {
      if (done || typeof chunk !== 'string' || !chunk) return value;
      for (const ch of chunk) {
        if (!started) {
          raw += ch;
          const match = raw.match(KEY);
          if (!match) { if (raw.length > 256) raw = raw.slice(-64); continue; }
          started = true;
          raw = '';
          continue;
        }
        if (unicode !== null) {
          unicode += ch;
          if (unicode.length === 4) {
            const code = Number.parseInt(unicode, 16);
            if (Number.isFinite(code)) value += String.fromCharCode(code);
            unicode = null;
          }
          continue;
        }
        if (escaped) {
          escaped = false;
          if (ch === 'n') value += '\n';
          else if (ch === 't') value += '\t';
          else if (ch === 'r') value += '\r';
          else if (ch === 'b') value += '\b';
          else if (ch === 'f') value += '\f';
          else if (ch === 'u') unicode = '';
          else value += ch;            // \" \\ \/ 以及未知转义都原样取字符
          continue;
        }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { done = true; break; }   // 未转义的收尾引号 → 题面完整
        value += ch;
      }
      return value;
    },
    get value() { return value; },
    get complete() { return done; },
  };
}
