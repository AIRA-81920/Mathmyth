import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexedDbStorage } from '../src/core/db/indexedDb.js';

// A controlled IDB boundary lets tests separate request.success from transaction
// complete/abort. The production engine tests use real sql.js WASM bytes.
function controlledIndexedDb() {
  const state = { record: null, transactions: [], closed: 0 };
  const fake = {
    open() {
      const request = {};
      request.result = {
        objectStoreNames: { contains: () => true },
        close() { state.closed += 1; },
        transaction() {
          const transaction = {
            staged: null,
            objectStore() { return {
              get() {
                const getRequest = {};
                queueMicrotask(() => { getRequest.result = state.record; getRequest.onsuccess?.(); });
                return getRequest;
              },
              put(value) { transaction.staged = structuredClone(value); return {}; },
            }; },
            abort() { queueMicrotask(() => transaction.onabort?.()); },
            complete() {
              if (transaction.staged) state.record = transaction.staged;
              transaction.oncomplete?.();
            },
          };
          state.transactions.push(transaction);
          return transaction;
        },
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  return { fake, state };
}
const ticks = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('IDB save settles only on transaction complete, and load returns the committed byte record', async () => {
  const { fake, state } = controlledIndexedDb();
  const storage = createIndexedDbStorage(fake);
  let complete = false;
  const saved = storage.commit(Uint8Array.of(10,20), 0).then((revision) => { complete = true; return revision; });
  await ticks();
  assert.equal(complete, false);
  assert.equal(state.record, null);
  state.transactions[0].complete();
  assert.equal(await saved, 1);
  const loaded = storage.load();
  await ticks();
  state.transactions[1].complete();
  assert.deepEqual(await loaded, { bytes: Uint8Array.of(10,20), revision: 1 });
});

test('IDB revision CAS and quota abort preserve the previously committed record', async () => {
  const { fake, state } = controlledIndexedDb();
  state.record = { bytes: Uint8Array.of(1,2), revision: 3 };
  const storage = createIndexedDbStorage(fake);
  await assert.rejects(storage.commit(Uint8Array.of(9,9), 2), (error) => error.code === 'revision_conflict');
  assert.deepEqual(state.record.bytes, Uint8Array.of(1,2));
  const failed = storage.commit(Uint8Array.of(9,9), 3);
  await ticks();
  const transaction = state.transactions[1];
  transaction.error = { name: 'QuotaExceededError' };
  transaction.abort();
  await assert.rejects(failed, (error) => error.code === 'storage_quota');
  assert.deepEqual(state.record, { bytes: Uint8Array.of(1,2), revision: 3 });
});
