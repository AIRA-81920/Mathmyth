import { preparedRouteTargets } from '../../assets/practice/route-bank.js';
import { prepareRouteQuestion } from './routes.js';

export function localTargets(skeleton) {
  const covered = new Set(preparedRouteTargets.filter((target) => target.batchId).map((target) => target.scenarioId));
  return preparedRouteTargets.filter((target) => skeleton.scenarioById.has(target.scenarioId)
    && (target.batchId || !covered.has(target.scenarioId))).map((target) => ({
    ...target, methodId: skeleton.aliases.get(target.methodId) || target.methodId, localReady: true, questionCount: target.questions.length,
  }));
}

export async function prepareLocalRound(target, skeleton, level = 'single', history = []) {
  const group = preparedRouteTargets.find((entry) => entry.id === target.id)
    ?? preparedRouteTargets.find((entry) => entry.scenarioId === target.scenarioId);
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
