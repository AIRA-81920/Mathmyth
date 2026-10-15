// Visibility is an explicit product policy supplied by the caller. In
// particular, this module does not resolve the exposed-state document conflict.
export function buildTrail(skeleton, data, includeNode) {
  if (typeof includeNode !== 'function') throw new Error('足迹显示规则尚未指定。');
  const mastery = new Map(data.mastery.map((row) => [`${row.targetType}:${row.targetId}`, row]));
  const touched = new Map();
  for (const encounter of data.encounters) {
    const scenario = skeleton.scenarioById.get(encounter.scenarioId);
    if (!scenario) continue;
    if (!touched.has(scenario.id)) touched.set(scenario.id, new Map());
    if (encounter.methodId && scenario.methods.some((edge) => edge.method_id === encounter.methodId)) {
      const methods = touched.get(scenario.id);
      if (!methods.has(encounter.methodId)) methods.set(encounter.methodId, []);
      methods.get(encounter.methodId).push(encounter);
    }
  }
  const scenarioNodes = new Map();
  for (const [id, methods] of touched) {
    const scenario = skeleton.scenarioById.get(id);
    const state = mastery.get(`scenario:${id}`);
    const children = scenario.methods.filter((edge) => methods.has(edge.method_id)).flatMap((edge) => {
      const row = mastery.get(`method:${edge.method_id}`);
      if (!includeNode(row, 'method', edge.method_id)) return [];
      return [{ ...skeleton.methodById.get(edge.method_id), kind: 'method', mastery: row,
        whenToPrefer: edge.when_to_prefer, encounters: methods.get(edge.method_id) }];
    });
    if (!includeNode(state, 'scenario', id) && !children.length) continue;
    scenarioNodes.set(id, { id, name: scenario.name, kind: 'scenario', mastery: state, children });
  }
  return skeleton.blocks.flatMap((block) => {
    const children = skeleton.groups.filter((group) => group.block_id === block.id).flatMap((group) => {
      const nodes = group.scenario_ids.map((id) => scenarioNodes.get(id)).filter(Boolean);
      if (!nodes.length) return [];
      return group.scenario_ids.length === 1 ? nodes : [{ id: group.id, name: group.name, kind: 'group', children: nodes }];
    });
    return children.length ? [{ id: block.id, name: block.name, kind: 'block', children }] : [];
  });
}
