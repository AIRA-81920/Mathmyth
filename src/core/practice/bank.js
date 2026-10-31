import { loadRouteBank } from './bank-data.js';
import { prepareRouteQuestion } from './routes.js';

// 题库改为按需动态加载：调用方必须先 await loadRouteBank() 取得 preparedRouteTargets。
export async function localTargets(skeleton) {
  const { preparedRouteTargets } = await loadRouteBank();
  const covered = new Set(preparedRouteTargets.filter((target) => target.batchId).map((target) => target.scenarioId));
  return preparedRouteTargets.filter((target) => skeleton.scenarioById.has(target.scenarioId)
    && (target.batchId || !covered.has(target.scenarioId))).map((target) => ({
    ...target, methodId: skeleton.aliases.get(target.methodId) || target.methodId, localReady: true, questionCount: target.questions.length,
  }));
}

function findLocalTarget(target, targets) {
  const group = target?.id
    ? targets.find((entry) => entry.id === target.id)
    : targets.find((entry) => entry.scenarioId === target?.scenarioId);
  return group && (!target.scenarioId || group.scenarioId === target.scenarioId) ? group : null;
}

// Practice choices contain summaries, not question arrays. Recover the exact
// installed pool before crossing the Worker boundary; only this pool travels.
export async function prepareLocalPracticeInput(target, skeleton, level = 'single', history = []) {
  const { preparedRouteTargets } = await loadRouteBank();
  const preparedTarget = findLocalTarget(target, preparedRouteTargets);
  if (!preparedTarget) return null;
  const items = await prepareLocalRound(preparedTarget, skeleton, level, history);
  return { scenarioId: preparedTarget.scenarioId,
    methodId: skeleton.aliases.get(preparedTarget.methodId) || preparedTarget.methodId,
    items, localPrepared: true, preparedTarget };
}

export async function prepareLocalRound(target, skeleton, level = 'single', history = []) {
  const { preparedRouteTargets } = await loadRouteBank();
  const group = findLocalTarget(target, preparedRouteTargets);
  if (!group) return null;
  // Keep original mother identities stable across levels and presentations so
  // replay cannot produce another independent mastery credit.
  const items = await Promise.all(group.questions.map((question) => prepareRouteQuestion(question, skeleton, level)));
  const usage = new Map();
  for (const entry of history) {
    const key = entry.questionKey ?? entry.question?.questionKey;
    if (!key) continue;
    const previous = usage.get(key) ?? { count: 0, lastPracticedAt: '' };
    usage.set(key, { count: previous.count + (entry.count ?? 1),
      lastPracticedAt: [previous.lastPracticedAt, entry.lastPracticedAt ?? entry.startedAt ?? ''].sort().at(-1) });
  }
  const ranked = items.map((item, index) => ({ item, index, usage: usage.get(item.questionKey) ?? { count: 0, lastPracticedAt: '' } }));
  ranked.sort((a, b) => a.usage.count - b.usage.count || a.usage.lastPracticedAt.localeCompare(b.usage.lastPracticedAt) || a.index - b.index);
  const primary = group.primaryScenarioId ? ranked.find(({ item }) => item.entranceScenarioId === group.primaryScenarioId) : null;
  const chosen = primary ? [primary, ...ranked.filter((entry) => entry !== primary).slice(0, 2)] : ranked.slice(0, 3);
  return chosen.sort((a, b) => (a.item.metadata.complexity ?? 1) - (b.item.metadata.complexity ?? 1) || a.index - b.index).map(({ item, usage: used }) => ({ ...item,
    metadata: { ...item.metadata, repeated: used.count > 0, targetId: group.id } }));
}
