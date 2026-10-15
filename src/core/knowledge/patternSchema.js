const text = (value) => typeof value === 'string' && Boolean(value.trim());
const strings = (value) => Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length;
const key = (scenarioId, methodId) => `${scenarioId}:${methodId}`;

export function patternStepSignature(step) {
  return JSON.stringify([step.scenarioId, step.methodId, step.state, step.transformedState, step.condition]);
}

// This validates reviewed content and references; it does not prove the mathematics.
export function createPatternIndex(skeleton, source) {
  if (source?.schema !== 'mathmyth-knowledge-patterns/v1' || !Array.isArray(source.patterns) || !Array.isArray(source.questionLinks)) {
    throw new Error('具体结构资料格式无效。');
  }
  const byId = new Map(), byScenario = new Map(), byMethod = new Map(), byQuestion = new Map();
  for (const pattern of source.patterns) {
    if (!/^P\.[a-z0-9_.-]+$/.test(pattern.id) || byId.has(pattern.id)
      || !['name', 'shape', 'why', 'firstStep'].every((field) => text(pattern[field]))
      || !strings(pattern.scenarioIds) || !strings(pattern.methodIds) || !strings(pattern.signals) || !strings(pattern.conditions)
      || !Array.isArray(pattern.examples) || !pattern.examples.length
      || pattern.examples.some((example) => !['statement', 'solution', 'source'].every((field) => text(example[field])))
      || !text(pattern.counterexample?.statement) || !text(pattern.counterexample?.reason)
      || !Array.isArray(pattern.variants) || pattern.variants.some((variant) => !text(variant))
      || !Array.isArray(pattern.nextScenarioIds) || pattern.review !== 'derivation_checked' || !text(pattern.verification?.kind)) {
      throw new Error(`具体结构缺少识别或核对资料：${pattern.id}`);
    }
    for (const scenarioId of pattern.scenarioIds) {
      const scenario = skeleton.scenarioById.get(scenarioId);
      if (!scenario || pattern.methodIds.some((methodId) => !skeleton.methodById.has(methodId)
        || !scenario.methods.some((edge) => edge.method_id === methodId))) throw new Error(`具体结构方法配对无效：${pattern.id}/${scenarioId}`);
      if (!byScenario.has(scenarioId)) byScenario.set(scenarioId, []);
      byScenario.get(scenarioId).push(pattern);
    }
    for (const methodId of pattern.methodIds) {
      if (!byMethod.has(methodId)) byMethod.set(methodId, []);
      byMethod.get(methodId).push(pattern);
    }
    if (pattern.nextScenarioIds.some((id) => !skeleton.scenarioById.has(id))) throw new Error(`具体结构接续情景无效：${pattern.id}`);
    byId.set(pattern.id, pattern);
  }
  const seenLinks = new Set();
  for (const link of source.questionLinks) {
    const pattern = byId.get(link.patternId);
    const identity = JSON.stringify([link.patternId, link.questionId, link.routeId, link.stepIndex]);
    if (!pattern || seenLinks.has(identity) || !text(link.questionId) || !text(link.routeId)
      || !Number.isInteger(link.stepIndex) || link.stepIndex < 0 || !text(link.reason)) throw new Error('具体结构题目步骤关联无效。');
    if (link.questionKey != null && (!/^[a-f0-9]{64}$/.test(link.questionKey) || !text(link.stepSignature)
      || !pattern.scenarioIds.includes(link.scenarioId) || !pattern.methodIds.includes(link.methodId))) throw new Error('具体结构的已核对步骤快照无效。');
    seenLinks.add(identity);
    if (!byQuestion.has(link.questionId)) byQuestion.set(link.questionId, []);
    byQuestion.get(link.questionId).push(link);
  }
  return { byId, byScenario, byMethod, byQuestion };
}

export function compilePatternLinks(skeleton, source, questions) {
  const index = createPatternIndex(skeleton, source);
  const byQuestion = new Map(questions.map((question) => [question.metadata?.motherId, question]));
  return source.questionLinks.map((link) => {
    const question = byQuestion.get(link.questionId), pattern = index.byId.get(link.patternId);
    const route = question?.routes?.find((item) => item.id === link.routeId);
    const step = route?.steps?.[link.stepIndex];
    if (question?.metadata.reviewStatus !== 'worked_example_checked' || !route?.valid || !step
      || !pattern.scenarioIds.includes(step.scenarioId) || !pattern.methodIds.includes(step.methodId)
      || !/^[a-f0-9]{64}$/.test(question.questionKey)) throw new Error(`具体结构关联没有对应的已核对有效步骤：${link.questionId}/${link.routeId}/${link.stepIndex}`);
    return { ...link, questionKey: question.questionKey, scenarioId: step.scenarioId, methodId: step.methodId,
      stepSignature: patternStepSignature(step) };
  });
}

export function matchingPatternLinks(question, links) {
  if (question?.metadata?.reviewStatus !== 'worked_example_checked') return [];
  return links.filter((link) => {
    if (link.questionId !== question.metadata.motherId || link.questionKey !== question.questionKey) return false;
    const route = question.routes?.find((entry) => entry.id === link.routeId);
    const step = route?.steps?.[link.stepIndex];
    return route?.valid === true && step && link.stepSignature === patternStepSignature(step)
      && key(step.scenarioId, step.methodId) === key(link.scenarioId, link.methodId);
  });
}
