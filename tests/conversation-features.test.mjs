import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { SCHEMA_VERSION } from '../src/core/db/constants.js';
import { auxiliaryRequest } from '../src/core/ai/auxiliary.js';
import { methodDiscussionPrompt } from '../src/core/ai/methodContext.js';

test('auxiliary fields use the actual provider dialect and switch only always-thinking auxiliary models', () => {
  const request = (apiBase, model, extra = {}) => auxiliaryRequest({ apiBase, model, ...extra });
  assert.deepEqual(request('https://api.deepseek.com','deepseek-flash').parameters,{thinking:{type:'disabled'}});
  assert.deepEqual(request('https://open.bigmodel.cn/api/paas/v4/','glm-4.6v-flash').parameters,{thinking:{type:'disabled'}});
  assert.equal(request('https://api.moonshot.cn/v1','kimi-k3').config.model,'kimi-k2.6');
  assert.deepEqual(request('https://api.moonshot.cn/v1','kimi-k3').parameters,{thinking:{type:'disabled'}});
  assert.deepEqual(request('https://tokendance.space/gateway/v1','kimi-k2.5').parameters,{thinking:{type:'disabled'}});
  assert.deepEqual(request('https://api.siliconflow.cn/v1','Qwen/Qwen3-8B').parameters,{enable_thinking:false});
  assert.deepEqual(request('https://api.siliconflow.cn/v1','Qwen/Qwen3-VL-8B-Instruct').parameters,{});
  assert.equal(request('https://open.bigmodel.cn/api/paas/v4/','glm-5.3').config.model,'glm-4.6v-flash');
  assert.deepEqual(request('https://unknown.example/v1','kimi-k3').parameters,{});
  assert.deepEqual(request('https://unknown.example/v1','my-model',{auxiliaryThinking:'chat_template'}).parameters,{chat_template_kwargs:{enable_thinking:false}});
  assert.deepEqual(request('https://api.moonshot.cn/v1','kimi-k3',{auxiliaryModel:'kimi-k3'}).parameters,{});
});

const skeleton = {
  methodById: new Map([['M.example',{ name:'方法甲',definition:'定义资料',one_liner:'原理资料',preconditions:['前提甲'],example_problems:[] }]]),
  scenariosForMethod: new Map([['M.example',['S.example']]]),
  scenarioById: new Map([['S.example',{name:'情景乙',definition:'情景定义',signals:['信号甲'],methods:[{method_id:'M.example',when_to_prefer:'条件乙',priority:1}]}]]),
};
test('method discussions carry definitions, conditions and reverse-link context without claiming textbook provenance', () => {
  const prompt = methodDiscussionPrompt(skeleton,'M.example');
  for (const term of ['方法甲','定义资料','前提甲','情景乙','条件乙']) assert.ok(prompt.includes(term));
  assert.ok(prompt.includes('不编造教材原文')); assert.throws(()=>methodDiscussionPrompt(skeleton,'missing'));
});

async function harness() {
  const key=randomUUID(), answers=[], titles=[];
  const requests = (jobs) => (options) => new Promise((resolve,reject)=>jobs.push({...options,resolve,reject}));
  globalThis.__conversationFeatureHarness ??= new Map();
  globalThis.__conversationFeatureHarness.set(key,{answer:requests(answers),title:requests(titles),skeleton});
  const url=new URL('../src/store/appStore.js',import.meta.url);
  let source=await readFile(url,'utf8');
  source=source.replace("import { streamAnswer } from '../core/ai/client.js';",`const streamAnswer=globalThis.__conversationFeatureHarness.get('${key}').answer;`)
    .replace("import { generateTitle } from '../core/ai/title.js';",`const generateTitle=globalThis.__conversationFeatureHarness.get('${key}').title;`)
    .replace("await (await import('../core/skeleton/load.js')).loadSkeleton()",`globalThis.__conversationFeatureHarness.get('${key}').skeleton`)
    .replace("from 'zustand'",`from '${import.meta.resolve('zustand')}'`)
    .replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,url).href}'`);
  const {useAppStore:store}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  store.setState({storageInitialized:true});store.getState().setModelConfig({apiKey:'fixture-only'});store.getState().completeOnboarding();
  const state=()=>store.getState();const conversation=id=>state().conversations.find(entry=>entry.id===(id??state().currentConversationId));
  return {store,state,conversation,answers,titles};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('short title is independent of foreground completion and a late title cannot overwrite a manual rename',async()=>{
  const {state,conversation,answers,titles}=await harness();
  const pending=state().sendMessage('这里是一大段题目，标题不能直接取这段题面');
  assert.equal(conversation().title,'新对话');assert.equal(answers.length,1);assert.equal(titles.length,1);
  titles[0].resolve('极限相消分析');await tick();assert.equal(conversation().title,'极限相消分析');
  answers[0].resolve('答案');await pending;
  state().newConversation();const id=state().currentConversationId;const second=state().sendMessage('另一道题');
  await state().updateConversation(id,{title:'我手动起的名字'});assert.equal(titles[1].signal.aborted,true);
  titles[1].resolve('迟到的自动标题');answers[1].resolve('解答');await second;await tick();
  assert.equal(conversation(id).title,'我手动起的名字');assert.equal(conversation(id).titleStatus,'manual');
});

test('global trail expansion survives existing-chat switches and resets on new chat, including stale scroll events',async()=>{
  const {state}=await harness();const first=state().currentConversationId;
  state().toggleTrailNode('block:B.limit');state().setTheme('dark');const epoch=state().trailEpoch;state().setTrailScroll(180,epoch);
  state().openMethod('M.example');state().closeMethod();await state().selectConversation(first);
  assert.equal(state().preferences.trailExpanded['block:B.limit'],true);assert.equal(state().preferences.trailScroll,180);
  state().newConversation();state().setTrailScroll(999,epoch);
  assert.deepEqual(state().preferences.trailExpanded,{});assert.equal(state().preferences.trailScroll,0);assert.equal(state().preferences.theme,'dark');
});

test('method chat streams into its own persisted conversation without changing the main chat or clearing the outline',async()=>{
  const {state,conversation,answers,titles}=await harness();const main=state().currentConversationId;
  state().toggleTrailNode('block:B.limit');state().openMethod('M.example');await state().openMethodChat();
  const pending=state().sendMethodMessage('为什么条件甲是必要的？');await tick();const method=state().methodConversationId;
  assert.notEqual(main,method);assert.equal(state().currentConversationId,main);assert.equal(conversation(main).messages.length,0);
  assert.equal(state().preferences.trailExpanded['block:B.limit'],true);
  assert.ok(answers[0].systemPrompt.includes('条件乙'));answers[0].onDelta('解释');
  state().setMethodChatOpen(false);answers[0].resolve('完整解释');titles[0].resolve('讨论条件甲');await pending;await tick();
  await state().openMethodChat();assert.equal(state().methodConversationId,method);assert.equal(conversation(method).messages[1].content,'完整解释');
});

test('deleting a chat aborts its title and late auxiliary output cannot recreate it',async()=>{
  const {state,answers,titles}=await harness();const id=state().currentConversationId;const pending=state().sendMessage('删除这段对话');
  await state().deleteConversation(id,false);assert.equal(titles[0].signal.aborted,true);
  titles[0].resolve('旧标题');answers[0].resolve('旧答案');await pending;await tick();assert.ok(!state().conversations.some(entry=>entry.id===id));
});

test('Kimi preserved reasoning is returned as private context but never mixed into public answer text',async()=>{
  const {state,conversation,answers,titles}=await harness();state().setModelConfig({providerId:'kimi',apiBase:'https://api.moonshot.cn/v1',model:'kimi-k3'});
  const first=state().sendMessage('解释');answers[0].onReasoning('私有上下文');answers[0].onDelta('公开解释');answers[0].resolve('公开解释');titles[0].resolve('方法解释');await first;await tick();
  assert.equal(conversation().messages[1].content,'公开解释');const second=state().sendMessage('继续');
  assert.equal(answers[1].messages[1].reasoning_content,'私有上下文');answers[1].resolve('继续解释');await second;
});

const SQL=await initSqlJs();const schemaSql=await readFile(new URL('../src/core/db/schema.sql',import.meta.url),'utf8');
function engine() {let record;return new DatabaseEngine({SQL,schemaSql,storage:{load:async()=>record,commit:async(bytes,revision)=>{record={bytes:bytes.slice(),revision:revision+1};return revision+1;}}});}
const date='2026-10-10T08:00:00.000Z';
const history=(id,extra={})=>({id,title:'简短标题',titleStatus:'auto',createdAt:date,updatedAt:date,...extra,messages:[
  {id:`${id}-u`,role:'user',content:'想了解有理化的条件',createdAt:date},{id:`${id}-a`,role:'assistant',content:'说明分母结构',reasoningContent:'仅作私有上下文',createdAt:date,status:'complete'}]});

test('method context, title status and theme survive real SQLite backup; conceptual chats create no mastery jobs',async()=>{
  const db=engine();await db.initializeDatabase();await db.saveChanges({preferences:{theme:'light',trailExpanded:{'block:B.limit':true},trailScroll:88},conversations:[history('method',{methodId:'M.example'})]});
  assert.equal(await db.claimNextJob(),null);const candidate=await db.prepareImport(await db.exportDatabase());const bootstrap=await db.commitImport(candidate.token);
  assert.equal(bootstrap.preferences.theme,'light');assert.equal(bootstrap.preferences.trailScroll,88);assert.equal(bootstrap.conversations[0].methodId,'M.example');
  const loaded=db.loadConversation('method');assert.equal(loaded.titleStatus,'auto');assert.equal(loaded.messages[1].reasoningContent,'仅作私有上下文');db.close();
});

test('local search matches unloaded message and attachment text with literal parameterized terms',async()=>{
  const db=engine();await db.initializeDatabase();const item=history('search');item.messages[0].attachments=[{id:'doc-search',kind:'document',name:'题目.txt',mime:'text/plain',text:'夹逼准则',bytes:new TextEncoder().encode('夹逼准则')}];
  await db.saveChanges({conversations:[item]});assert.equal(db.searchConversations('有理化')[0].id,'search');assert.equal(db.searchConversations('夹逼')[0].id,'search');
  assert.deepEqual(db.searchConversations("%' OR 1=1 --"),[]);assert.deepEqual(db.searchConversations('不存在'),[]);db.close();
});

test('version-four backups migrate without changing user titles, histories or metadata',async()=>{
  const db=engine();await db.initializeDatabase();await db.saveChanges({conversations:[history('old')]});const old=new SQL.Database(await db.exportDatabase());
  old.run('ALTER TABLE conversation DROP COLUMN method_id; ALTER TABLE conversation DROP COLUMN title_status; ALTER TABLE message DROP COLUMN reasoning_content; PRAGMA user_version=4');
  const candidate=await db.prepareImport(old.export());old.close();await db.commitImport(candidate.token);
  assert.equal(db.db.exec('PRAGMA user_version')[0].values[0][0],SCHEMA_VERSION);assert.equal(db.loadConversation('old').title,'简短标题');assert.equal(db.loadConversation('old').messages[0].content,'想了解有理化的条件');db.close();
});
