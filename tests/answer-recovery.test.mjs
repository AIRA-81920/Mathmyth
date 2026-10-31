import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine } from '../src/core/db/engine.js';

test('restart restores continuation for interrupted output while respecting manual stops and empty failures', async () => {
  const SQL = await initSqlJs();
  const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
  const storage = { record: null, async load() { return this.record; }, async commit(bytes, revision) {
    this.record = { bytes: bytes.slice(), revision: revision + 1 }; return revision + 1;
  } };
  let engine = new DatabaseEngine({ SQL, schemaSql, storage });
  await engine.initializeDatabase();
  const createdAt = '2026-10-28T01:00:00.000Z';
  const answers = [
    { id: 'stream', status: 'streaming', content: '传输中的推导' },
    { id: 'error', status: 'error', content: '断网前的推导', error: '连接中断。' },
    { id: 'manual', status: 'stopped', content: '用户主动停止', error: '已停止接收回答。' },
    { id: 'empty', status: 'error', content: '', error: '连接中断。' },
    { id: 'complete', status: 'complete', content: '完整的答案' },
    { id: 'thinking', status: 'error', content: '', reasoningContent: '尚未给出正文的分析', error: '连接中断。' },
    { id: 'exit', status: 'stopped', content: '退出前的推导', error: '应用关闭，回答尚未完成。' },
  ];
  const messages = answers.flatMap(answer => [
    { id: 'u-' + answer.id, role: 'user', content: '示例问题', createdAt },
    { ...answer, role: 'assistant', createdAt },
  ]);
  try {
    await engine.saveChanges({ conversations: [{ id: 'recovery', title: '恢复验证', createdAt, updatedAt: createdAt, messages }] });
    engine.close(); engine = new DatabaseEngine({ SQL, schemaSql, storage });
    await engine.initializeDatabase();
    const restored = new Map(engine.loadConversation('recovery').messages.map(message => [message.id, message]));
    assert.equal(restored.get('stream').status, 'stopped');
    for (const id of ['stream', 'error', 'thinking', 'exit']) assert.equal(restored.get(id).canRepair, true, id);
    for (const id of ['manual', 'empty', 'complete']) assert.equal(Boolean(restored.get(id).canRepair), false, id);
  } finally { engine.close(); }
});
