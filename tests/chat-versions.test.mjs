import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';
import { branchBefore, visibleMessages, revisionVersions, captureRevisionPaths, selectRevision } from '../src/core/chat/revisions.js';
import { lightPalette, normalizeLightTemperature } from '../src/core/ui/lightTemperature.js';
import { normalizePreferences } from '../src/core/config/preferences.js';

const date = '2026-10-14T15:00:00Z';
const turn = (id, text, extra = {}) => [{ id, role: 'user', content: text, createdAt: date, ...extra },
  { id: `${id}-a`, role: 'assistant', content: `${text}的回答`, createdAt: date, status: 'complete' }];
const ids = messages => visibleMessages(messages).map(m => m.id);

test('legacy nested edits recover the paired answer and the appropriate continuation without mixing branches', () => {
  let messages = [...turn('first', '原题'), ...turn('follow', '旧追问')];
  messages = [...branchBefore(messages, 'follow'), ...turn('follow2', '修改追问', { revisionOf: 'follow' })];
  messages = [...branchBefore(messages, 'first'), ...turn('first2', '新题', { revisionOf: 'first' })];
  const old = selectRevision(messages, {}, 'first');
  assert.deepEqual(ids(old.messages), ['first','first-a','follow2','follow2-a']);
  const olderFollow = selectRevision(old.messages, old.revisionPaths, 'follow');
  assert.deepEqual(ids(olderFollow.messages), ['first','first-a','follow','follow-a']);
  const newest = selectRevision(olderFollow.messages, olderFollow.revisionPaths, 'first2');
  assert.deepEqual(ids(newest.messages), ['first2','first2-a']);
  assert.deepEqual(revisionVersions(newest.messages, 'first2').map(m => m.id), ['first','first2']);
});

test('continuing an older version and editing it again preserves both versions and stable numbering', () => {
  const original = turn('q', '原题');
  let paths = captureRevisionPaths(original, {}, 'q');
  let messages = [...branchBefore(original, 'q'), ...turn('q2', '第二版', { revisionOf: 'q' })];
  let selected = selectRevision(messages, paths, 'q');
  messages = [...selected.messages, ...turn('old-follow', '旧版本上的新追问')];
  paths = captureRevisionPaths(messages, selected.revisionPaths, 'q');
  messages = [...branchBefore(messages, 'q'), ...turn('q3', '第三版', { revisionOf: 'q' })];
  selected = selectRevision(messages, paths, 'q2');
  assert.deepEqual(ids(selected.messages), ['q2','q2-a']);
  const oldest = selectRevision(selected.messages, selected.revisionPaths, 'q');
  assert.deepEqual(ids(oldest.messages), ['q','q-a','old-follow','old-follow-a']);
  assert.deepEqual(revisionVersions(oldest.messages, 'q').map(m => m.id), ['q','q2','q3']);
  assert.equal(selectRevision(messages, paths, 'missing'), null);
});

test('selected versions, continuations and light temperature survive real SQLite restart and sanitized backup', async () => {
  const SQL = await initSqlJs(), schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url),'utf8');
  let record;
  const storage = { load: async () => record, commit: async (bytes, revision) => { record = { bytes: bytes.slice(), revision: revision + 1 }; return revision + 1; } };
  const engine = new DatabaseEngine({ SQL, schemaSql, storage }); await engine.initializeDatabase();
  const original = [...turn('q','原题'), ...turn('f','原追问')];
  const messages = [...branchBefore(original,'q'), ...turn('q2','新题',{ revisionOf:'q', revisionAction:'edit' })];
  const selected = selectRevision(messages, captureRevisionPaths(original,{},'q'),'q');
  const chat = { id:'branches',title:'版本',createdAt:date,updatedAt:date,...selected,revisionViewOnly:true };
  await engine.saveChanges({ preferences: { theme:'light', lightTemperature:82 }, conversations:[chat] });
  assert.equal(await engine.claimNextJob(),null, 'browsing old output must not create classification calls');
  assert.deepEqual(ids(engine.loadConversation('branches').messages),['q','q-a','f','f-a']);
  const imported = await engine.prepareImport(await engine.exportBackup());
  const restored = await engine.commitImport(imported.token);
  assert.equal(restored.preferences.lightTemperature,82);
  const loaded = engine.loadConversation('branches');
  assert.deepEqual(ids(selectRevision(loaded.messages,loaded.revisionPaths,'q2').messages),['q2','q2-a']);
  engine.close();
  const restarted = new DatabaseEngine({ SQL,schemaSql,storage }); await restarted.initializeDatabase();
  assert.deepEqual(ids(restarted.loadConversation('branches').messages),['q','q-a','f','f-a']);
  await restarted.deleteConversation('branches');
  assert.equal(restarted.db.exec("SELECT value FROM setting WHERE key='chat_branches:branches'").length,0);
  restarted.close();
});

test('every color-temperature value stays light; invalid and extreme saved values are bounded', () => {
  assert.equal(normalizeLightTemperature(-10),0); assert.equal(normalizeLightTemperature(999),100);
  assert.equal(normalizeLightTemperature(NaN),45); assert.equal(normalizePreferences({ lightTemperature:500 }).lightTemperature,100);
  for (let temperature=0;temperature<=100;temperature++) {
    const colors = lightPalette(temperature);
    for (const key of ['surface','muted','elevated']) {
      const channels = colors[key].match(/\d+/g).map(Number);
      assert.ok(channels.every(channel=>channel>=200));
      assert.ok(channels[0]>=channels[2]);
    }
  }
  assert.notEqual(lightPalette(0).surface,lightPalette(100).surface);
});
