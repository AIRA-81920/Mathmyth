// The digest covers mathematical content, never mutable learner metadata.
// Kept separate from the manifest so the generator can rebuild that manifest.
function canonical(value, depth = 0) {
  if (depth > 40) throw new Error('Reviewed question exceeds the supported nesting depth');
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]));
  return value;
}

export async function reviewedQuestionDigest(question) {
  if (question?.format !== 'route-v1' || typeof question.question !== 'string' || typeof question.solution !== 'string'
    || typeof question.entranceScenarioId !== 'string' || typeof question.metadata?.source?.kind !== 'string'
    || !Array.isArray(question.routes)) return null;
  // 结构只是认身份的辅助信息。外校期末卷转写题没有可用的表达式树，
  // 但题面、解答、路线与来源都会被摘要覆盖，因此无结构题同样可以进清单。
  const payload = JSON.stringify(canonical({ question: question.question, entranceScenarioId: question.entranceScenarioId,
    solution: question.solution, sourceKind: question.metadata.source.kind, routes: question.routes, structure: question.structure ?? null }));
  if (payload.length > 200000) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
