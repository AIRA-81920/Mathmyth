import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { APPLICATION_ID, REQUIRED_COLUMNS, SCHEMA_VERSION } from '../src/core/db/constants.js';
import { DatabaseError } from '../src/core/db/errors.js';

const SQL = await initSqlJs();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const timestamp = '2026-10-09T01:00:00.000Z';
const imageBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC'), (value) => value.charCodeAt(0));
const image = { id: 'image-one', name: '题目.png', mime: 'image/png', bytes: imageBytes };
const modelConfig = { providerId: 'custom', apiBase: 'https://model.example/v1', apiKey: 'private-key', model: 'math-model', supportsImage: true };

class MemoryStorage {
  record = null;
  failNext = false;
  async load() { return this.record ? { bytes: this.record.bytes.slice(), revision: this.record.revision } : null; }
  async commit(bytes, expectedRevision) {
    if (this.failNext) { this.failNext = false; throw new DatabaseError('存储空间不足。', 'storage_quota'); }
    if ((this.record?.revision ?? 0) !== expectedRevision) throw new DatabaseError('另一窗口已更新数据。', 'revision_conflict');
    this.record = { bytes: bytes.slice(), revision: expectedRevision + 1 };
    return expectedRevision + 1;
  }
}
const createEngine = (storage = new MemoryStorage()) => new DatabaseEngine({ SQL, schemaSql, storage });
function conversation(id = 'conversation-one', { picture = false, streaming = false } = {}) {
  return { id, title: '求极限', createdAt: timestamp, updatedAt: timestamp, messages: [
    { id: `${id}-user`, role: 'user', content: '求 $\\lim_{x\\to0}\\sin x/x$。', createdAt: timestamp, ...(picture ? { image } : {}) },
    { id: `${id}-answer`, role: 'assistant', content: '先看未定式，', createdAt: timestamp, status: streaming ? 'streaming' : 'complete' },
  ] };
}
async function populated({ picture = true, streaming = false } = {}) {
  const storage = new MemoryStorage();
  const engine = createEngine(storage);
  await engine.initializeDatabase();
  await engine.saveChanges({ modelConfig, onboarded: true, conversations: [conversation('conversation-one', { picture, streaming })] });
  return { storage, engine };
}
async function altered(bytes, mutate) {
  const db = new SQL.Database(bytes);
  try { mutate(db); return db.export(); }
  finally { db.close(); }
}

test('file backup physically removes current and rotated API keys without changing live settings or learning data', async () => {
  const { engine, storage } = await populated();
  const oldKey = 'fixture-only-rotated-secret-' + 'A'.repeat(7000), currentKey = 'fixture-only-current-secret-' + 'B'.repeat(200);
  try {
    await engine.saveChanges({ modelConfig: { ...modelConfig, apiKey: oldKey } });
    await engine.saveChanges({ modelConfig: { ...modelConfig, apiKey: currentKey } });
    const before = await engine.exportDatabase(), revision = storage.record.revision;
    const bytes = await engine.exportBackup();
    assert.equal(Buffer.from(bytes).includes(Buffer.from(currentKey)), false);
    assert.equal(Buffer.from(bytes).includes(Buffer.from(oldKey)), false);
    const copy = new SQL.Database(bytes);
    assert.equal(copy.exec("SELECT count(*) FROM setting WHERE key='api_key'")[0].values[0][0], 0);
    assert.equal(copy.exec('SELECT count(*) FROM message')[0].values[0][0], 2);
    assert.equal(copy.exec('SELECT count(*) FROM image')[0].values[0][0], 1);
    assert.equal(copy.exec('PRAGMA integrity_check')[0].values[0][0], 'ok'); copy.close();
    assert.equal((await engine.initializeDatabase()).modelConfig.apiKey, currentKey);
    assert.deepEqual(await engine.exportDatabase(), before);
    assert.equal(storage.record.revision, revision);
    const target = createEngine(); await target.initializeDatabase();
    const candidate = await target.prepareImport(bytes), restored = await target.commitImport(candidate.token);
    assert.equal(restored.modelConfig.apiKey, ''); assert.equal(restored.conversations.length, 1);
    assert.deepEqual(target.loadConversation('conversation-one').messages[0].image.bytes, imageBytes); target.close();
  } finally { engine.close(); }
});
test('multiple attachments and document bytes survive backup; pin and rename persist without loading history', async () => {
  const engine = createEngine(); await engine.initializeDatabase();
  const history = conversation(); history.messages[0].image = image;
  history.messages[0].attachments = [{ ...image,kind:'image' },{id:'doc-one',kind:'document',name:'题目.txt',mime:'text/plain',bytes:new TextEncoder().encode('原题'),text:'原题'}];
  await engine.saveChanges({conversations:[history]}); await engine.updateConversation(history.id,{pinned:true,title:'我的题'});
  const candidate = await engine.prepareImport(await engine.exportDatabase()); const bootstrap = await engine.commitImport(candidate.token);
  assert.equal(bootstrap.conversations[0].pinned,true); assert.equal(bootstrap.conversations[0].title,'我的题');
  const restored = engine.loadConversation(history.id).messages[0];
  assert.equal(restored.attachments.length,2); assert.deepEqual(restored.attachments[1].bytes,new TextEncoder().encode('原题'));
  const claim=await engine.claimNextJob();assert.ok(claim.payload.source.question.includes('原题'));engine.close();
});
test('version-three backups migrate to attachments schema without losing conversations or image bytes', async () => {
  const {engine}=await populated();
  const bytes=await altered(await engine.exportDatabase(),db=>{
    db.run('ALTER TABLE message DROP COLUMN reasoning_content; ALTER TABLE conversation DROP COLUMN method_id; ALTER TABLE conversation DROP COLUMN title_status; DROP TABLE message_attachment; DROP TABLE document; ALTER TABLE conversation DROP COLUMN pinned; ALTER TABLE encounter DROP COLUMN question_snapshot; ALTER TABLE practice_run DROP COLUMN generation_status; PRAGMA user_version=3');
  });
  const candidate=await engine.prepareImport(bytes);await engine.commitImport(candidate.token);
  assert.equal(engine.db.exec('PRAGMA user_version')[0].values[0][0],SCHEMA_VERSION);
  assert.deepEqual(engine.loadConversation('conversation-one').messages[0].image.bytes,imageBytes);engine.close();
});
test('chat deletion offers preserved detached learning or removal of its own learning evidence', async () => {
  const {engine} = await populated();
  const claim = await engine.claimNextJob(); await engine.completeJob(claim,[{scenario_id:'S.limit.0over0',method_id:'M.lhopital',is_main:true}]);
  await engine.deleteConversation('conversation-one',false);
  let data = engine.loadTrail(); assert.equal(data.encounters.length,1); assert.equal(data.encounters[0].conversationId,null); assert.ok(data.encounters[0].question);
  assert.equal(engine.db.exec('SELECT count(*) FROM image')[0].values[0][0],0);
  const other = conversation('other'); await engine.saveChanges({conversations:[other]});
  const next = await engine.claimNextJob(); await engine.completeJob(next,[{scenario_id:'S.limit.inf_over_inf',method_id:'M.lhopital',is_main:true}]);
  await engine.deleteConversation('other',true);
  data = engine.loadTrail(); assert.equal(data.encounters.length,1); assert.ok(data.mastery.some((row) => row.targetId==='M.lhopital'));
  assert.ok(!data.mastery.some((row) => row.targetId==='S.limit.inf_over_inf'));
  const candidate = await engine.prepareImport(await engine.exportDatabase()); await engine.commitImport(candidate.token); engine.close();
});

test('fresh real SQLite has all specified tables, learner identity and no empty-history entries', async () => {
  const storage = new MemoryStorage();
  const engine = createEngine(storage);
  const initial = await engine.initializeDatabase();
  assert.equal(initial.modelConfig, null);
  assert.equal(initial.onboarded, false);
  assert.ok(initial.learnerId);
  assert.deepEqual(initial.conversations, []);
  const db = new SQL.Database(await engine.exportDatabase());
  assert.equal(db.exec('PRAGMA application_id')[0].values[0][0], APPLICATION_ID);
  assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], SCHEMA_VERSION);
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = db.exec(`PRAGMA table_info(${table})`)[0].values.map((row) => row[1]);
    assert.ok(columns.every((column) => actual.includes(column)), table);
  }
  await engine.saveChanges({ conversations: [{ id: 'unused', messages: [] }] });
  assert.deepEqual((await engine.initializeDatabase()).conversations, []);
  db.close(); engine.close();
});

test('settings, stable message order, image bytes and public metadata round-trip without replacing other histories', async () => {
  const { engine, storage } = await populated();
  const second = conversation('conversation-two');
  await engine.saveChanges({ conversations: [second] });
  const updated = conversation('conversation-one', { picture: true });
  updated.messages[0].image = { id: image.id }; // Existing BLOB is not resent.
  updated.messages[0].imageCorrected = true;
  updated.messages.push({ id: 'recheck', role: 'user', content: '这题不对', recheckOf: 'conversation-one-answer', createdAt: timestamp });
  await engine.saveChanges({ conversations: [updated] });
  const restart = createEngine(storage);
  const bootstrap = await restart.initializeDatabase();
  assert.deepEqual(bootstrap.modelConfig, modelConfig);
  assert.equal(bootstrap.onboarded, true);
  assert.equal(bootstrap.conversations.length, 2);
  assert.ok(bootstrap.conversations.every((entry) => entry.loaded === false && entry.messages.length === 0));
  const loaded = restart.loadConversation('conversation-one');
  assert.deepEqual(loaded.messages.map((entry) => entry.id), ['conversation-one-user', 'conversation-one-answer', 'recheck']);
  assert.equal(loaded.messages[0].imageCorrected, true);
  assert.equal(loaded.messages[2].recheckOf, 'conversation-one-answer');
  assert.deepEqual(loaded.messages[0].image.bytes, imageBytes);
  assert.match(loaded.messages[0].image.dataUrl, /^data:image\/png;base64,/);
  assert.equal(loaded.firstImageId, image.id);
  const db = new SQL.Database(await restart.exportDatabase());
  assert.equal(db.exec('SELECT count(*) FROM image')[0].values[0][0], 1);
  db.close(); engine.close(); restart.close();
});

test('restart durably changes interrupted streaming messages to stopped and keeps partial content', async () => {
  const { engine, storage } = await populated({ streaming: true });
  const restart = createEngine(storage);
  await restart.initializeDatabase();
  const answer = restart.loadConversation('conversation-one').messages[1];
  assert.equal(answer.status, 'stopped');
  assert.equal(answer.content, '先看未定式，');
  const again = createEngine(storage);
  await again.initializeDatabase();
  assert.equal(again.loadConversation('conversation-one').messages[1].status, 'stopped');
  engine.close(); restart.close(); again.close();
});

test('prepare import is read-only, cancel expires its token, and successful commit atomically restores a whole file', async () => {
  const source = await populated();
  const backup = await source.engine.exportDatabase();
  const target = createEngine();
  const initial = await target.initializeDatabase();
  const before = await target.exportDatabase();
  const staged = await target.prepareImport(backup);
  assert.deepEqual(staged.summary, { conversationCount: 1, messageCount: 2, imageCount: 1, personalNoteCount: 0, starredQuestionCount: 0, hasModelSettings: true });
  assert.deepEqual(await target.exportDatabase(), before);
  target.cancelImport(staged.token);
  await assert.rejects(target.commitImport(staged.token), (error) => error.code === 'import_expired');
  const candidate = await target.prepareImport(backup);
  const restored = await target.commitImport(candidate.token);
  assert.notEqual(restored.learnerId, initial.learnerId);
  assert.equal(restored.conversations.length, 1);
  assert.deepEqual(target.loadImage(image.id).bytes, imageBytes);
  source.engine.close(); target.close();
});

test('invalid header, foreign app, newer version, missing column and orphan references do not change the current file', async () => {
  const { engine } = await populated();
  const before = await engine.exportDatabase();
  const invalid = [
    Uint8Array.of(1, 2, 3),
    await altered(before, (db) => db.run('PRAGMA application_id=0')),
    await altered(before, (db) => db.run('PRAGMA user_version=99')),
    await altered(before, (db) => db.run('ALTER TABLE message RENAME COLUMN content TO unexpected')),
    await altered(before, (db) => db.run("DELETE FROM image WHERE id='image-one'")),
  ];
  for (const bytes of invalid) {
    await assert.rejects(engine.prepareImport(bytes), (error) => Boolean(error.userMessage));
    assert.deepEqual(await engine.exportDatabase(), before);
    assert.equal(engine.loadConversation('conversation-one').messages.length, 2);
  }
  engine.close();
});

test('malformed row values, corrupted image MIME, unknown triggers and bad JSON are rejected', async () => {
  const { engine } = await populated();
  const before = await engine.exportDatabase();
  const mutations = [
    (db) => { db.run('PRAGMA ignore_check_constraints=ON'); db.run("UPDATE message SET role='system'"); },
    (db) => db.run("UPDATE image SET mime='image/jpeg'"),
    (db) => db.run("CREATE TRIGGER surprise AFTER INSERT ON setting BEGIN DELETE FROM conversation; END"),
    (db) => db.run("INSERT INTO mastery VALUES('m',(SELECT id FROM learner LIMIT 1),'scenario','S.demo','consolidating',1,'not-json','2026-10-09')"),
  ];
  for (const mutate of mutations) {
    await assert.rejects(engine.prepareImport(await altered(before, mutate)), (error) => Boolean(error.userMessage));
    assert.deepEqual(await engine.exportDatabase(), before);
  }
  engine.close();
});

test('failed save restores the last committed SQLite bytes and a later retry preserves the new state', async () => {
  const { engine, storage } = await populated();
  const before = await engine.exportDatabase();
  storage.failNext = true;
  await assert.rejects(engine.saveChanges({ modelConfig: { ...modelConfig, model: 'new-model' } }), (error) => error.code === 'storage_quota');
  assert.deepEqual(await engine.exportDatabase(), before);
  assert.deepEqual(storage.record.bytes, before);
  await engine.saveChanges({ modelConfig: { ...modelConfig, model: 'new-model' } });
  assert.equal((await engine.initializeDatabase()).modelConfig.model, 'new-model');
  engine.close();
});

test('failed imported-file persistence leaves both active and durable old data intact', async () => {
  const source = await populated();
  const targetStorage = new MemoryStorage();
  const target = createEngine(targetStorage);
  await target.initializeDatabase();
  const before = await target.exportDatabase();
  const candidate = await target.prepareImport(await source.engine.exportDatabase());
  targetStorage.failNext = true;
  await assert.rejects(target.commitImport(candidate.token), (error) => error.code === 'storage_quota');
  assert.deepEqual(await target.exportDatabase(), before);
  assert.deepEqual(targetStorage.record.bytes, before);
  assert.equal((await target.initializeDatabase()).conversations.length, 0);
  assert.equal((await target.commitImport(candidate.token)).conversations.length, 1);
  target.close(); source.engine.close();
});

test('clear is atomic, resets settings/history/images, and remains empty after restart', async () => {
  const { engine, storage } = await populated();
  const before = await engine.exportDatabase();
  storage.failNext = true;
  await assert.rejects(engine.clearDatabase(), (error) => error.code === 'storage_quota');
  assert.deepEqual(await engine.exportDatabase(), before);
  const cleared = await engine.clearDatabase();
  assert.equal(cleared.modelConfig, null);
  assert.equal(cleared.onboarded, false);
  assert.deepEqual(cleared.conversations, []);
  const restart = createEngine(storage);
  assert.equal((await restart.initializeDatabase()).onboarded, false);
  await assert.rejects(Promise.resolve().then(() => restart.loadImage(image.id)), (error) => error.code === 'image_not_found');
  engine.close(); restart.close();
});

test('unreadable existing bytes remain exportable and may be recovered by import or clear without opening the old DB', async () => {
  const source = await populated();
  for (const action of ['import', 'clear']) {
    const storage = new MemoryStorage();
    const corrupt = Uint8Array.of(11, 22, 33, 44);
    storage.record = { bytes: corrupt.slice(), revision: 4 };
    const engine = createEngine(storage);
    await assert.rejects(engine.initializeDatabase());
    assert.deepEqual(await engine.exportDatabase(), corrupt);
    assert.deepEqual(storage.record.bytes, corrupt);
    if (action === 'import') {
      const candidate = await engine.prepareImport(await source.engine.exportDatabase());
      assert.equal((await engine.commitImport(candidate.token)).conversations.length, 1);
    } else assert.equal((await engine.clearDatabase()).onboarded, false);
    assert.ok(storage.record.bytes.length > corrupt.length);
    engine.close();
  }
  source.engine.close();
});

test('revision compare-and-swap prevents a second tab from overwriting newer committed history', async () => {
  const { engine, storage } = await populated();
  const otherTab = createEngine(storage);
  await otherTab.initializeDatabase();
  await engine.saveChanges({ conversations: [conversation('newer-history')] });
  const latest = storage.record.bytes.slice();
  await assert.rejects(otherTab.saveChanges({ modelConfig: { ...modelConfig, model: 'stale-overwrite' } }), (error) => error.code === 'revision_conflict');
  assert.deepEqual(storage.record.bytes, latest);
  const restart = createEngine(storage);
  assert.equal((await restart.initializeDatabase()).conversations.length, 2);
  otherTab.close(); engine.close(); restart.close();
});

test('version-zero native backup migrates on a candidate and keeps same-time message order', async () => {
  const old = new SQL.Database();
  old.run(`CREATE TABLE learner(id TEXT PRIMARY KEY,display_name TEXT,created_at TEXT NOT NULL);
    CREATE TABLE setting(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE conversation(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL,title TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE message(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,image_ref TEXT,created_at TEXT NOT NULL);
    CREATE TABLE image(id TEXT PRIMARY KEY,blob BLOB NOT NULL,created_at TEXT NOT NULL);
    PRAGMA application_id=${APPLICATION_ID};`);
  old.run('INSERT INTO learner VALUES(?,?,?)', ['legacy-learner', null, timestamp]);
  old.run('INSERT INTO conversation VALUES(?,?,?,?,?)', ['legacy-conv', 'legacy-learner', '旧题目', timestamp, timestamp]);
  old.run('INSERT INTO image VALUES(?,?,?)', [image.id, imageBytes, timestamp]);
  old.run('INSERT INTO message VALUES(?,?,?,?,?,?)', ['legacy-user', 'legacy-conv', 'user', '题目', image.id, timestamp]);
  old.run('INSERT INTO message VALUES(?,?,?,?,?,?)', ['legacy-answer', 'legacy-conv', 'assistant', '答案', null, timestamp]);
  const bytes = old.export();
  old.close();
  const target = createEngine();
  await target.initializeDatabase();
  const candidate = await target.prepareImport(bytes);
  await target.commitImport(candidate.token);
  const loaded = target.loadConversation('legacy-conv');
  assert.deepEqual(loaded.messages.map((message) => message.id), ['legacy-user','legacy-answer']);
  assert.equal(loaded.messages[0].image.mime, 'image/png');
  const db = new SQL.Database(await target.exportDatabase());
  assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], SCHEMA_VERSION);
  db.close(); target.close();
});

test('foreign keys remain enabled after exports and prevent invalid recheck references during save', async () => {
  const { engine } = await populated();
  const before = await engine.exportDatabase();
  assert.equal(engine.db.exec('PRAGMA foreign_keys')[0].values[0][0], 1);
  const bad = conversation();
  bad.messages.push({ id: 'bad-recheck', role: 'user', content: '核查', recheckOf: 'missing-answer', createdAt: timestamp });
  await assert.rejects(engine.saveChanges({ conversations: [bad] }));
  assert.deepEqual(await engine.exportDatabase(), before);
  engine.close();
});
