// Route labels are always resolved from canonical knowledge IDs by the UI.
export function validateQuestionRoutes(routes, encounters, source) {
  if (routes == null) return [];
  if (!Array.isArray(routes) || routes.length > 12) throw new Error('本题路径分组无效。');
  const users = new Set([source.userMessageId, ...(source.questionMessages ?? []).map(m => m.messageId), ...(source.context ?? []).filter(m => m.role === 'user').map(m => m.messageId)].filter(Boolean));
  const edges = new Set(encounters.map(e => `${e.scenario_id}:${e.method_id ?? ''}`));
  const seen = new Set();
  const publicAnswers = [source.answer, ...(source.context ?? []).filter(message => message.role === 'assistant').map(message => message.content)].filter(value => typeof value === 'string');
  return routes.map(route => {
    const anchor = route.user_message_id;
    if (!users.has(anchor) || !Number.isInteger(route.question_index) || route.question_index < 1 || route.question_index > 12) throw new Error('本题路径来源无效。');
    const key = `${anchor}:${route.question_index}`;
    if (seen.has(key)) throw new Error('本题路径重复。');
    seen.add(key);
    function validateSteps(steps) {
      if (!Array.isArray(steps) || !steps.length || steps.length > 16) throw new Error('本题路径步骤无效。');
      return steps.map(step => {
        const evidence = typeof step.evidence === 'string' ? step.evidence.trim() : '';
        if (!edges.has(`${step.scenario_id}:${step.method_id ?? ''}`) || !evidence || evidence.length > 500
          || !publicAnswers.some(answer => answer.includes(evidence))) throw new Error('本题路径缺少解答依据。');
        return { scenario_id: step.scenario_id, method_id: step.method_id ?? null, evidence };
      });
    }
    if (route.paths != null) {
      if (!Array.isArray(route.paths) || !route.paths.length || route.paths.length > 6) throw new Error('并列解法无效。');
      const paths = route.paths.map(path => ({ steps: validateSteps(path.steps) }));
      return { user_message_id: anchor, question_index: route.question_index, steps: paths[0].steps, paths };
    }
    return { user_message_id: anchor, question_index: route.question_index, steps: validateSteps(route.steps) };
  });
}

export function routePaths(route) {
  return route?.paths?.length ? route.paths : [{ steps: route?.steps ?? [] }];
}

export function routeScenarioIds(route) {
  return [...new Set(routePaths(route).flatMap(path => path.steps.map(step => step.scenario_id)))];
}

export function routePresentation(route, skeleton, ordered = true) {
  const paths = routePaths(route).map(path => {
    const stages = [];
    for (const step of path.steps) {
      const scenario = skeleton.scenarioById.get(step.scenario_id);
      if (!scenario) continue;
      const method = step.method_id && skeleton.methodById.get(step.method_id);
      let stage = stages.at(-1);
      if (!stage || stage.scenarioId !== step.scenario_id) {
        stage = { scenarioId: step.scenario_id, scenario: scenario.name, methods: [] };stages.push(stage);
      }
      if (method && !stage.methods.includes(method.name)) stage.methods.push(method.name);
    }
    return { stages };
  }).filter(path => path.stages.length);
  const unique = new Map();
  for (const stage of paths.flatMap(path => path.stages)) {
    const previous = unique.get(stage.scenarioId);
    unique.set(stage.scenarioId, { ...stage, methods: [...new Set([...(previous?.methods ?? []), ...stage.methods])] });
  }
  if (unique.size <= 1 || !ordered) return {
    kind: unique.size === 1 ? 'single' : 'related',
    // Only methods evidenced for this question are collected above. Never
    // expand the scenario's full method catalogue into the question panel.
    paths: [{ stages: [...unique.values()].map(stage => ({ ...stage, methods: unique.size === 1 ? stage.methods : [] })) }],
  };
  // Do not draw a dependency between alternative solutions. Only the stages
  // within one solution receive arrows; a single-stage solution has no method.
  return { kind: paths.length > 1 ? 'parallel' : 'chain', paths: paths.map(path => ({
    stages: path.stages.map(stage => ({ ...stage, methods: path.stages.length > 1 ? stage.methods : [] })),
  })) };
}

export function routeLabels(route, skeleton) {
  return routePresentation(route, skeleton).paths.flatMap(path => path.stages.map(stage => ({ scenario: stage.scenario, method: stage.methods.join(' / ') || null })));
}

export function mergeQuestionRoute(previous, next) {
  if (!previous || next.paths?.length) return next;
  const oldEdges = new Set(routePaths(previous).flatMap(path => path.steps).map(step => `${step.scenario_id}:${step.method_id}`));
  if (next.steps.every(step => oldEdges.has(`${step.scenario_id}:${step.method_id}`))) return previous;
  // Legacy followups do not say how the new step depends on the original
  // solution. Keep paths separate rather than inventing a sequential edge.
  return { ...next, steps: previous.steps, paths: [...routePaths(previous), ...routePaths(next)] };
}
