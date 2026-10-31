// 独立练习 store 的测试脚手架：真实 store 源码 + 程序化 mock database。
// 手法沿用 tests/practice-start.test.mjs:104-140（读源码、替换 import、data: URL 动态 import）。
import { readFile } from 'node:fs/promises';
import { create } from 'zustand';

const sourceUrl = new URL('../src/store/practiceStore.js', import.meta.url);
const registry = globalThis.__practiceStoreHarness ??= new Map();

const PATCHES = [
  ["import { useAppStore } from './appStore.js';", 'const useAppStore = globalThis.__practiceStoreHarness.get(__key).app;'],
  ["import * as database from '../core/db/database.js';", 'const database = globalThis.__practiceStoreHarness.get(__key).database;'],
  ["import { loadSkeleton } from '../core/skeleton/load.js';", 'const loadSkeleton = globalThis.__practiceStoreHarness.get(__key).core.loadSkeleton;'],
  ["import { generatePractice, assessSteps } from '../core/ai/practice.js';", 'const { generatePractice, assessSteps } = globalThis.__practiceStoreHarness.get(__key).core;'],
  ["import { practiceChoices, nextPreparedChoiceIndex } from '../core/mastery/choices.js';", 'const { practiceChoices, nextPreparedChoiceIndex } = globalThis.__practiceStoreHarness.get(__key).core;'],
  ["import { prepareLocalPracticeInput } from '../core/practice/bank.js';", 'const prepareLocalPracticeInput = globalThis.__practiceStoreHarness.get(__key).core.prepareLocalPracticeInput;'],
  ["import { isRouteQuestion } from '../core/practice/routes.js';", 'const isRouteQuestion = globalThis.__practiceStoreHarness.get(__key).core.isRouteQuestion;'],
];

export function question(label) {
  return {
    question: '求 lim ' + label + '：x→0 sin(x)/x', solution: '等价无穷小，结果 1。', format: 'route-v1', selectionMode: 'single',
    options: [{ id: 'M.a', name: '路线 A' }, { id: 'M.b', name: '路线 B' }, { id: 'M.c', name: '路线 C' }],
    routes: [{ id: 'M.a' }, { id: 'M.b' }, { id: 'M.c' }],
    questionKey: 'key-' + label, faceKey: 'face-' + label,
    candidateMethodIds: ['M.a', 'M.b', 'M.c'], applicableMethodIds: ['M.a'], coreMethodIds: ['M.a'],
    entranceScenarioId: 'S.1', metadata: {},
  };
}

export function createCore(overrides = {}) {
  const core = {
    nextInput: { scenarioId: 'S.1', methodId: 'M.a', items: [question('q1'), question('q2'), question('q3')] },
    generateImpl: null,
    choices: [{ key: 'S.1', scenarioId: 'S.1', methodId: 'M.a', localReady: true, questionCount: 3, count: 1, anchor: '' }],
    loadSkeleton: async () => ({}),
    practiceChoices: async () => core.choices,
    nextPreparedChoiceIndex: (choices, current) => current,
    prepareLocalPracticeInput: () => core.nextInput,
    generatePractice: async (options) => {
      if (!core.generateImpl) throw new Error('本用例未配置 generatePractice');
      return core.generateImpl(options);
    },
    assessSteps: async () => ({ outcome: 'right', feedback: '关键步骤正确。', methodIds: ['M.a'] }),
    isRouteQuestion: (value) => value?.format === 'route-v1',
    ...overrides,
  };
  return core;
}

// 只镜像 store 依赖的契约，不复制 practiceDb 的业务校验（见 .qa/sweep-state/mockDb.mjs 的出处注释）。
export function createDb() {
  let seq = 0;
  const runs = [], calls = [];
  const state = { failDraft: false };
  const invalid = () => Object.assign(new Error('练习记录不完整，请重新打开练习。'), { code: 'invalid_practice' });
  const uid = (prefix) => prefix + '-' + (++seq);
  const now = () => new Date().toISOString();
  const live = (ref) => {
    const id = typeof ref === 'string' ? ref : ref?.id;
    const run = runs.find((entry) => entry.id === id);
    if (!run) throw invalid();
    return run;
  };
  const view = (run) => ({
    id: run.id, scenarioId: run.scenarioId, methodId: run.methodId, origin: run.origin, startedAt: run.startedAt,
    finishedAt: run.finishedAt, generationStatus: run.generationStatus,
    items: run.items.map((item) => ({ id: item.id, seq: item.seq, question: structuredClone(item.question),
      answer: item.answer ? structuredClone(item.answer) : null, result: item.result })),
  });
  const itemOf = (run, id) => {
    if (run.finishedAt) throw invalid();
    const item = run.items.find((entry) => entry.id === id);
    if (!item) throw invalid();
    return item;
  };
  return {
    runs, calls, state,
    async loadTrail() { return { mastery: [], encounters: [] }; },
    async loadPracticeUsage() { return []; },
    async listPracticeHistory() { return { items: [], hasMore: false }; },
    async createPracticeRun(input) {
      calls.push({ method: 'createPracticeRun', items: input?.items?.length ?? 0 });
      if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 3) throw invalid();
      const at = now();
      for (const run of runs) if (!run.finishedAt) run.finishedAt = at;
      const run = { id: uid('practice'), origin: 'practice', scenarioId: input.scenarioId, methodId: input.methodId,
        startedAt: at, finishedAt: null, generationStatus: input.items.length === 3 ? 'complete' : 'preparing',
        items: input.items.map((entry, index) => ({ id: uid('item'), seq: index + 1, question: structuredClone(entry), answer: null, result: null })) };
      runs.push(run);
      return view(run);
    },
    async appendPracticeItems(ref, items = [], status = 'preparing') {
      const run = live(ref);
      if (run.finishedAt || run.generationStatus !== 'preparing' || run.items.length + items.length > 3) throw invalid();
      for (const entry of items) run.items.push({ id: uid('item'), seq: run.items.length + 1, question: structuredClone(entry), answer: null, result: null });
      if (status === 'complete' && run.items.length !== 3) throw invalid();
      run.generationStatus = status;
      calls.push({ method: 'appendPracticeItems', status });
      return view(run);
    },
    async loadActivePractice() {
      const row = runs.filter((run) => !run.finishedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      return row ? view(row) : null;
    },
    async gradePracticeItem(ref, itemId, attempt) {
      const run = live(ref), item = itemOf(run, itemId);
      if (item.answer?.advanced) throw invalid();
      const assessment = attempt.mode === 'selection'
        ? { outcome: attempt.selectedIds?.length ? 'right' : 'wrong', feedback: '路线判断完成。', methodIds: [] }
        : (attempt.assessment ?? { outcome: 'right', feedback: '关键步骤正确。', methodIds: [] });
      item.answer = { ...item.answer, mode: attempt.mode, selectedIds: attempt.selectedIds ?? [], steps: attempt.steps ?? '',
        ...(attempt.mode === 'steps' ? { draft: attempt.steps ?? '' } : {}),
        outcome: assessment.outcome, feedback: assessment.feedback, advanced: false };
      calls.push({ method: 'gradePracticeItem', mode: attempt.mode });
      return view(run);
    },
    async advancePracticeItem(ref, itemId) {
      const run = live(ref), item = itemOf(run, itemId);
      item.answer = { ...item.answer, advanced: true };
      if (item.seq === 3 || (run.generationStatus !== 'preparing' && item.seq === run.items.length)) run.finishedAt = now();
      calls.push({ method: 'advancePracticeItem', seq: item.seq });
      return view(run);
    },
    async revealPracticeItem(ref, itemId) {
      const run = live(ref), item = itemOf(run, itemId);
      item.answer = { ...item.answer, revealed: true };
      return view(run);
    },
    async savePracticeDraft(ref, itemId, text) {
      const run = live(ref), item = itemOf(run, itemId);
      if (state.failDraft) {
        calls.push({ method: 'savePracticeDraft', ok: false, itemId, text });
        throw Object.assign(new Error('storage_quota'), { name: 'QuotaExceededError', userMessage: '草稿暂未保存，请稍后重试。' });
      }
      item.answer = { ...item.answer, draft: text };
      calls.push({ method: 'savePracticeDraft', ok: true, itemId, text });
      return { saved: true };
    },
    draftOf(runId, itemId) { return runs.find((run) => run.id === runId)?.items.find((item) => item.id === itemId)?.answer; },
  };
}

export async function createApp({ db, core }) {
  const app = create(() => ({ learnerId: 'learner-test', storageInitialized: true, dataOperation: null, modelConfig: {} }));
  return { app, practice: await loadPracticeStore({ database: db, core, app }) };
}

export async function loadPracticeStore({ database, core, app }) {
  const key = crypto.randomUUID();
  registry.set(key, { app, database, core });
  let source = await readFile(sourceUrl, 'utf8');
  for (const [from, to] of PATCHES) {
    if (!source.includes(from)) throw new Error('注入点未命中: ' + from);
    source = source.replace(from, to);
  }
  source = source.replaceAll('__key', JSON.stringify(key))
    .replace("from 'zustand'", "from '" + import.meta.resolve('zustand') + "'")
    .replace(/from '(\.\.?\/[^']+)'/g, (_, path) => "from '" + new URL(path, sourceUrl).href + "'");
  try {
    const { usePracticeStore } = await import('data:text/javascript;base64,' + Buffer.from(source + '\n// practice-harness\n').toString('base64'));
    return usePracticeStore;
  } finally { registry.delete(key); }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
