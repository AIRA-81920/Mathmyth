import { DATABASE_FILE_KEY, DATABASE_OBJECT_STORE, DATABASE_STORAGE_NAME, DATABASE_STORAGE_VERSION } from '../config/paths.js';
import { DatabaseError, safeDatabaseError } from './errors.js';

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) {
      reject(new DatabaseError('当前环境无法使用本地存储，请检查浏览器或 App 的存储权限。', 'storage_unavailable'));
      return;
    }
    const request = indexedDB.open(DATABASE_STORAGE_NAME, DATABASE_STORAGE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DATABASE_OBJECT_STORE)) db.createObjectStore(DATABASE_OBJECT_STORE);
    };
    request.onblocked = () => {
      blocked = true;
      reject(new DatabaseError('本地数据正在被其他窗口使用，请关闭其他窗口后重试。', 'storage_blocked'));
    };
    request.onerror = () => reject(safeDatabaseError(request.error, '本地存储无法打开，请检查存储权限后重试。'));
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

// One record contains the entire SQLite file and a revision. The compare-and-
// swap runs inside the same IDB transaction as put, so another tab cannot
// silently replace changes based on a stale in-memory SQLite snapshot.
export function createIndexedDbStorage(indexedDB = globalThis.indexedDB) {
  return {
    async load() {
      const db = await openDatabase(indexedDB);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE_OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(DATABASE_OBJECT_STORE).get(DATABASE_FILE_KEY);
        let value;
        request.onsuccess = () => { value = request.result; };
        transaction.oncomplete = () => {
          db.close();
          resolve(value ? { bytes: new Uint8Array(value.bytes), revision: value.revision } : null);
        };
        transaction.onabort = () => { db.close(); reject(safeDatabaseError(transaction.error, '本地数据读取失败，请重试。')); };
        transaction.onerror = () => {};
      });
    },
    async commit(bytes, expectedRevision) {
      const db = await openDatabase(indexedDB);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE_OBJECT_STORE, 'readwrite');
        const store = transaction.objectStore(DATABASE_OBJECT_STORE);
        let failure;
        const request = store.get(DATABASE_FILE_KEY);
        request.onsuccess = () => {
          if ((request.result?.revision ?? 0) !== expectedRevision) {
            failure = new DatabaseError('另一窗口已更新本地数据。为避免覆盖，请关闭其他窗口并重新打开本页。', 'revision_conflict');
            transaction.abort();
            return;
          }
          store.put({ bytes, revision: expectedRevision + 1, updatedAt: new Date().toISOString() }, DATABASE_FILE_KEY);
        };
        transaction.oncomplete = () => { db.close(); resolve(expectedRevision + 1); };
        transaction.onabort = () => { db.close(); reject(failure ?? safeDatabaseError(transaction.error, '本地数据尚未保存，请重试。')); };
        transaction.onerror = () => {};
      });
    },
  };
}
