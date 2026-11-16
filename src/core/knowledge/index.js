import { relationsForSkeleton } from './data.js';

// 索引按骨架对象缓存：每次归位都重建一遍纯属浪费（高数 8 条、高中同量级，
// 但校验里的骨架查询是 O(关系数 × 端点)）。
const indexCache = new WeakMap();
function indexFor(skeleton) {
  if (!indexCache.has(skeleton)) indexCache.set(skeleton, createKnowledgeIndex(skeleton));
  return indexCache.get(skeleton);
}

export function createKnowledgeIndex(skeleton, source = relationsForSkeleton(skeleton)) {
  if(source.schema!=='mathmyth-knowledge-relations/v1'||!Array.isArray(source.relations))throw new Error('知识关系格式无效。');
  const bySource=new Map(),ids=new Set();
  for(const r of source.relations) {
    if(ids.has(r.id)||r.review!=='verified'||!['applies_to','continues_into'].includes(r.type)
      ||!r.conditions?.length||!r.evidence?.length||![r.inputState,r.operation,r.output,r.boundary].every(v=>typeof v==='string'&&v.trim()))throw new Error('知识关系缺少审核依据。');
    ids.add(r.id);
    for(const n of [r.from,r.to])if(!['method','scenario'].includes(n.kind)||!(n.kind==='method'?skeleton.methodById:skeleton.scenarioById).has(n.id))throw new Error(`知识关系断链：${r.id}`);
    const key=`${r.from.kind}:${r.from.id}`; if(!bySource.has(key))bySource.set(key,[]); bySource.get(key).push(r);
    if(r.type==='applies_to'&&!skeleton.scenarioById.get(r.to.id).methods.some(e=>e.method_id===r.from.id))throw new Error(`知识适用关系没有正式配对：${r.id}`);
  }
  return {relations:source.relations,bySource};
}
export function methodConnections(skeleton,id,source=relationsForSkeleton(skeleton)) {
  const index=createKnowledgeIndex(skeleton,{...source,relations:source.relations.filter(r=>r.from.kind==='method'&&r.from.id===id)});
  return (index.bySource.get(`method:${id}`)??[]).map(r=>({...r,name:(r.to.kind==='method'?skeleton.methodById:skeleton.scenarioById).get(r.to.id).name}));
}
export function locationScenarios(skeleton,blockIds) {
  const base=blockIds.flatMap(id=>skeleton.scenariosForBlock(id)), ids=new Set(base.map(s=>s.id));
  const methods=new Set(base.flatMap(s=>s.methods.map(m=>m.method_id))),index=indexFor(skeleton);
  for(const r of index.relations)if(r.from.kind==='method'&&methods.has(r.from.id)) {
    if(r.to.kind==='scenario')ids.add(r.to.id);
    else for(const id of skeleton.scenariosForMethod.get(r.to.id)??[])ids.add(id);
  }
  return [...ids].map(id=>skeleton.scenarioById.get(id));
}
