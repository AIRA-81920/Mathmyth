import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import schemaSql from './schema.sql?raw';
import { DatabaseEngine } from './engine.js';
import { createIndexedDbStorage } from './indexedDb.js';
import { safeDatabaseError } from './errors.js';

let enginePromise;
function engine() {
  if (!enginePromise) {
    enginePromise = initSqlJs({ locateFile: () => wasmUrl }).then((SQL) => new DatabaseEngine({
      SQL, schemaSql, storage: createIndexedDbStorage(),
    })).catch(() => {
      enginePromise = undefined;
      throw safeDatabaseError(null, '本地数据库组件无法加载，请重新打开 App 后重试。');
    });
  }
  return enginePromise;
}

const methods = new Set(['initializeDatabase','loadConversation','loadImage','saveChanges','exportBackup','prepareImport','commitImport','cancelImport','clearDatabase',
  'claimNextJob','checkpointJob','completeJob','failJob','loadTrail','loadQuestionRoutes','retryQuestionRoutes','loadPatternProgress','listPersonalNotes','savePersonalNote','deletePersonalNote',
  'listStarredQuestions','loadStarredQuestion','setQuestionStar','removeStarredQuestion','getMessageQuestionClassification','requestMessageQuestionClassification',
  'createPracticeRun','appendPracticeItems','updateConversation','deleteConversation','loadActivePractice','loadPracticeItem','listPracticeHistory','loadPracticeUsage','gradePracticeItem','revealPracticeItem','advancePracticeItem','searchConversations']);
let serial = Promise.resolve();
let generation = 0;

// Awaiting IDB must not allow another RPC to interleave a SQL transaction,
// database replacement or export. A rejected RPC never poisons the queue.
self.onmessage = ({ data }) => {
  serial = serial.then(async () => {
    const { id, method, args = [], epoch } = data;
    try {
      if (!methods.has(method)) throw safeDatabaseError(null, '本地数据请求无效，请重试。');
      if (epoch !== generation) throw safeDatabaseError(null, '数据已被替换，请重新执行这次操作。');
      const target = await engine();
      if (!['initializeDatabase','exportBackup','prepareImport','commitImport','cancelImport','clearDatabase'].includes(method) && !target.db) {
        await target.initializeDatabase();
      }
      const result = await target[method](...args);
      if (method === 'commitImport' || method === 'clearDatabase') generation += 1;
      if (['claimNextJob','createPracticeRun','appendPracticeItems','loadActivePractice','loadPracticeItem','gradePracticeItem','revealPracticeItem','advancePracticeItem'].includes(method) && result) result.generation = generation;
      self.postMessage({ id, ok: true, result, generation });
      if (['saveChanges','deleteConversation','checkpointJob','completeJob','failJob','retryQuestionRoutes','commitImport','clearDatabase','gradePracticeItem','revealPracticeItem','savePersonalNote','deletePersonalNote','setQuestionStar','removeStarredQuestion','requestMessageQuestionClassification'].includes(method)) {
        self.postMessage({ type: 'changed', method, generation });
      }
    } catch (error) {
      const safe = safeDatabaseError(error);
      self.postMessage({ id, ok: false, error: { code: safe.code, userMessage: safe.userMessage }, generation });
    }
  }).catch(() => {});
};
