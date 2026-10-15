// Build indexes from supplied mathematical content; never invent missing nodes.
export function createSkeleton(files) {
  const values = Object.values(files);
  const blocks = values.find(Array.isArray)?.slice().sort((a, b) => a.order - b.order) ?? [];
  const grouping = values.find((file) => file?.adjustments && file?.blocks);
  if (!blocks.length || !grouping) throw new Error('骨架数据不完整。');
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const methodById = new Map();
  const scenarioById = new Map();
  const aliases = new Map();
  for (const file of values) {
    for (const method of file?.methods ?? []) {
      if (methodById.has(method.id)) throw new Error(`重复的方法：${method.id}`);
      methodById.set(method.id, { ...method, aliases: [...(method.aliases ?? [])] });
      aliases.set(method.id, method.id);
      for (const alias of method.aliases ?? []) if (alias.startsWith('M.')) aliases.set(alias, method.id);
    }
  }
  for (const item of grouping.adjustments.id_normalization?.map ?? []) {
    if (!methodById.has(item.keep)) throw new Error(`方法别名没有目标：${item.keep}`);
    aliases.set(item.alias_from_kimi, item.keep);
  }
  for (const file of values) {
    for (const scenario of file?.scenarios ?? []) {
      // 01 §4.1 explicitly demotes this source node to an overlay condition.
      if (scenario.id === 'S.limit.parametric_limit') continue;
      if (!blockById.has(scenario.block_id) || scenarioById.has(scenario.id)) throw new Error(`情景引用无效：${scenario.id}`);
      const methods = scenario.methods.map((edge) => {
        const methodId = aliases.get(edge.method_id);
        if (!methodById.has(methodId)) throw new Error(`情景方法断链：${scenario.id}/${edge.method_id}`);
        return { ...edge, method_id: methodId };
      }).sort((a, b) => a.priority - b.priority);
      scenarioById.set(scenario.id, { ...scenario, methods });
    }
  }
  const scenariosForBlock = (id) => [...scenarioById.values()].filter((scenario) => scenario.block_id === id);
  const groups = grouping.blocks.flatMap((block) => block.groups.map((group) => ({
    ...group, block_id: block.block_id, scenario_ids: group.scenario_ids.filter((id) => scenarioById.has(id)),
  })));
  const scenariosForMethod = new Map([...methodById.keys()].map((id) => [id, []]));
  for (const scenario of scenarioById.values()) {
    for (const edge of scenario.methods) scenariosForMethod.get(edge.method_id).push(scenario.id);
  }
  const pendingAdditions = [
    ...(grouping.adjustments.added_scenarios ?? []).filter((item) => !scenarioById.has(item.id)),
    ...(grouping.adjustments.methods_to_add ?? []).filter((item) => !methodById.has(item.id)),
  ];
  return { blocks, blockById, scenarioById, methodById, aliases, groups, scenariosForBlock, scenariosForMethod, pendingAdditions };
}
