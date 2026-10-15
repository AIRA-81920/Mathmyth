import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create } from 'zustand';
import { readActiveSkeleton } from '../scripts/compile-question-bank.mjs';

const sourceUrl = new URL('../src/store/practiceStore.js', import.meta.url);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const empty = { mastery: [], encounters: [] };
async function storeWith(database) {
  const app = create(() => ({ learnerId: 'old-learner', storageInitialized: true, dataOperation: null, modelConfig: {} }));
  const key = crypto.randomUUID(), registry = globalThis.__practiceClearTests ??= new Map();
  registry.set(key, { app, database, skeleton: await readActiveSkeleton() });
  let source = await readFile(sourceUrl, 'utf8');
  source = source.replace("import { useAppStore } from './appStore.js';", `const useAppStore = globalThis.__practiceClearTests.get('${key}').app;`)
    .replace("import * as database from '../core/db/database.js';", `const database = globalThis.__practiceClearTests.get('${key}').database;`)
    .replace("import { loadSkeleton } from '../core/skeleton/load.js';", `const skeleton = globalThis.__practiceClearTests.get('${key}').skeleton; const loadSkeleton = async () => skeleton;`)
    .replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
    .replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${new URL(path, sourceUrl).href}'`);
  const { usePracticeStore: practice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  registry.delete(key); return { app, practice };
}
test('clear removes cached history/progress and an old initialization cannot restore it or cancel the fresh load', async () => {
  const oldTrail = deferred(), freshTrail = deferred(); let trailCalls = 0, activeCalls = 0;
  const oldSession = { id: 'old-run', items: [{ id: 'old-item', question: { question: '旧作答' } }] };
  const database = { loadTrail: () => ++trailCalls === 1 ? oldTrail.promise : freshTrail.promise,
    loadActivePractice: async () => ++activeCalls === 1 ? oldSession : null };
  const { app, practice } = await storeWith(database);
  practice.setState({ history: [{ id: 'old-history' }], session: oldSession, screen: 'history' });
  const oldLoad = practice.getState().initialize();
  app.setState({ dataOperation: 'clearing' });
  assert.deepEqual(practice.getState().history, []); assert.equal(practice.getState().session, null);
  await practice.getState().initialize(); assert.equal(trailCalls, 1);
  app.setState({ learnerId: 'fresh-learner', dataOperation: null });
  const freshLoad = practice.getState().initialize(); assert.notEqual(freshLoad, oldLoad);
  oldTrail.resolve({ mastery: [], encounters: [{ id: 'old', scenarioId: 'S.limit.0over0', methodId: 'M.important_limit', question: '旧题', occurredAt: '2026-10-12' }] });
  await oldLoad;
  assert.equal(practice.getState().session, null); assert.deepEqual(practice.getState().history, []);
  assert.equal(practice.getState().initialize(), freshLoad);
  freshTrail.resolve(empty); await freshLoad;
  assert.deepEqual(practice.getState().choices, []);
  assert.ok(practice.getState().choices.every(c => c.count === 0));
  assert.equal(practice.getState().screen, 'entry'); assert.equal(practice.getState().session, null);
});
