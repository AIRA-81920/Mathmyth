import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { SCHEMA_VERSION } from '../src/core/db/constants.js';

const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
async function setup(record = null) {
  const storage = { record, fail: false, load: async () => storage.record, commit: async (bytes, revision) => {
    if (storage.fail) throw new Error('Simulated commit failure');
    storage.record = { bytes: new Uint8Array(bytes), revision: revision + 1 }; return revision + 1;
  } };
  const engine = new DatabaseEngine({ SQL, schemaSql, storage }); await engine.initializeDatabase(); return { engine, storage };
}

test('personal notes persist without a conversation, retain formulae, support optional links and edit/delete', async () => {
  const { engine, storage } = await setup();
  const note = await engine.savePersonalNote({ content: "别忘了补回系数：$3\\sin(3x)/(3x)$，can't 漏乘3。" });
  const linked = await engine.savePersonalNote({ content: '相消后检查二阶项', targetType: 'scenario', targetId: 'S.limit.0over0' });
  assert.equal(engine.listPersonalNotes().length, 2); assert.equal(note.targetType, null);
  const edited = await engine.savePersonalNote({ ...note, content: '两个都趋零，不代表比值是零', targetType: 'method', targetId: 'M.lhopital' });
  assert.equal(edited.createdAt, note.createdAt); assert.equal(edited.targetId, 'M.lhopital');
  const restored = await setup(storage.record);
  assert.equal(restored.engine.listPersonalNotes().length, 2);
  await restored.engine.deletePersonalNote(linked.id); assert.equal(restored.engine.listPersonalNotes().length, 1);
  const imported = await restored.engine.prepareImport(await engine.exportDatabase());
  assert.equal(imported.summary.personalNoteCount, 2); await restored.engine.commitImport(imported.token);
  assert.equal(restored.engine.listPersonalNotes().length, 2);
  assert.equal(restored.engine.loadTrail().mastery.length, 0);
  await restored.engine.clearDatabase(); assert.deepEqual(restored.engine.listPersonalNotes(), []);
  engine.close(); restored.engine.close();
});

test('deleting chat and its learning records leaves independently written notes intact', async () => {
  const { engine } = await setup();
  const now = new Date().toISOString();
  await engine.saveChanges({ conversations: [{ id: 'chat', title: '极限', createdAt: now, updatedAt: now, messages: [{ id: 'user', role: 'user', content: '极限题', createdAt: now }] }] });
  const note = await engine.savePersonalNote({ content: '先看能否直接代入', targetType: 'scenario', targetId: 'S.limit.0over0' });
  await engine.deleteConversation('chat', true);
  assert.equal(engine.listPersonalNotes()[0].id, note.id); engine.close();
});

test('v6 backup migrates to v7 with conversation preserved and an empty notes table', async () => {
  const { engine } = await setup();
  const now = new Date().toISOString();
  await engine.saveChanges({ conversations: [{ id: 'legacy-chat', title: '旧会话', createdAt: now, updatedAt: now, messages: [{ id: 'legacy-u', role: 'user', content: '原来的题目', createdAt: now }] }] });
  const db = new SQL.Database(await engine.exportDatabase()); db.run('DROP TABLE personal_note; PRAGMA user_version=6');
  const legacy = db.export(); db.close();
  const migrated = await setup({ bytes: legacy, revision: 1 });
  assert.equal(migrated.engine.db.exec('PRAGMA user_version')[0].values[0][0], SCHEMA_VERSION);
  assert.deepEqual(migrated.engine.listPersonalNotes(), []);
  assert.equal(migrated.engine.loadConversation('legacy-chat').messages[0].content, '原来的题目');
  await migrated.engine.savePersonalNote({ content: '从旧版升级后正常记笔记' });
  assert.equal(migrated.engine.listPersonalNotes().length, 1); engine.close(); migrated.engine.close();
});

test('blank/oversize/partial-link notes are rejected and failed commits restore saved notes', async () => {
  const { engine, storage } = await setup();
  for (const input of [{ content: ' ' }, { content: 'x'.repeat(5001) }, { content: '条件', targetType: 'method' }, { content: '条件', targetType: 'method', targetId: 'S.limit.0over0' }]) {
    assert.throws(() => engine.savePersonalNote(input), (error) => error.code === 'invalid_personal_note');
  }
  const note = await engine.savePersonalNote({ content: '原来的提醒' }); storage.fail = true;
  await assert.rejects(engine.savePersonalNote({ ...note, content: '未保存的提醒' }));
  assert.equal(engine.listPersonalNotes()[0].content, '原来的提醒'); engine.close();
});
