// Match formatting differences only, then recover the exact public excerpt.
// NFKC would also turn x² into x2, so deliberately normalize ASCII width only.
function normalized(text) {
  let value = '';
  const positions = [];
  for (let index = 0; index < text.length; index += 1) {
    let char = text[index];
    const code = char.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) char = String.fromCharCode(code - 0xfee0);
    if (/\s/u.test(char)) continue;
    value += char;
    positions.push(index);
  }
  return { value, positions };
}

export function publicEvidenceMatcher(answers) {
  let indexed;
  return evidence => {
    if (!evidence || evidence.length > 500) return null;
    if (answers.some(answer => answer.includes(evidence))) return evidence;
    const needle = normalized(evidence).value;
    if (!needle) return null;
    indexed ??= answers.map(answer => ({ answer, ...normalized(answer) }));
    for (const { answer, value, positions } of indexed) {
      const start = value.indexOf(needle);
      if (start < 0) continue;
      const excerpt = answer.slice(positions[start], positions[start + needle.length - 1] + 1);
      if (excerpt.length <= 500) return excerpt;
    }
    return null;
  };
}
