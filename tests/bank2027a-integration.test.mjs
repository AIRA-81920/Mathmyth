import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import initSqlJs from 'sql.js';
import { questionBanks } from '../src/assets/practice/question-banks/index.js';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';
import { localTargets, prepareLocalRound } from '../src/core/practice/bank.js';
import { prepareRouteQuestion } from '../src/core/practice/routes.js';
import { practiceChoices } from '../src/core/mastery/choices.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { pickChatPractice } from '../src/core/chat/practice.js';

const skeleton=await readActiveSkeleton(), bank=questionBanks.find(b=>b.bankId==='bank2027a');
const before=JSON.parse(await readFile(new URL('../../题库整理/bank2027a/接入前快照/bank2027a.json',import.meta.url),'utf8'));
const SQL=await initSqlJs(), schemaSql=await readFile(new URL('../src/core/db/schema.sql',import.meta.url),'utf8');
async function setup(bytes) {
  const db=new DatabaseEngine({SQL,schemaSql,storage:{load:async()=>bytes?{bytes,revision:1}:null,commit:async(_bytes,revision)=>revision+1}});
  await db.initializeDatabase();return db;
}
test('new-bank review preserves raw source, bank402 and training identities; incomplete gate stays unpublished',async()=>{
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(new URL('../src/assets/practice/question-banks/bank402.json',import.meta.url))),'3a8be37923273c3507432983946d9072d73bdde799d9416bdb1be05b473949b2');
  assert.equal(hash(await readFile(new URL('../../题库整理/bank2027a/source/question-bank.jsonl',import.meta.url))),bank.sourceSha256);
  assert.equal(bank.questions.length,77);assert.ok(!bank.questions.some(q=>q.metadata.originalId===77));
  for(const q of bank.questions) {
    const old=before.questions.find(o=>o.metadata.motherId===q.metadata.motherId);
    assert.equal(q.questionKey,old.questionKey);assert.equal(q.faceKey,old.faceKey);
    assert.deepEqual(q.metadata.originalRecord,old.metadata.originalRecord);
    assert.equal(q.classificationReview.needsReview,true);assert.equal(q.metadata.userApprovedClassic,false);
  }
});
test('new questions grade, unlock only their encountered topic and deduplicate credit across levels after restart',async()=>{
  const db=await setup(),target=localTargets(skeleton).find(t=>t.scenarioId==='S.limit.power_indeterminate');
  try {
    assert.deepEqual(practiceChoices(skeleton,db.loadTrail(),{includePrepared:true}),[]);
    const items=await prepareLocalRound(target,skeleton,'single');
    assert.ok(items.every(q=>q.metadata.bankId==='bank2027a'));
    let run=await db.createPracticeRun({scenarioId:target.scenarioId,methodId:target.methodId,items,localPrepared:true});
    run=await db.gradePracticeItem(run.id,run.items[0].id,{mode:'selection',selectedIds:[items[0].routes.find(r=>r.valid).id]});
    assert.equal(run.items[0].answer.outcome,'right');
    run=await db.gradePracticeItem(run.id,run.items[1].id,{mode:'selection',selectedIds:[items[1].routes.find(r=>!r.valid).id]});
    assert.equal(run.items[1].answer.outcome,'wrong');
    const choices=practiceChoices(skeleton,db.loadTrail(),{includePrepared:true});
    assert.ok(choices.some(c=>c.localReady&&c.scenarioId===target.scenarioId));
    assert.ok(choices.every(c=>!c.scenarioName.includes('傅里叶')));
    const restored=await setup(await db.exportBackup());
    try {
      const oldCounts=restored.loadTrail().mastery.map(m=>[m.targetType,m.targetId,m.successCount]);
      const q=await prepareRouteQuestion(items[0],skeleton,'multi');
      const repeat=await restored.createPracticeRun({scenarioId:target.scenarioId,methodId:target.methodId,items:[q],localPrepared:true});
      await restored.gradePracticeItem(repeat.id,repeat.items[0].id,{mode:'selection',selectedIds:q.routes.filter(r=>r.valid).map(r=>r.id)});
      assert.deepEqual(restored.loadTrail().mastery.map(m=>[m.targetType,m.targetId,m.successCount]),oldCounts);
      assert.equal(restored.loadPracticeItem(run.items[0].id).answer.outcome,'right');
      assert.equal(restored.listPracticeHistory().items.length,4);
    } finally {restored.close();}
  } finally {db.close();}
});
test('a revised route does not rewrite an old exercise snapshot on backup/restart',async()=>{
  const db=await setup();
  try {
    const old=await prepareRouteQuestion(before.questions.find(q=>q.metadata.originalId===47),skeleton);
    const current=await prepareRouteQuestion(bank.questions.find(q=>q.metadata.originalId===47),skeleton);
    const target=localTargets(skeleton).find(t=>t.scenarioId===old.entranceScenarioId);
    const run=await db.createPracticeRun({scenarioId:target.scenarioId,methodId:target.methodId,items:[current],localPrepared:true});
    // 模拟更新前已保存的快照；新版创建入口应拒绝主动提交过时加工稿。
    db.ensureOpen().run('UPDATE practice_item SET question=? WHERE id=?',[JSON.stringify(old),run.items[0].id]);
    const restored=await setup(await db.exportBackup());
    try {
      const snapshot=restored.loadPracticeItem(run.items[0].id).question;
      assert.equal(snapshot.metadata.contentVersion,1);assert.equal(snapshot.solution,old.solution);
      const revised=bank.questions.find(q=>q.metadata.originalId===47);
      assert.equal(revised.metadata.contentVersion,2);assert.notEqual(revised.solution,snapshot.solution);
      assert.equal(revised.questionKey,snapshot.questionKey);
    } finally {restored.close();}
  } finally {db.close();}
});
test('chat practice can select new-bank questions without sending answers or reviving the removed trial',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,init)=>{
    calls++;const payload=JSON.parse(JSON.parse(init.body).messages[1].content);
    assert.ok(payload.questions.length>0);assert.ok(payload.questions.every(q=>q.id.includes('candidate.bank2027a.')));
    assert.ok(!JSON.stringify(payload).includes('solution'));assert.ok(!JSON.stringify(payload).includes('"valid"'));
    const q=payload.questions.find(q=>q.id.endsWith('.38'));
    return Response.json({choices:[{message:{content:JSON.stringify({action:'practice',target_id:q.target_id,question_id:q.id,level:'single'})},finish_reason:'stop'}]});
  };
  try {
    const selected=await pickChatPractice({config:{apiBase:'https://mock.invalid/v1',apiKey:'fixture-only',model:'mock'},
      conversation:{id:'power-chat',messages:[{id:'source',role:'user',content:'求 x^x 在 x 趋于0正侧的极限'},{id:'answer',role:'assistant',content:'先取对数，再求 x ln x 的极限，最后还原，结果为1。'}]},
      text:'考我一下',skeleton,trail:{encounters:[{conversationId:'power-chat',messageId:'answer',scenarioId:'S.limit.power_indeterminate'}]},usage:[]});
    assert.equal(calls,1);assert.equal(selected.question.metadata.bankId,'bank2027a');assert.equal(selected.question.metadata.originalId,38);
    assert.equal(selected.sourceMessageId,'source');assert.equal(selected.question.entranceScenarioId,'S.limit.power_indeterminate');
  } finally {globalThis.fetch=original;}
});
