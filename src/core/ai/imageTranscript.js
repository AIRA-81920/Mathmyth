export const IMAGE_TRANSCRIPT_INSTRUCTION = String.raw`
本次最新用户消息含题目图片。先准确抄写题面（保留所有条件，公式使用KaTeX），输出在 <mathmyth_question> 与 </mathmyth_question> 之间。题面不得包含解法。看不清处明确写“此处无法辨认”，不要补造条件。紧接着正常讲解解题。这个标签只用于客户端把题面放在原图下；不要解释标签，不要输出JSON。`;

// D6：追问增量转写。首问走严格模式（无完整标签即报错、可重试）；追问走尽力而为
// 模式——只有当本轮真的在解读"图里另一道尚未转写过的题"时才输出标签，仅仅追问
// 已转写题目的细节时不要输出标签。
export const IMAGE_FOLLOWUP_INSTRUCTION = String.raw`
本次用户消息没有附图，但会话历史中有题目图片，你可能需要看图回答。若你这次解读的是图中另一道尚未转写过的题（与历史里已出现的题面不同），先把该题题面忠实抄写在 <mathmyth_question> 与 </mathmyth_question> 之间（保留全部条件，公式使用 KaTeX，看不清处明确写“此处无法辨认”，不要补造条件），再正常讲解。若只是追问已经转写过的题目，不要输出这个标签，直接回答。`;

// 尽力而为模式的兜底：标签未闭合时整段按正常回答保留，只去掉裸露的开标签，
// 避免把字面量标签显示给用户。
export function stripTranscriptTag(text) {
  return String(text ?? '').trimStart().replace(/^<mathmyth_question>\s*/, '');
}

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
