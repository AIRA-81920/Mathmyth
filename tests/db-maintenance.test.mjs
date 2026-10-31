import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { DatabaseEngine, pruneImages } from '../src/core/db/engine.js';
import { pruneJobs } from '../src/core/queue/dbJobs.js';
import { DatabaseError } from '../src/core/db/errors.js';

const SQL = await initSqlJs();
const schemaSql = await readFile(new URL('../src/core/db/schema.sql', import.meta.url), 'utf8');
const imageBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNUUFBgYGBgYgADAASqAGThstxZAAAAAElFTkSuQmCC'), (value) => value.charCodeAt(0));
const modelConfig = { providerId: 'custom', apiBase: 'https://model.example/v1', apiKey: 'private-key', model: 'math-model', supportsImage: true };
const DAY = 86400000;
const now = new Date('2026-10-19T00:00:00.000Z');
const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();
const key64 = (seed) => seed.padEnd(64, '0').slice(0, 64);

class MemoryStorage {
  record = null;
  async load() { return this.record ? { bytes: this.record.bytes.slice(), revision: this.record.revision } : null; }
  async commit(bytes, expectedRevision) {
    if ((this.record?.revision ?? 0) !== expectedRevision) throw new DatabaseError('另一窗口已更新数据。', 'revision_conflict');
    this.record = { bytes: bytes.slice(), revision: expectedRevision + 1 };
    return expectedRevision + 1;
  }
}
// 统计"实际执行的 SQL 写入语句"。用它来断言增量保存不随消息总量增长，
// 比读 total_changes() 更直接，也不依赖 sql.js 的实现细节。
function instrumented(counter) {
  class CountingDatabase extends SQL.Database {
    run(sql, params) { counter.writes.push(String(sql).trim()); return super.run(sql, params); }
  }
  return { Database: CountingDatabase };
}
async function freshEngine({ counter = { writes: [] } } = {}) {
  const engine = new DatabaseEngine({ SQL: instrumented(counter), schemaSql, storage: new MemoryStorage() });
  await engine.initializeDatabase();
  counter.writes.length = 0;
  return engine;
}
const value = (engine, sql, params) => engine.db.exec(sql, params)[0].values[0][0];
const messageWrites = (counter) => counter.writes.filter((sql) => sql.startsWith('INSERT INTO message(') || sql.startsWith('UPDATE message SET seq=')).length;

// Age and nonempty text never prove that a referenced image can be discarded.
test('image TTL deletes only old orphaned images and retains all message, attachment and star references', async () => {
  const engine = await freshEngine();
  const conversations = [];
  for (const age of [15, 3]) {
    for (const transcribed of [true, false]) {
      for (const starred of [false, true]) {
        const id = `c-${age}-${transcribed}-${starred}`;
        const createdAt = ago(age);
        conversations.push({ id, title: id, createdAt, updatedAt: createdAt, messages: [
          { id: `${id}-u`, role: 'user', content: transcribed ? '题面已转写' : age === 15 && !starred ? '这题怎么做' : '', image: { id: `image-${id}`, name: '题目.png', mime: 'image/png', bytes: imageBytes }, createdAt },
          { id: `${id}-a`, role: 'assistant', content: '解答', status: 'complete', createdAt },
        ] });
      }
    }
  }
  await engine.saveChanges({ modelConfig, onboarded: true, conversations });
  assert.equal(value(engine, 'SELECT count(*) FROM image'), 8, '八个组合全部先入库');

  // 收藏引用：D5 说明 starred_question_image 存的是 image_ref 引用（不是副本），
  // 因此"被收藏"只需在 TTL 条件里排除即可豁免，不需要复制字节。
  const learnerId = value(engine, 'SELECT id FROM learner LIMIT 1');
  for (const age of [15, 3]) {
    for (const transcribed of [true, false]) {
      const id = `c-${age}-${transcribed}-true`;
      engine.db.run('INSERT INTO starred_question(id,learner_id,question_key,source_message_id,content,recognized_question,created_at) VALUES(?,?,?,?,?,?,?)',
        [`star-${id}`, learnerId, key64(id), `${id}-u`, '题干', null, ago(age)]);
      engine.db.run('INSERT INTO starred_question_image(starred_question_id,seq,image_ref) VALUES(?,?,?)', [`star-${id}`, 0, `image-${id}`]);
    }
  }

  // Exercise independent attachment-only and star-only ownership as well.
  engine.db.run("UPDATE message SET image_ref=NULL WHERE id IN ('c-15-true-false-u','c-15-true-true-u')");
  engine.db.run('INSERT INTO message_attachment(message_id,seq,image_ref) VALUES(?,?,?)',
    ['c-15-true-false-u', 0, 'image-c-15-true-false']);
  for (const age of [15, 3]) engine.db.run('INSERT INTO image(id,blob,created_at,name,mime) VALUES(?,?,?,?,?)',
    [`orphan-${age}`, imageBytes, ago(age), '孤立图片.png', 'image/png']);
  assert.equal(pruneImages(engine.db, now), 1, '只有超过十四天且没有任何引用的图片被删');
  const remaining = engine.db.exec('SELECT id FROM image ORDER BY id')[0].values.map((row) => row[0]);
  assert.deepEqual(remaining, [
    'image-c-15-false-false', 'image-c-15-false-true', 'image-c-15-true-false', 'image-c-15-true-true',
    'image-c-3-false-false', 'image-c-3-false-true', 'image-c-3-true-false', 'image-c-3-true-true', 'orphan-3',
  ]);

  // Message text, including generic prompts, cannot replace a question source.
  assert.equal(value(engine, "SELECT image_ref FROM message WHERE id='c-15-true-false-u'"), null);
  const attachmentOnly = engine.loadConversation('c-15-true-false');
  assert.equal(attachmentOnly.messages[0].attachments[0].id, 'image-c-15-true-false');
  assert.equal(attachmentOnly.messages[0].content, '题面已转写');
  assert.equal(attachmentOnly.messages[1].content, '解答');
  assert.equal(value(engine, "SELECT count(*) FROM image WHERE id='image-c-15-true-true'"), 1);
  assert.equal(engine.loadConversation('c-15-false-false').messages[0].image.id, 'image-c-15-false-false');
  assert.equal(engine.loadConversation('c-15-false-false').messages[0].content, '这题怎么做');
  assert.equal(engine.loadConversation('c-3-true-false').messages[0].image.id, 'image-c-3-true-false');
  engine.close();
});

// Complete backups retain question sources, even when transcription failed.
test('backup export preserves unstarred, untranscribed and attachment images together with starred images and documents', async () => {
  const engine = await freshEngine();
  const createdAt = ago(1);
  const doc = { id: 'doc-one', kind: 'document', name: '题目.txt', mime: 'text/plain', bytes: new TextEncoder().encode('原题文字'), text: '原题文字' };
  const conversations = [{ id: 'c1', title: '备份', createdAt, updatedAt: createdAt, messages: [
    { id: 'c1-u', role: 'user', content: '耗材图题面', createdAt, image: { id: 'image-loose', name: '题目-裁切.png', mime: 'image/png', bytes: imageBytes } },
    { id: 'c1-u2', role: 'user', content: '收藏图题面', createdAt, image: { id: 'image-starred', name: '题目-裁切.png', mime: 'image/png', bytes: imageBytes } },
    { id: 'c1-u3', role: 'user', content: '带文档的题面', createdAt, attachments: [doc] },
    { id: 'c1-a', role: 'assistant', content: '解答', status: 'complete', createdAt },
    { id: 'c1-u4', role: 'user', content: '', createdAt: ago(15), image: { id: 'image-untranscribed', name: '未转写.png', mime: 'image/png', bytes: imageBytes } },
    { id: 'c1-a4', role: 'assistant', content: '', status: 'error', error: '连接失败。', createdAt },
    { id: 'c1-u5', role: 'user', content: '这题怎么做', createdAt, attachments: [{ id: 'image-attachment', kind: 'image', name: '附图.png', mime: 'image/png', bytes: imageBytes }] },
  ] }];
  await engine.saveChanges({ modelConfig, onboarded: true, conversations });

  // 只把第二张图挂进收藏引用（D5：starred_question_image 存的是 image_ref 引用，不是副本）。
  const learnerId = value(engine, 'SELECT id FROM learner LIMIT 1');
  engine.db.run('INSERT INTO starred_question(id,learner_id,question_key,source_message_id,content,recognized_question,created_at) VALUES(?,?,?,?,?,?,?)',
    ['star-1', learnerId, key64('star-1'), 'c1-u2', '收藏题面', null, createdAt]);
  engine.db.run('INSERT INTO starred_question_image(starred_question_id,seq,image_ref) VALUES(?,?,?)', ['star-1', 0, 'image-starred']);

  const bytes = await engine.exportBackup();

  // ① All original references remain valid, while credentials stay excluded.
  const copy = new SQL.Database(bytes);
  const kept = copy.exec('SELECT id FROM image')[0]?.values.map((row) => row[0]) ?? [];
  assert.deepEqual(kept.sort(), ['image-attachment', 'image-loose', 'image-starred', 'image-untranscribed']);
  assert.equal(value({ db: copy }, "SELECT image_ref FROM message WHERE id='c1-u'"), 'image-loose');
  assert.equal(value({ db: copy }, "SELECT image_ref FROM message WHERE id='c1-u4'"), 'image-untranscribed');
  assert.equal(value({ db: copy }, 'SELECT count(*) FROM message_attachment WHERE image_ref IS NOT NULL'), 1);
  assert.equal(value({ db: copy }, "SELECT count(*) FROM setting WHERE key='api_key'"), 0);
  assert.equal(value({ db: copy }, 'SELECT count(*) FROM document'), 1, '用户文件原样保留');
  assert.equal(value({ db: copy }, 'SELECT length(blob) FROM document'), doc.bytes.length);
  assert.equal(copy.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
  copy.close();

  // ② 原库分毫未动：导出只是操作副本。
  assert.equal(value(engine, 'SELECT count(*) FROM image'), 4);
  assert.equal(engine.loadConversation('c1').messages[0].image.id, 'image-loose');

  // ③ Import restores blank image questions and failed answers as well.
  const target = await freshEngine();
  const candidate = await target.prepareImport(bytes);
  await target.commitImport(candidate.token);
  const restored = target.loadConversation('c1');
  assert.equal(restored.messages[0].image.id, 'image-loose');
  assert.equal(restored.messages[0].content, '耗材图题面');
  assert.equal(restored.messages[1].image.id, 'image-starred');
  assert.deepEqual(restored.messages[2].attachments.map((item) => item.id), ['doc-one']);
  assert.deepEqual(restored.messages[2].attachments[0].bytes, doc.bytes);
  assert.equal(restored.messages.find(message => message.id === 'c1-u4').content, '');
  assert.equal(restored.messages.find(message => message.id === 'c1-u4').image.id, 'image-untranscribed');
  assert.equal(restored.messages.find(message => message.id === 'c1-a4').status, 'error');
  assert.equal(restored.messages.find(message => message.id === 'c1-u5').attachments[0].id, 'image-attachment');
  engine.close(); target.close();
});

// D14 补充：档案里保留下来的收藏图同样降采样重编码为 JPEG，但只操作导出副本 ——
// 本机收藏的原图必须分毫不变。真实重编码依赖 createImageBitmap/OffscreenCanvas
//（Node 单测不具备），这里用注入的假实现覆盖"替换 / 变大不替换 / 不支持保持原图"三种情形。
test('backup export re-encodes kept images without touching the live library', async () => {
  const smaller = Uint8Array.from([255, 216, 255, 219, 1, 2, 3]);
  const build = async (reencodeImage) => {
    const engine = new DatabaseEngine({ SQL, schemaSql, storage: new MemoryStorage(), reencodeImage });
    await engine.initializeDatabase();
    const createdAt = ago(1);
    await engine.saveChanges({ modelConfig, onboarded: true, conversations: [{ id: 'c1', title: '收藏', createdAt, updatedAt: createdAt, messages: [
      { id: 'c1-u', role: 'user', content: '题面', createdAt, image: { id: 'image-starred', name: '题目-裁切.png', mime: 'image/png', bytes: imageBytes } },
      { id: 'c1-a', role: 'assistant', content: '解答', status: 'complete', createdAt },
    ] }] });
    const learnerId = value(engine, 'SELECT id FROM learner LIMIT 1');
    engine.db.run('INSERT INTO starred_question(id,learner_id,question_key,source_message_id,content,recognized_question,created_at) VALUES(?,?,?,?,?,?,?)',
      ['star-1', learnerId, key64('star-1'), 'c1-u', '收藏题面', null, createdAt]);
    engine.db.run('INSERT INTO starred_question_image(starred_question_id,seq,image_ref) VALUES(?,?,?)', ['star-1', 0, 'image-starred']);
    return engine;
  };

  // ① 变小才替换：档案里换成真实 JPEG 字节与对应 mime，本机仍是原 PNG。
  const engine = await build(async () => ({ bytes: smaller, mime: 'image/jpeg' }));
  const copy = new SQL.Database(await engine.exportBackup());
  const kept = copy.exec('SELECT length(blob), mime FROM image')[0].values[0];
  assert.equal(kept[0], smaller.length, '档案里的收藏图已重编码');
  assert.equal(kept[1], 'image/jpeg', 'mime 跟随真实字节改变');
  copy.close();
  assert.equal(value(engine, 'SELECT length(blob) FROM image'), imageBytes.length, '本机收藏的原图不动');
  assert.equal(value(engine, 'SELECT mime FROM image'), 'image/png');
  engine.close();

  // ② 重编码结果反而更大时不替换。
  const bigger = await build(async () => ({ bytes: new Uint8Array(imageBytes.length + 10), mime: 'image/jpeg' }));
  const keptBigger = new SQL.Database(await bigger.exportBackup());
  assert.equal(value({ db: keptBigger }, 'SELECT length(blob) FROM image'), imageBytes.length);
  keptBigger.close(); bigger.close();

  // ③ 环境不支持（重编码返回 null）时导出照常完成，图片原样保留。
  const unsupported = await build(async () => null);
  const keptAsIs = new SQL.Database(await unsupported.exportBackup());
  assert.equal(value({ db: keptAsIs }, 'SELECT length(blob) FROM image'), imageBytes.length);
  assert.equal(value({ db: keptAsIs }, 'SELECT mime FROM image'), 'image/png');
  keptAsIs.close(); unsupported.close();
});

// D8：队列历史清理只动"已完成/已失败且超过 7 天"的任务。
test('queue cleanup deletes only old done/failed jobs and never touches pending or running work', async () => {
  const engine = await freshEngine();
  const createdAt = ago(1);
  const conversation = { id: 'c1', title: '会话', createdAt, updatedAt: createdAt, messages: [
    { id: 'c1-u', role: 'user', content: '题目', createdAt },
    { id: 'c1-a', role: 'assistant', content: '解答', status: 'complete', createdAt },
  ] };
  await engine.saveChanges({ modelConfig, onboarded: true, conversations: [conversation] });
  const insert = (id, status, age) => engine.db.run(
    'INSERT INTO queue_job(id,kind,conversation_id,status,attempts,payload,created_at,source_message_id) VALUES(?,?,?,?,?,?,?,?)',
    [id, 'locate', 'c1', status, 0, '{"source":{"userMessageId":"c1-u"}}', ago(age), 'c1-a']);
  insert('job-old-done', 'done', 10);
  insert('job-old-failed', 'failed', 10);
  insert('job-fresh-done', 'done', 2);
  insert('job-old-pending', 'pending', 10);
  insert('job-old-running', 'running', 10);

  assert.equal(pruneJobs(engine.db, now), 2);
  // 保存完成后台任务真实入队的那条 pending 任务同样必须留着。
  assert.deepEqual(engine.db.exec('SELECT id FROM queue_job ORDER BY id')[0].values.map((row) => row[0]),
    ['job-fresh-done', 'job-old-pending', 'job-old-running', 'locate:c1-a']);
  engine.close();
});

// D9：单条消息的改动不能再触发整个会话的重写，且写入量不随消息总量增长。
test('editing one message writes a constant number of rows no matter how long the conversation is', async () => {
  const shapes = [];
  for (const count of [60, 120]) {
    const counter = { writes: [] };
    const engine = await freshEngine({ counter });
    const createdAt = '2026-10-09T01:00:00.000Z';
    const messages = [];
    for (let index = 0; index < count; index += 1) {
      messages.push({ id: `m-${index}`, role: index % 2 ? 'assistant' : 'user',
        content: `第 ${index} 条`, ...(index % 2 ? { status: 'complete' } : {}), createdAt });
    }
    const conversation = { id: 'long', title: '长会话', createdAt, updatedAt: createdAt, messages };
    await engine.saveChanges({ modelConfig, onboarded: true, conversations: [conversation] });

    // 增量路径：只带这一条脏消息，用 seq 标明它在会话里的位置。
    counter.writes.length = 0;
    await engine.saveChanges({ conversations: [{ id: 'long', title: '长会话', createdAt,
      updatedAt: '2026-10-09T02:00:00.000Z', incremental: true,
      messages: [{ ...messages[1], content: '改过的正文', seq: 1 }] }] });
    const incremental = messageWrites(counter);

    // 兼容路径（调用方给出完整消息数组）仍是全量重写——这就是被替换掉的旧成本。
    counter.writes.length = 0;
    await engine.saveChanges({ conversations: [{ ...conversation, updatedAt: '2026-10-09T03:00:00.000Z',
      messages: messages.map((message, index) => index === 1 ? { ...message, content: '又改一次' } : message) }] });
    const legacy = messageWrites(counter);

    assert.equal(incremental, 1, `增量保存只应写 1 条消息（会话 ${count} 条），实际 ${incremental}`);
    assert.ok(legacy > count, `旧的全量路径应当重写整会话（会话 ${count} 条），实际 ${legacy}`);
    assert.equal(value(engine, "SELECT content FROM message WHERE id='m-1'"), '又改一次');
    assert.equal(value(engine, "SELECT seq FROM message WHERE id='m-1'"), 1);
    assert.equal(value(engine, "SELECT content FROM message WHERE id='m-5'"), '第 5 条', '其它消息没有被重写或错位');
    assert.equal(value(engine, 'SELECT count(*) FROM message'), count, '不会重复插入');
    shapes.push(incremental);
    engine.close();
  }
  assert.equal(shapes[0], shapes[1], '写入量与会话长度无关');
});
