import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { validateQuestionRoutes, routeLabels, routePresentation, mergeQuestionRoute } from '../src/core/chat/questionRoutes.js';
import { routeTrailLocation, trailExpansionKey } from '../src/core/skeleton/trailLocation.js';
import { thinkingCapability, answerRequest } from '../src/core/ai/answerThinking.js';
import { normalizePreferences } from '../src/core/config/preferences.js';

const edge = { scenario_id: 'S.limit.function_sequence_limit', method_id: 'M.pointwise_limit', is_main: true };
const timestamp = '2026-10-17T02:00:00.000Z';
const source = { userMessageId: 'u1', answer: '固定x，按模分类。然后判断间断点。', context: [] };
const route = { user_message_id: 'u1', question_index: 1, steps: [{ ...edge, evidence: '固定x，按模分类。' }] };
const result = { encounters: [edge], routes: [route] };

test('routes require a real originating message, existing edge and literal answer evidence', () => {
  const clean = validateQuestionRoutes([route], [edge], source);
  assert.equal(clean[0].steps[0].is_main, undefined);
  assert.equal(clean[0].steps[0].evidence, '固定x，按模分类。');
  for (const invalid of [ { ...route, user_message_id: 'another-chat' }, { ...route, question_index: 0 },
    { ...route, steps: [{ ...edge, evidence: '模型并没有这样说' }] }, { ...route, steps: [{ ...edge, method_id: 'M.fake', evidence: source.answer }] } ]) {
    assert.throws(() => validateQuestionRoutes([invalid], [edge], source));
  }
  assert.throws(() => validateQuestionRoutes([route, route], [edge], source));
  const second = { ...route, question_index: 2 };
  assert.equal(validateQuestionRoutes([route, second], [edge], source).length, 2);
  assert.deepEqual(routeLabels(route, { scenarioById: new Map([[edge.scenario_id, { name: '知识库的名称' }]]), methodById: new Map([[edge.method_id, { name: '实际方法名称' }]]) }), [{ scenario: '知识库的名称', method: '实际方法名称' }]);
});

test('ordered routes survive a real SQLite export/import and followups merge without duplicating their question', async () => {
  const SQL = await initSqlJs();
  const make = () => new DatabaseEngine({ SQL, schemaSql: readFileSync(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8'),
    storage: { load: async () => null, commit: async (_, revision) => revision + 1 } });
  const engine = make(), boot = await engine.initializeDatabase();
  const messages = [{ id: 'u1', role: 'user', content: '原题', status: 'complete' },
    { id: 'a1', role: 'assistant', content: source.answer, status: 'complete' }];
  const save = () => { for (const m of messages) m.createdAt ??= timestamp; return engine.saveChanges({ learnerId: boot.learnerId, modelConfig: {}, conversations: [{ id: 'c1', title: '路线', createdAt:timestamp, updatedAt:timestamp, messages }] }); };
  await save();let claim = await engine.claimNextJob();
  await engine.checkpointJob(claim, ['B.limit']);await engine.completeJob(claim, result);
  assert.equal(engine.loadQuestionRoutes('c1')[0].routes.length, 1);
  messages.push({ id: 'u2', role: 'user', content: '为什么还要比较左右极限？', status: 'complete' },
    { id: 'a2', role: 'assistant', content: '左右极限不相等。', status: 'complete' });
  await save();claim = await engine.claimNextJob();
  await engine.checkpointJob(claim, ['B.limit']);
  const laterEdge = { scenario_id: 'S.limit.discontinuity_classification', method_id: 'M.one_sided_limit', is_main: true };
  await engine.completeJob(claim, { encounters: [{ ...edge, is_main: false }, laterEdge], routes: [{ ...route,
    paths: [{ steps: [...route.steps, { ...laterEdge, evidence: '左右极限不相等。' }] }] }] });
  const rows = engine.loadQuestionRoutes('c1');
  assert.equal(rows.length, 1);assert.equal(rows[0].routes[0].steps.length, 2);
  const copy = make(), candidate = await copy.prepareImport(await engine.exportDatabase());
  await copy.commitImport(candidate.token);
  assert.deepEqual(copy.loadQuestionRoutes('c1'), rows);
  copy.db.run("UPDATE message SET superseded=1 WHERE id='a2'");
  assert.equal(copy.loadQuestionRoutes('c1')[0].routes[0].steps.length, 1);
  copy.db.run("UPDATE message SET superseded=1 WHERE id='u1'");
  assert.equal(copy.loadQuestionRoutes('c1').length, 0);
  copy.close();engine.close();
});

const presentationSkeleton = {
  scenarioById: new Map(['A','B','C'].map(id => [id, { id, name: `情景${id}` }])),
  methodById: new Map(['m1','m2','m3'].map(id => [id, { name: `方法${id}` }])),
};
const stage = (scenario_id, method_id) => ({ scenario_id, method_id, evidence: '解答' });

test('one scenario appears once and branches into only the methods recorded for this question', () => {
  for (const input of [ { steps: [stage('A','m1'), stage('A','m2')] },
    { paths: [{ steps: [stage('A','m1')] }, { steps: [stage('A','m2')] }] } ]) {
    const view = routePresentation(input, presentationSkeleton);
    assert.equal(view.kind,'single');assert.equal(view.paths.length,1);
    assert.deepEqual(view.paths[0].stages,[{scenarioId:'A',scenario:'情景A',methods:['方法m1','方法m2']}]);
    assert.ok(!view.paths[0].stages[0].methods.includes('方法m3'));
  }
});

test('genuine cross-scenario stages keep methods, while alternative solutions stay in separate paths', () => {
  const view = routePresentation({ paths: [{ steps: [stage('A','m1'),stage('A','m2'),stage('B','m3')] },
    { steps: [stage('A','m2'),stage('C','m3')] }] }, presentationSkeleton);
  assert.equal(view.kind,'parallel');assert.equal(view.paths.length,2);
  assert.deepEqual(view.paths.map(path=>path.stages.map(step=>step.scenarioId)),[['A','B'],['A','C']]);
  assert.deepEqual(view.paths[0].stages[0].methods,['方法m1','方法m2']);
  const returning = routePresentation({ steps: [stage('A','m1'),stage('B','m2'),stage('A','m3')] },presentationSkeleton);
  assert.deepEqual(returning.paths[0].stages.map(step=>step.scenarioId),['A','B','A']);
  const legacy = routePresentation({steps:[stage('A','m1'),stage('B','m2')]},presentationSkeleton,false);
  assert.equal(legacy.kind,'related');assert.ok(legacy.paths[0].stages.every(step=>!step.methods.length));
});

test('followups do not fabricate a dependency by appending a new method to the old solution', () => {
  const previous={steps:[stage('A','m1')]},next={steps:[stage('B','m2')]};
  const view=routePresentation(mergeQuestionRoute(previous,next),presentationSkeleton);
  assert.equal(view.kind,'parallel');assert.deepEqual(view.paths.map(path=>path.stages.length),[1,1]);
  const explicit={steps:[stage('A','m1'),stage('B','m2')],paths:[{steps:[stage('A','m1'),stage('B','m2')]}]};
  assert.equal(mergeQuestionRoute(previous,explicit),explicit);
});

test('aliases share knowledge IDs but have independent expansion keys and precise route locations', () => {
  const scenario={kind:'scenario',id:'S.shared'};
  const sequence='block:B.limit/group:G.sequence',continuity='block:B.limit/group:G.continuity';
  const first=trailExpansionKey(sequence,scenario),second=trailExpansionKey(continuity,scenario);
  assert.notEqual(first,second);
  const expanded={[first]:true};assert.equal(Boolean(expanded[second]),false);
  const skeleton={groups:[{id:'G.sequence',block_id:'B.limit',scenario_ids:['S.shared','S.other']},
    {id:'G.continuity',block_id:'B.limit',scenario_ids:['S.shared','S.end']}]};
  const location=routeTrailLocation(skeleton,['S.shared','S.end']);
  assert.equal(location.expanded[second],true);assert.equal(location.expanded[first],undefined);
  assert.equal(location.targetPath,continuity+'/scenario:S.end');
});

test('legacy associations stay explicitly unordered rather than inventing a route', async () => {
  const SQL=await initSqlJs();const engine=new DatabaseEngine({SQL,schemaSql:readFileSync(new URL('../src/core/db/schema.sql',import.meta.url),'utf8'),storage:{load:async()=>null,commit:async(_, revision)=>revision+1}});
  const boot=await engine.initializeDatabase();
  await engine.saveChanges({learnerId:boot.learnerId,conversations:[{id:'legacy',title:'旧题',createdAt:timestamp,updatedAt:timestamp,messages:[{id:'u1',role:'user',content:'题',status:'complete',createdAt:timestamp},{id:'a1',role:'assistant',content:source.answer,status:'complete',createdAt:timestamp}]}]});
  const claim=await engine.claimNextJob();await engine.completeJob(claim,[edge]);
  assert.equal(engine.loadQuestionRoutes('legacy')[0].ordered,false);
  engine.db.run("UPDATE queue_job SET status='failed',attempts=3");
  engine.db.run("UPDATE message SET is_math_question=1 WHERE id='u1'");
  assert.equal(engine.loadQuestionRoutes('legacy')[0].status,'failed');
  assert.equal((await engine.retryQuestionRoutes('another-chat')).retried,0);
  assert.equal((await engine.retryQuestionRoutes('u1')).retried,1);
  assert.equal(engine.loadQuestionRoutes('legacy')[0].status,'pending');
  engine.close();
});

test('the actual foreground request receives the selected thinking mode', async () => {
  const { useAppStore } = await import('../src/store/appStore.js');
  const previousFetch = globalThis.fetch, payloads = [];
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '已完成。' } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    useAppStore.setState({ conversations: [], currentConversationId: null, dataOperation: null,
      modelConfig: { apiBase: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'qa-only' },
      preferences: normalizePreferences({ answerThinking: 'disabled' }) });
    await useAppStore.getState().sendMessage('测试前台思考开关');
    const payload = payloads.find(item => item.messages.some(message => message.role === 'user' && message.content === '测试前台思考开关'));
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal(useAppStore.getState().conversations[0].messages.at(-1).status,'complete');
  } finally { globalThis.fetch = previousFetch }
});

test('foreground thinking uses provider switches without changing auxiliary settings or unknown gateways', () => {
  const config={apiBase:'https://api.deepseek.com',model:'deepseek-flash',auxiliaryThinking:'none'};
  assert.deepEqual(answerRequest(config,'disabled').parameters,{thinking:{type:'disabled'}});
  assert.deepEqual(answerRequest(config,'enabled').parameters,{thinking:{type:'enabled'}});
  assert.equal(answerRequest(config,'enabled').config.auxiliaryThinking,'none');
  assert.equal(answerRequest({...config,model:'deepseek-chat'},'enabled').config.model,'deepseek-reasoner');
  assert.deepEqual(answerRequest({...config,apiBase:'https://gateway.example'},'enabled').parameters,{});
  assert.equal(thinkingCapability({apiBase:'https://api.moonshot.cn/v1',model:'kimi-k3'}).switchable,false);
  assert.equal(thinkingCapability({apiBase:'https://api.moonshot.cn/v1',model:'kimi-k2.5'}).switchable,true);
  assert.equal(normalizePreferences({answerThinking:'enabled'}).answerThinking,'enabled');
  assert.equal(normalizePreferences({answerThinking:'invalid'}).answerThinking,'auto');
});
