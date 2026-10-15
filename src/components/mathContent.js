function normalizeText(text) {
  // Models often use these standard LaTeX delimiters despite a $-based prompt.
  // Leave Markdown code spans intact, where backslashes are literal text.
  return text.split(/(`+[^`]*`+)/g).map((part) => {
    if (part.startsWith('`')) return part
    return part
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `\n\n$$\n${body.trim()}\n$$\n\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${body}$`)
  }).join('')
}

export function normalizeMathContent(content = '') {
  const lines = String(content).split('\n')
  let fence = null
  let buffer = []
  const result = []
  const flush = () => { result.push(normalizeText(buffer.join('\n'))); buffer = [] }
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      result.push(line)
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
    } else if (marker) {
      flush()
      fence = marker[1]
      result.push(line)
    } else buffer.push(line)
  }
  flush()
  return result.join('\n')
}
