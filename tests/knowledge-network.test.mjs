import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { createKnowledgeIndex, locationScenarios } from '../src/core/knowledge/index.js';
import { parseEncounters } from '../src/core/ai/locate.js';
import { preparedRouteTargets } from '../src/assets/practice/route-bank.js';
import { withTaskDimensions } from '../src/core/practice/classification.js';

const skeleton=await readActiveSkeleton();
test('repaired runtime content uses real operations while the original source and training identities survive',async()=>{
  const bank=JSON.parse(await readFile(new URL('../src/assets/practice/question-banks/bank402.json',import.meta.url),'utf8'));
  const old=JSON.parse(await readFile(new URL('../../题库整理/knowledge-v2/迁移前备份/bank402.json',import.meta.url),'utf8'));
  for(const q of bank.questions){const before=old.questions.find(b=>b.metadata.originalId===q.metadata.originalId);assert.equal(q.questionKey,before.questionKey);assert.equal(q.faceKey,before.faceKey);assert.deepEqual(q.metadata.originalRecord,before.metadata.originalRecord);}
  const question=id=>bank.questions.find(q=>q.metadata.originalId===id);
  assert.deepEqual(question(30).routes.find(r=>r.preferred).steps.map(s=>s.methodId),['M.product_telescoping','M.important_limit']);
  assert.equal(question(24).entranceScenarioId,'S.limit.function_sequence_limit');
  assert.equal(question(58).entranceScenarioId,'S.deriv.inverse');
  assert.equal(question(326).routes.find(r=>r.preferred).steps[0].methodId,'M.continuity_rules');
  for(const copy of preparedRouteTargets.flatMap(t=>t.questions).filter(q=>q.metadata.motherId==='candidate.bank402.13')){
    assert.equal(copy.entranceScenarioId,'S.limit.growth_balance');assert.equal(copy.metadata.contentVersion,2);
  }
  assert.equal(question(13).overlays[0].role,'unknown');assert.equal(question(6).overlays[0].role,'given');
});
test('curated connections extend background lookup across chapters without admitting unrelated nodes',()=>{
  const index=createKnowledgeIndex(skeleton);assert.equal(index.relations.length,8);
  const candidates=locationScenarios(skeleton,['B.defint']);assert.ok(candidates.some(s=>s.id==='S.mvt.rolle_equality'));
  const entry={scenario_id:'S.mvt.rolle_equality',method_id:'M.rolle_theorem',is_main:true};
  assert.throws(()=>parseEncounters(JSON.stringify({encounters:[entry]}),skeleton,['B.defint']));
  assert.equal(parseEncounters(JSON.stringify({encounters:[entry]}),skeleton,['B.defint'],new Set(candidates.map(s=>s.id))).length,1);
  assert.throws(()=>createKnowledgeIndex(skeleton,{schema:'mathmyth-knowledge-relations/v1',relations:[{...index.relations[0],review:'candidate'}]}));
});
test('fixed-ray agreement does not certify the two-variable limit',()=>{
  const f=(x,y)=>x*x*y/(x**4+y*y);
  assert.ok(Math.abs(f(1e-6,1e-6))<1e-5);assert.equal(f(.01,.0001),.5);
  assert.match(skeleton.methodById.get('M.polar_transform').steps[4],/一致/);
  assert.ok(skeleton.methodById.get('M.partial_fraction').not_applicable[0].includes('可分成'));
});
test('inferred task metadata never masquerades as reviewed',()=>{
  const q=withTaskDimensions({question:'验证所给函数满足微分方程'});assert.deepEqual(q.task,['verify']);assert.equal(q.classificationReview.needsReview,true);
  assert.throws(()=>withTaskDimensions({question:'求极限',task:['invented']}));
});
