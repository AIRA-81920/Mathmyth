// Question banks are compiled off-device. This reader never upgrades drafts or
// invents missing routes, and keeps the original curated targets' stable IDs.
export function extendPreparedTargets(baseTargets, banks, taxonomy) {
  const imported = [], identities = new Set();
  for (const bank of banks) {
    if (bank.schema !== 'mathmyth-question-bank/v1' || !Array.isArray(bank.questions)) throw new Error('本地题库格式无效。');
    for (const question of bank.questions) {
      if (question.metadata?.reviewStatus !== 'worked_example_checked') throw new Error('未审核的题不能进入本地题库。');
      if (identities.has(question.questionKey)) continue;
      identities.add(question.questionKey); imported.push(question);
    }
  }
  const merge = (first, next) => {
    // A semantic revision replaces future content of the same training identity.
    // Older curated copies must not hide repaired labels. Stored history is a
    // separate snapshot and is never rewritten here.
    const latest = new Map(imported.map(q => [q.metadata.motherId, q]));
    const result = first.map(q => {
      const revision = latest.get(q.metadata.motherId);
      return revision && (revision.metadata.contentVersion ?? 1) > (q.metadata.contentVersion ?? 1) ? revision : q;
    }), mothers = new Set(result.map((q) => q.metadata.motherId));
    for (const q of next) if (!mothers.has(q.metadata.motherId)) { mothers.add(q.metadata.motherId); result.push(q); }
    return result;
  };
  const originalScenarios = new Set(baseTargets.map((target) => target.scenarioId));
  const byScenario = new Map();
  for (const q of imported) {
    if (!byScenario.has(q.entranceScenarioId)) byScenario.set(q.entranceScenarioId, []);
    byScenario.get(q.entranceScenarioId).push(q);
  }
  const targets = baseTargets.map((target) => ({ ...target,
    blockName: taxonomy.blockById?.get(taxonomy.scenarioById.get(target.scenarioId)?.block_id)?.name ?? '',
    questions: merge(target.questions, byScenario.get(target.scenarioId) ?? []) }));
  const allQuestions = merge(targets.flatMap((target) => target.questions), imported);
  for (const [scenarioId, primary] of byScenario) {
    if (originalScenarios.has(scenarioId)) continue;
    const scene = taxonomy.scenarioById.get(scenarioId), group = taxonomy.groups.find((item) => item.scenario_ids.includes(scenarioId));
    if (!scene || !group) throw new Error(`题库情景不在当前骨架：${scenarioId}`);
    // A small reviewed pool can be paired with exercises from the same real
    // scenario group. Always keep at least one question of the selected scene.
    const related = primary.length < 3 ? allQuestions.filter((q) => group.scenario_ids.includes(q.entranceScenarioId)) : [];
    const pool = merge(primary, related);
    targets.push({ id: `RT.pool.${scenarioId}`, scenarioId, methodId: primary[0].routes.find((route) => route.preferred).steps[0].methodId,
      name: scene.name, batchId: 'reviewed-imports', questions: pool,
      blockName: taxonomy.blockById?.get(scene.block_id)?.name ?? '',
      primaryScenarioId: scenarioId, primaryQuestionCount: primary.length, groupName: group.name,
      presentation: { title: scene.name, description: scene.definition, example: '' } });
  }
  return targets;
}
