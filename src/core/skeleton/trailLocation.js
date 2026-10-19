export const trailIdentity = node => `${node.kind}:${node.id}`;
export const trailBranchPath = (parent, node) => [parent, trailIdentity(node)].filter(Boolean).join('/');
// A knowledge ID owns learning data; a branch path owns only its UI expansion.
export function trailExpansionKey(parent, node) {
  return ['block', 'group'].includes(node.kind) ? trailIdentity(node) : trailBranchPath(parent, node);
}

export function routeTrailLocation(skeleton, scenarioIds, previous = {}) {
  const expanded = { ...previous };
  let targetPath = null;
  for (const id of scenarioIds) {
    const groups = skeleton.groups.filter(group => group.scenario_ids.includes(id));
    // Prefer one entry containing the route's other stages, rather than
    // expanding every alias of the same concept throughout the tree.
    const group = groups.slice().sort((a,b) => b.scenario_ids.filter(s => scenarioIds.includes(s)).length
      - a.scenario_ids.filter(s => scenarioIds.includes(s)).length)[0];
    if (!group) continue;
    const block = `block:${group.block_id}`;
    expanded[block] = true;
    const parent = group.scenario_ids.length === 1 ? block : `${block}/group:${group.id}`;
    if (group.scenario_ids.length !== 1) expanded[`group:${group.id}`] = true;
    targetPath = `${parent}/scenario:${id}`;
    expanded[targetPath] = true;
  }
  return { expanded, targetPath };
}
