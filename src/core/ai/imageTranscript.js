export const IMAGE_TRANSCRIPT_INSTRUCTION = String.raw`
本次最新用户消息含题目图片。先准确抄写题面（保留所有条件，公式使用KaTeX），输出在 <mathmyth_question> 与 </mathmyth_question> 之间。题面不得包含解法。看不清处明确写“此处无法辨认”，不要补造条件。紧接着正常讲解解题。这个标签只用于客户端把题面放在原图下；不要解释标签，不要输出JSON。`;

export function splitImageTranscript(text) {
  const opening = '<mathmyth_question>', closing = '</mathmyth_question>';
  const value = String(text ?? '');
  const stripped = value.trimStart();
  if (!stripped || opening.startsWith(stripped)) return { question: '', answer: '', pending: true };
  if (!stripped.startsWith(opening)) return { question: '', answer: value, pending: false };
  const end = stripped.indexOf(closing, opening.length);
  if (end < 0) return { question: '', answer: '', pending: true };
  return { question: stripped.slice(opening.length, end).trim(), answer: stripped.slice(end + closing.length).trimStart(), pending: false };
}
