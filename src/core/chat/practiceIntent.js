export function wantsChatPractice(text) {
  const value = String(text ?? '').trim();
  if (/^(?:\/练习|\/practice)(?:\s|$)/i.test(value)) return true;
  const outsideQuotes = value.replace(/[“「『"][\s\S]*?[”」』"]/g, '');
  if (/(?:不要|不想|不用|不必|不需要|别)[^，。？！?！\n]{0,5}(?:考(?:考|一下)?我|练(?:习|练|一练|一下)|出题|给我.*题)|什么(?:意思|叫)|如何实现|怎么实现|提示词/.test(outsideQuotes)) return false;
  const exercise = /考(?:考|一下|一考)?我|让我(?:试试|练练|做做|试|练|做)(?:一下|一题|一练|看)|(?:我想|想|来|让我)练(?:练|一练|一下|习)|练一练|练习一下|再来一题|下一题/.test(outsideQuotes);
  if (exercise) return true;
  if (/答案|解答|解析|解法|思路|步骤|怎么做|功能/.test(outsideQuotes)) return false;
  return /(?:给(?:我|一道|一题|道)|帮我(?:出|找)|来(?:一)?道|出(?:一|道)|换(?:一|道|个)|再(?:来|给|出))[^。？！?！\n]{0,16}(?:题|练习)/.test(outsideQuotes);
}

export function chatRouteLetters(text) {
  const match = String(text ?? '').trim().match(/^(?:我(?:觉得|选择|选)|选择|选|答案(?:是|选))?\s*([A-Ea-e](?:[\s,，、和及]*[A-Ea-e])*)\s*(?:路线|选项|吧|。)?$/);
  return match ? [...new Set(match[1].toUpperCase().match(/[A-E]/g))] : null;
}
export function parseChatRouteAnswer(text, question) {
  const letters = chatRouteLetters(text);
  if (!letters || letters.some(letter => !question.options[letter.charCodeAt(0) - 65])) return null;
  return letters.map(letter => question.options[letter.charCodeAt(0) - 65].id);
}
