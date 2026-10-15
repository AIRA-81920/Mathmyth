import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { fingerprintQuestion } from '../src/core/mastery/fingerprint.js';

const SQL = await initSqlJs();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const methodId = 'M.lhopital', scenarioId = 'S.limit.0over0';
async function setup() {
  let record;
  const storage = { load: async () => record, commit: async (bytes, revision) => { record = { bytes, revision: revision + 1 }; return revision + 1; } };
  const engine = new DatabaseEngine({ SQL, schemaSql, storage });
  const { learnerId } = await engine.initializeDatabase();
  await engine.transaction((db) => db.run('INSERT INTO encounter(id,learner_id,scenario_id,method_id,is_main,source,occurred_at) VALUES(?,?,?,?,1,\'ask\',?)',
    ['seen', learnerId, scenarioId, methodId, new Date().toISOString()]));
  const items = await Promise.all(['sin','log','exp'].map(async (op, index) => {
    const base = { question: `求 ${op}(x)/x 的极限 ${index}`, variables: ['x'], structure: { op: 'divide', args: [{ op, args: [{ op: 'var' }] }, { op: 'var' }] } };
    return { ...base, solution: '先检查条件再求导，结果为1。', ...await fingerprintQuestion(base), coreMethodIds: [methodId], applicableMethodIds: [methodId], candidateMethodIds: [methodId], options: [{ id: methodId, name: '洛必达' }] };
  }));
  return { engine, items };
}
const selection = { mode: 'selection', selectedIds: [methodId] };
const steps = { mode: 'steps', steps: '先检查0/0及可导条件，然后对分子分母分别求导。', assessment: { outcome: 'right', methodIds: [methodId], feedback: '关键操作正确。' } };
test('first complete practice item is durable and can be answered while later items append', async () => {
  const { engine, items } = await setup();
  let run = await engine.createPracticeRun({ scenarioId,methodId,items:[items[0]] });
  assert.equal(run.generationStatus,'preparing'); assert.equal(run.items.length,1);
  await engine.gradePracticeItem(run.id,run.items[0].id,selection);
  run = await engine.appendPracticeItems(run.id,[items[1]]);
  assert.equal(run.items[0].answer.outcome,'right'); assert.equal(run.items.length,2);
  await assert.rejects(engine.appendPracticeItems(run.id,[],'complete'));
  run = await engine.appendPracticeItems(run.id,[items[2]],'complete');
  assert.equal(run.generationStatus,'complete'); assert.equal(run.items.length,3);
  const candidate = await engine.prepareImport(await engine.exportDatabase()); await engine.commitImport(candidate.token);
  assert.equal(engine.loadActivePractice().items[0].answer.outcome,'right'); engine.close();
});
test('interrupted generation keeps ready questions and allows ending a partial round', async () => {
  const { engine,items } = await setup();
  const run = await engine.createPracticeRun({ scenarioId,methodId,items:[items[0]] });
  const candidate = await engine.prepareImport(await engine.exportDatabase()); await engine.commitImport(candidate.token);
  assert.equal(engine.loadActivePractice().generationStatus,'failed');
  assert.ok((await engine.advancePracticeItem(run.id,run.items[0].id)).finishedAt); engine.close();
});
test('deleting chat during generation leaves a resumable failed round rather than a permanently preparing run', async () => {
  const {engine,items}=await setup(), timestamp=new Date().toISOString();
  await engine.saveChanges({conversations:[{id:'chat',title:'题目',createdAt:timestamp,updatedAt:timestamp,messages:[{id:'source-user',role:'user',content:'求极限',createdAt:timestamp}]}]});
  await engine.transaction(db=>db.run("UPDATE encounter SET conversation_id='chat' WHERE id='seen'"));
  const run=await engine.createPracticeRun({scenarioId,methodId,items:[items[0]]});
  await engine.deleteConversation('chat',false);
  assert.equal(engine.loadActivePractice().generationStatus,'failed');
  assert.ok((await engine.advancePracticeItem(run.id,run.items[0].id)).finishedAt);engine.close();
});
test('real SQLite practice separates recognition/execution, credits a question once, and requires distinct faces', async () => {
  const { engine, items } = await setup();
  const run = await engine.createPracticeRun({ scenarioId, methodId, items });
  for (const item of run.items) await engine.gradePracticeItem(run.id, item.id, selection);
  await engine.gradePracticeItem(run.id, run.items[0].id, selection);
  let mastery = engine.loadTrail().mastery;
  assert.equal(mastery.find((row) => row.targetType === 'scenario').state, 'mastered');
  assert.equal(mastery.find((row) => row.targetType === 'scenario').successCount, 3);
  assert.equal(mastery.find((row) => row.targetType === 'method').successCount, 0);
  for (const item of run.items.slice(0,2)) await engine.gradePracticeItem(run.id, item.id, steps);
  assert.equal(engine.loadTrail().mastery.find((row) => row.targetType === 'method').state, 'mastered');
  await engine.gradePracticeItem(run.id, run.items[2].id, { ...steps, assessment: { ...steps.assessment, outcome: 'wrong' } });
  mastery = engine.loadTrail().mastery.find((row) => row.targetType === 'method');
  assert.equal(mastery.state, 'consolidating'); assert.equal(mastery.successCount, 1); assert.equal(mastery.faces.length, 2);
  assert.ok(engine.loadTrail().encounters.some((row) => row.practiceItemId && row.question));
  engine.close();
});
test('revealing a solution preserves counts and prevents later independent credit, including after export/import', async () => {
  const { engine, items } = await setup();
  const run = await engine.createPracticeRun({ scenarioId, methodId, items });
  await engine.gradePracticeItem(run.id, run.items[0].id, steps);
  await engine.revealPracticeItem(run.id, run.items[0].id);
  await engine.revealPracticeItem(run.id, run.items[1].id);
  const candidate = await engine.prepareImport(await engine.exportDatabase());
  await engine.commitImport(candidate.token);
  await engine.gradePracticeItem(run.id, run.items[1].id, steps);
  assert.equal(engine.loadTrail().mastery.find((row) => row.targetType === 'method').successCount, 1);
  assert.equal(engine.loadPracticeItem(run.items[1].id).answer.revealed, true);
  engine.close();
});
