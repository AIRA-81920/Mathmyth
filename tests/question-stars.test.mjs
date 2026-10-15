import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { SCHEMA_VERSION } from '../src/core/db/constants.js';
import { rows } from '../src/core/db/validation.js';

const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const timestamp = '2026-10-12T01:00:00.000Z';
const image = { id: 'photo', name: '题目.png', mime: 'image/png', bytes: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC', 'base64')) };
const conversation = (id = 'chat', content = '求 $\\lim_{x\\to0}\\sin x/x$。') => ({ id, title: '极限', createdAt: timestamp, updatedAt: timestamp,
  messages: [{ id: `${id}-u`, role: 'user', content, createdAt: timestamp }, { id: `${id}-a`, role: 'assistant', content: '极限等于1。', status: 'complete', createdAt: timestamp }] });
async function setup(record = null) {
  const storage = { record, fail: false, load: async () => storage.record, commit: async (bytes, revision) => {
    if (storage.fail) throw new Error('Simulated IDB failure');
    storage.record = { bytes: bytes.slice(), revision: revision + 1 }; return revision + 1;
  } };
  const engine = new DatabaseEngine({ SQL, schemaSql, storage }); await engine.initializeDatabase(); return { engine, storage };
}
async function classify(engine, isMathQuestion = true, recognizedQuestion = null) {
  const claim = await engine.claimNextJob(); assert.ok(claim);
  await engine.checkpointJob(claim, [], { isMathQuestion, recognizedQuestion }); await engine.completeJob(claim, []);
  return claim;
}

test('math flag is unknown before a structured background decision and store snapshots cannot overwrite it', async () => {
  const { engine } = await setup(), chat = conversation(); await engine.saveChanges({ conversations: [chat] });
  assert.equal(engine.getMessageQuestionClassification('chat-u').isMathQuestion, null);
  await assert.rejects(engine.setQuestionStar({ messageId: 'chat-u' }), (error) => error.code === 'question_not_confirmed');
  await classify(engine, true, '忠实题面');
  await engine.saveChanges({ conversations: [{ ...chat, messages: chat.messages.map((message) => ({ ...message, isMathQuestion: null, recognizedQuestion: '过期文字' })) }] });
  const message = engine.loadConversation('chat').messages[0];
  assert.equal(message.isMathQuestion, true); assert.equal(message.recognizedQuestion, '忠实题面');
  await engine.setQuestionStar({ messageId: 'chat-u' });
  assert.equal(engine.getMessageQuestionClassification('chat-u').starred, true); engine.close();
});

test('star snapshots retain original photos and extracted documents after deleting chat and learning records', async () => {
  const { engine } = await setup(), chat = conversation();
  chat.messages[0].image = image;
  chat.messages[0].attachments = [{ ...image, kind: 'image' }, { id: 'document', kind: 'document', name: '原题.txt', mime: 'text/plain', text: '附加条件 x→0', bytes: new TextEncoder().encode('附加条件 x→0') }];
  await engine.saveChanges({ conversations: [chat] }); await classify(engine, true, '识别出来的原题');
  const star = await engine.setQuestionStar({ messageId: 'chat-u' });
  assert.equal(star.images.length, 1); assert.ok(star.content.includes('附加条件'));
  await engine.deleteConversation('chat', true);
  assert.equal(engine.listStarredQuestions().length, 1);
  const preserved = engine.listStarredQuestions()[0]; assert.equal(preserved.id, star.id);
  assert.equal(preserved.recognizedQuestion, '识别出来的原题'); assert.deepEqual(preserved.images[0].bytes, image.bytes);
  const backup = await engine.prepareImport(await engine.exportDatabase()); assert.equal(backup.summary.starredQuestionCount, 1);
  await engine.commitImport(backup.token); assert.equal(engine.listStarredQuestions()[0].id, star.id);
  await engine.removeStarredQuestion(star.id); assert.deepEqual(engine.listStarredQuestions(), []);
  assert.equal(rows(engine.db, 'SELECT id FROM image').length, 0);
  engine.close();
});

test('identical questions from different conversations share one star and either source can unstar it', async () => {
  const { engine } = await setup();
  await engine.saveChanges({ conversations: [conversation('first'), conversation('second')] });
  await classify(engine); await classify(engine);
  const first = await engine.setQuestionStar({ messageId: 'first-u' }), second = await engine.setQuestionStar({ messageId: 'second-u' });
  assert.equal(first.id, second.id); assert.match(first.questionKey, /^chat-question-v1:[a-f0-9]{64}$/);
  assert.equal(engine.listStarredQuestions().length, 1); assert.equal(engine.getMessageQuestionClassification('second-u').starId, first.id);
  await engine.setQuestionStar({ messageId: 'second-u', starred: false }); assert.deepEqual(engine.listStarredQuestions(), []);
  engine.close();
});

test('classification uses the current user message, never promotes a conceptual follow-up to a problem', async () => {
  const { engine } = await setup(), chat = conversation();
  chat.messages.push({ id: 'followup-u', role: 'user', content: '为什么不能直接代入？', createdAt: timestamp }, { id: 'followup-a', role: 'assistant', content: '分母趋零时要先判断未定式。', createdAt: timestamp });
  await engine.saveChanges({ conversations: [chat] }); await classify(engine, true);
  const second = await engine.claimNextJob();
  assert.equal(second.payload.source.userMessageId, 'followup-u'); assert.equal(second.payload.source.userQuestion, '为什么不能直接代入？');
  assert.ok(second.payload.source.question.includes('lim'));
  await engine.checkpointJob(second, [], { isMathQuestion: false }); await engine.completeJob(second, []);
  assert.equal(engine.getMessageQuestionClassification('chat-u').isMathQuestion, true);
  assert.equal(engine.getMessageQuestionClassification('followup-u').isMathQuestion, false);
  await assert.rejects(engine.setQuestionStar({ messageId: 'followup-u' }), (error) => error.code === 'question_not_confirmed'); engine.close();
});

test('editing a question preserves old star snapshots, archives messages, and rejects late background writes', async () => {
  const { engine } = await setup(), chat = conversation(); await engine.saveChanges({ conversations: [chat] }); await classify(engine);
  const star = await engine.setQuestionStar({ messageId: 'chat-u' });
  chat.messages.push({ id: 'late-u', role: 'user', content: '另求 cos(x) 的导数', createdAt: timestamp }, { id: 'late-a', role: 'assistant', content: '−sin(x)', createdAt: timestamp });
  await engine.saveChanges({ conversations: [chat] }); const claim = await engine.claimNextJob();
  const revised = { ...chat, messages: [
    { id: 'new-u', role: 'user', content: '改为求 sin(3x)/x 的极限', createdAt: timestamp, revisionOf: 'chat-u', revisionAction: 'edit' },
    { id: 'new-a', role: 'assistant', content: '结果为3。', createdAt: timestamp },
    ...chat.messages.map((message) => ({ ...message, superseded: true })),
  ] };
  await engine.saveChanges({ conversations: [revised] });
  assert.throws(() => engine.completeJob(claim, [{ scenario_id: 'S.limit.0over0', method_id: 'M.lhopital', is_main: true }]), (error) => error.code === 'stale_job');
  assert.equal(engine.loadTrail().encounters.length, 0);
  const loaded = engine.loadConversation('chat'); assert.equal(loaded.messageCount, 2);
  assert.equal(loaded.messages[0].revisionOf, 'chat-u'); assert.equal(loaded.messages[0].revisionAction, 'edit');
  assert.ok(loaded.messages.find((message) => message.id === 'chat-u').superseded);
  assert.equal(engine.listStarredQuestions()[0].content, star.content); assert.equal(engine.listStarredQuestions()[0].id, star.id);
  const active = await engine.claimNextJob(); assert.equal(active.payload.source.userMessageId, 'new-u');
  const history = active.payload.source.context; assert.ok(history.every((message) => !message.content.includes('cos(x)')));
  engine.close();
});

test('v7 backups migrate safely and stars survive restart/restore while clear removes them', async () => {
  const { engine, storage } = await setup(); await engine.saveChanges({ conversations: [conversation()] });
  const legacy = new SQL.Database(await engine.exportDatabase());
  legacy.run('DROP TABLE starred_question_image; DROP TABLE starred_question; ALTER TABLE message DROP COLUMN revision_of; ALTER TABLE message DROP COLUMN revision_action; ALTER TABLE message DROP COLUMN superseded; ALTER TABLE message DROP COLUMN question_key; ALTER TABLE message DROP COLUMN recognized_question; ALTER TABLE message DROP COLUMN is_math_question; PRAGMA user_version=7');
  const migrated = await setup({ bytes: legacy.export(), revision: 1 }); legacy.close();
  assert.equal(migrated.engine.db.exec('PRAGMA user_version')[0].values[0][0], SCHEMA_VERSION);
  assert.equal(migrated.engine.loadConversation('chat').messages[0].isMathQuestion, null);
  await classify(migrated.engine); await migrated.engine.setQuestionStar({ messageId: 'chat-u' });
  const restarted = await setup(migrated.storage.record); assert.equal(restarted.engine.listStarredQuestions().length, 1);
  await restarted.engine.clearDatabase(); assert.deepEqual(restarted.engine.listStarredQuestions(), []);
  assert.deepEqual(restarted.engine.listPersonalNotes(), []); assert.ok(storage.record);
  engine.close(); migrated.engine.close(); restarted.engine.close();
});

test('old completed messages lazily reuse their existing job without inventing a math label', async () => {
  const { engine } = await setup(); await engine.saveChanges({ conversations: [conversation()] });
  const old = await engine.claimNextJob(); await engine.completeJob(old, []); // Pre-v8 behavior had no flag.
  assert.equal(engine.getMessageQuestionClassification('chat-u').isMathQuestion, null);
  await engine.requestMessageQuestionClassification('chat-u');
  const retry = await engine.claimNextJob(); assert.equal(retry.id, old.id); assert.equal(retry.payload.classificationOnly, true);
  await engine.checkpointJob(retry, [], { isMathQuestion: true }); await engine.completeJob(retry, []);
  assert.equal(rows(engine.db, 'SELECT * FROM queue_job').length, 1);
  const stopped = conversation('stopped'); stopped.messages[1].status = 'stopped'; await engine.saveChanges({ conversations: [stopped] });
  await engine.requestMessageQuestionClassification('stopped-u'); assert.equal(engine.getMessageQuestionClassification('stopped-u').isMathQuestion, null);
  assert.equal(await engine.claimNextJob(), null); engine.close();
});

test('failed durable star commit restores the database without creating a ghost favorite', async () => {
  const { engine, storage } = await setup(); await engine.saveChanges({ conversations: [conversation()] }); await classify(engine);
  storage.fail = true; await assert.rejects(engine.setQuestionStar({ messageId: 'chat-u' }));
  assert.deepEqual(engine.listStarredQuestions(), []); assert.equal(engine.getMessageQuestionClassification('chat-u').questionKey, null);
  engine.close();
});

test('metadata-only star lists do not read image bytes, and one detail loads a retained photo after chat deletion', async () => {
  const { engine } = await setup(), chat = conversation(); chat.messages[0].image = image;
  await engine.saveChanges({ conversations: [chat] }); await classify(engine);
  const star = await engine.setQuestionStar({ messageId: 'chat-u' }); await engine.deleteConversation('chat', true);
  const loadImage = engine.loadImage;
  engine.loadImage = () => { throw new Error('Metadata listing must not load image bytes'); };
  const listed = engine.listStarredQuestions({ includeImages: false });
  assert.equal(listed.length, 1); assert.equal(listed[0].hasImages, true);
  assert.deepEqual(listed[0].imageIds, [image.id]); assert.deepEqual(listed[0].images, []);
  assert.equal(listed[0].content, star.content);
  engine.loadImage = loadImage;
  const detail = engine.loadStarredQuestion(star.id);
  assert.deepEqual(detail.images[0].bytes, image.bytes); assert.ok(detail.images[0].dataUrl.startsWith('data:image/png;base64,'));
  assert.throws(() => engine.loadStarredQuestion('missing'), (error) => error.code === 'question_star_not_found');
  engine.close();
});
