import { localTargets } from '../practice/bank.js';

// Only cycle through questions that can be started immediately. Missing pools
// remain available in the manual picker with an explicit AI-only status.
export function nextPreparedChoiceIndex(choices, currentIndex, random = Math.random) {
  const candidates = choices.flatMap((choice, index) => choice.localReady && index !== currentIndex ? [index] : []);
  if (!candidates.length) return currentIndex;
  return candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))];
}

export function practiceChoices(skeleton, data, { includePrepared = false } = {}) {
  const states = new Map(data.mastery.map((row) => [`${row.targetType}:${row.targetId}`, row.state]));
  const groups = new Map();
  for (const entry of data.encounters) {
    const scenario = skeleton.scenarioById.get(entry.scenarioId);
    if (!entry.methodId || !scenario?.methods.some((edge) => edge.method_id === entry.methodId)) continue;
    let choice = groups.get(entry.scenarioId);
    if (!choice) { choice = { key: entry.scenarioId, scenarioId: entry.scenarioId, scenarioName: scenario.name,
      scenarioState: states.get(`scenario:${entry.scenarioId}`) ?? 'exposed', questions: new Set(), methods: new Set(), anchors: [] }; groups.set(entry.scenarioId, choice); }
    choice.questions.add(entry.practiceItemId || entry.messageId || entry.conversationId || entry.question || entry.id);
    choice.methods.add(entry.methodId);
    if (entry.question?.trim()) choice.anchors.push(entry);
  }
  const encountered = [...groups.values()].map((choice) => {
    const scenario = skeleton.scenarioById.get(choice.scenarioId);
    const methods = [...choice.methods].sort((a,b) => Number(states.get(`method:${a}`) === 'mastered') - Number(states.get(`method:${b}`) === 'mastered')
      || scenario.methods.find((edge) => edge.method_id === a).priority - scenario.methods.find((edge) => edge.method_id === b).priority);
    const methodId = methods[0];
    const anchor = choice.anchors.filter((entry) => entry.methodId === methodId).sort((a,b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    return { key: choice.key, scenarioId: choice.scenarioId, scenarioName: choice.scenarioName, scenarioState: choice.scenarioState,
      methodId, methodState: states.get(`method:${methodId}`) ?? 'exposed', count: choice.questions.size,
      anchor: anchor?.question ?? '', anchorConversationId: anchor?.conversationId ?? null };
  });
  // A prepared bank supplies questions; it does not prove the learner studied
  // its topics. Unlock targets from actual encounters only.
  const local = (includePrepared ? localTargets(skeleton).filter((target) => groups.has(target.scenarioId)) : []).map((target) => {
    const seen = encountered.find((choice) => choice.scenarioId === target.scenarioId);
    return { ...target, questions: undefined, key: target.id, scenarioName: skeleton.scenarioById.get(target.scenarioId).name,
      scenarioState: states.get(`scenario:${target.scenarioId}`) ?? 'unseen', methodState: states.get(`method:${target.methodId}`) ?? 'unseen',
      count: seen?.count ?? 0, anchor: seen?.anchor ?? '', anchorConversationId: seen?.anchorConversationId ?? null };
  });
  return [...local, ...encountered.filter((choice) => !local.some((target) => target.scenarioId === choice.scenarioId))]
    .sort((a,b) => Number(b.localReady === true) - Number(a.localReady === true)
    || Number(Boolean(b.batchId)) - Number(Boolean(a.batchId))
    || Number(a.count === 0) - Number(b.count === 0)
    || Number(a.scenarioState === 'mastered' && a.methodState === 'mastered') - Number(b.scenarioState === 'mastered' && b.methodState === 'mastered')
    || a.count - b.count || a.key.localeCompare(b.key));
}
