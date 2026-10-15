export function canonicalStructure(node, depth = 0) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 16 || !/^[a-z_]{2,32}$/.test(node.op)) throw new Error('题面结构无效。');
  if (['var', 'variable'].includes(node.op)) return ['var'];
  if (['const', 'number'].includes(node.op)) return ['const'];
  if (!Array.isArray(node.args) || !node.args.length || node.args.length > 20) throw new Error('题面结构无效。');
  return [node.op, ...node.args.map((child) => canonicalStructure(child, depth + 1))];
}

export function normalizedQuestion(question, variables = []) {
  let source = question.normalize('NFKC').replace(/\s+/g, '');
  for (const [index, variable] of variables.entries()) {
    if (!/^[A-Za-z]$/.test(variable)) throw new Error('题目变量无效。');
    source = source.replace(new RegExp(`(?<![A-Za-z])${variable}(?![A-Za-z])`, 'g'), `{var${index}}`);
  }
  return source;
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintQuestion(item) {
  return { questionKey: await hash(normalizedQuestion(item.question, item.variables)),
    faceKey: await hash(JSON.stringify(canonicalStructure(item.structure))) };
}
