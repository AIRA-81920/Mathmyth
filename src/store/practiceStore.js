import { create } from 'zustand';
import { useAppStore } from './appStore.js';
import * as database from '../core/db/database.js';
import { loadSkeleton } from '../core/skeleton/load.js';
import { generatePractice, assessSteps } from '../core/ai/practice.js';
import { practiceChoices, nextPreparedChoiceIndex } from '../core/mastery/choices.js';
import { prepareLocalPracticeInput } from '../core/practice/bank.js';
import { isRouteQuestion } from '../core/practice/routes.js';
import { registerPracticeExitFlush } from '../core/learning/practiceExit.js';

let epoch = 0;
let controller;
let initialization;
let generationEpoch = 0, generationController;
// 每次「返回练习入口」+1：AI 出题的迟到回调据此判断用户是否已经主动退回入口。
let entryEpoch = 0;
const inputDrafts = new Map();
// 未提交输入的落库节流状态，与聊天随练同一口径：按 itemId 建键。
const DRAFT_DELAY = 350;
const draftTimers = new Map(), draftPending = new Map(), draftSavedAt = new Map(), savedDrafts = new Map();
const initial = { screen: 'entry', choices: [], choiceIndex: 0, session: null, itemIndex: 0,
  selectedIds: [], steps: '', mode: 'selection', level: 'single', busy: false, modelBusy: false, generating: false, generationProgress: '', error: '', feedbackHidden: false,
  pendingStart: null, pendingNext: false,
  history: [], historyBusy: false, historyMore: false };
// 内存里的未提交输入优先；没有内存记录时用库里的草稿。
// 已判分的题不能用草稿回填（判分时 answer.draft 会被写成提交内容）。
function inputFor(item) {
  const draft = item ? inputDrafts.get(item.id) : undefined;
  if (draft) return { selectedIds: [...draft.selectedIds], steps: draft.steps, mode: draft.mode, feedbackHidden: draft.feedbackHidden === true, error: '' };
  const answer = item?.answer ?? {};
  const graded = Boolean(answer.outcome) || Boolean(answer.advanced);
  const stored = graded ? undefined : (typeof answer.draft === 'string' ? answer.draft : undefined);
  return { selectedIds: [...(answer.selectedIds ?? [])], mode: answer.mode ?? (stored !== undefined ? 'steps' : 'selection'),
    steps: stored ?? answer.steps ?? '', feedbackHidden: false, error: '' };
}
function rememberInput(state) {
  const item = state.session?.items[state.itemIndex];
  if (item && !state.session.finishedAt) inputDrafts.set(item.id, { steps: state.steps, mode: state.mode,
    selectedIds: [...state.selectedIds], feedbackHidden: state.feedbackHidden === true });
}
function clearDraftTimers() {
  for (const timer of draftTimers.values()) clearTimeout(timer);
  draftTimers.clear(); draftPending.clear(); draftSavedAt.clear(); savedDrafts.clear();
}

async function edges() {
  const [skeleton, data] = await Promise.all([loadSkeleton(), database.loadTrail()]);
  return await practiceChoices(skeleton, data, { includePrepared: true });
}

export const usePracticeStore = create((set, get) => ({
  ...initial,
  initialize: () => {
    const app = useAppStore.getState();
    if (!app.storageInitialized || app.dataOperation) return Promise.resolve();
    if (initialization) return initialization;
    const owner = epoch;
    const request = (async () => {
      try {
        const [choices, active] = await Promise.all([edges(), database.loadActivePractice()]);
        if (owner !== epoch) return;
        const session = get().session ?? active;
        const index = session ? Math.max(0, session.items.findIndex((item) => !item.answer?.advanced)) : 0;
        const selectedKey = get().choices[get().choiceIndex]?.key;
        set({ choices, choiceIndex: Math.max(0, choices.findIndex((choice) => choice.key === selectedKey)), session, itemIndex: index });
        // 停在做题页时按库里的草稿补齐未提交输入；内存里已有的输入与已判分的题都不覆盖。
        const item = session?.items[index];
        if (item && get().screen === 'run' && !inputDrafts.has(item.id) && !item.answer?.outcome && !item.answer?.advanced)
          set(inputFor(item));
      } catch (error) { if (owner === epoch) set({ error: error.userMessage || '练习暂时没能读出来，请重试。' }); }
    })().finally(() => { if (initialization === request) initialization = null; });
    initialization = request;
    return request;
  },
  // 切换学科时清空内存里的选题与进行中的一轮：数据库记录保留，
  // 但下一学科不应复用上一学科的骨架派生结果。
  reset: () => {
    epoch += 1;
    controller?.abort(); controller = null;
    generationController?.abort(); generationController = null;
    initialization = null;
    clearDraftTimers();
    set({ ...initial, choices: [], session: null });
  },
  changeEdge: () => { if (!get().busy && !get().generating) set({ choiceIndex: nextPreparedChoiceIndex(get().choices, get().choiceIndex), error: '' }); },
  selectChoice: (key) => {
    if (get().busy || get().generating) return false;
    const choiceIndex = get().choices.findIndex((choice) => choice.key === key);
    if (choiceIndex < 0) return false;
    set({ choiceIndex, error: '' });
    return true;
  },
  setLevel: (level) => { if (['single', 'multi', 'best'].includes(level) && !get().busy && !get().generating) set({ level }); },
  showEntry: () => {
    if (get().busy) return;
    entryEpoch += 1;
    set({ screen: 'entry', pendingNext: false });
    // 离开做题页时把还没到点的草稿立刻落库，别等下一次输入。
    get().flushDrafts().catch(() => {});
  },
  showHistory: async (more = false) => {
    if (get().historyBusy || get().busy) return;
    const owner = epoch;
    set({ screen: 'history', historyBusy: true, error: '' });
    try {
      const page = await database.listPracticeHistory({ offset: more ? get().history.length : 0, limit: 60 });
      if (owner === epoch) set({ history: more ? [...get().history, ...page.items] : page.items, historyMore: page.hasMore });
    } catch (error) { if (owner === epoch) set({ error: error.userMessage || '练习记录暂时没能读出来。' }); }
    finally { if (owner === epoch) set({ historyBusy: false }); }
  },
  resume: () => {
    const session = get().session;
    if (!session || session.finishedAt || get().busy) return;
    const index = Math.max(0, session.items.findIndex((item) => !item.answer?.advanced));
    set({ screen: 'run', itemIndex: index, ...inputFor(session.items[index]) });
  },
  // 未提交输入落 answer.draft：只写草稿，不碰 steps/selectedIds 等判分字段。
  saveDraft: async (itemId, text) => {
    clearTimeout(draftTimers.get(itemId)); draftTimers.delete(itemId);
    const session = get().session, item = session?.items.find((entry) => entry.id === itemId), owner = epoch;
    if (!item || session.finishedAt || item.answer?.outcome || item.answer?.advanced || useAppStore.getState().dataOperation) return true;
    if (typeof text !== 'string' || text === savedDrafts.get(itemId) || text === (item.answer?.draft ?? null)) return true;
    try {
      await database.savePracticeDraft(session, itemId, text);
      if (owner === epoch) { savedDrafts.set(itemId, text); draftSavedAt.set(itemId, Date.now()); }
      return owner === epoch;
    } catch (error) {
      if (owner === epoch) set({ error: error.userMessage || '草稿暂未保存，请稍后重试。' });
      return false;
    }
  },
  scheduleDraft: (itemId) => {
    const session = get().session, item = session?.items.find((entry) => entry.id === itemId);
    if (!item || session.finishedAt || item.answer?.outcome || item.answer?.advanced) return;
    const text = get().steps;
    if (text === savedDrafts.get(itemId)) return;
    draftPending.set(itemId, text);
    const write = () => {
      const value = draftPending.get(itemId);
      draftPending.delete(itemId); draftTimers.delete(itemId);
      if (value !== undefined) get().saveDraft(itemId, value).catch(() => {});
    };
    const wait = DRAFT_DELAY - (Date.now() - (draftSavedAt.get(itemId) ?? 0));
    if (!draftTimers.has(itemId) && wait <= 0) { write(); return; }
    clearTimeout(draftTimers.get(itemId));
    draftTimers.set(itemId, setTimeout(write, Math.max(0, wait)));
  },
  flushDrafts: async () => {
    for (const [itemId, text] of [...draftPending]) {
      clearTimeout(draftTimers.get(itemId)); draftTimers.delete(itemId); draftPending.delete(itemId);
      if (!await get().saveDraft(itemId, text)) return false;
    }
    return true;
  },
  start: async (options = {}) => {
    const edge = get().choices[get().choiceIndex];
    if (!edge || get().busy || get().generating) return;
    // 入口页「开练」与「继续上次这一轮」并排：还有没练完的一轮时必须先确认，
    // 否则 createPracticeRun 会静默结束它（practiceDb.js:139）。
    const unfinished = get().session;
    if (!options?.confirm && unfinished && !unfinished.finishedAt) {
      set({ pendingStart: { ai: options?.ai === true }, error: '这一轮还没练完。确认开新的一轮会结束它，未提交的输入会保留为草稿。' });
      return;
    }
    set({ pendingStart: null });
    const useAi = options?.ai === true;
    const owner = ++generationEpoch;
    const entryAtStart = entryEpoch;
    const task = new AbortController(); generationController = task;
    let generatedSession;
    set({ generating: useAi, busy: !useAi, generationProgress: useAi ? '正在连接模型…' : '', error: '' });
    try {
      const skeleton = await loadSkeleton();
      if (!useAi) {
        const usage = await database.loadPracticeUsage();
        if (owner !== generationEpoch || useAppStore.getState().dataOperation) return;
        const input = await prepareLocalPracticeInput(edge, skeleton, get().level, usage);
        if (task.signal.aborted) throw Object.assign(new Error(), { name: 'AbortError' });
        if (!input) { set({ error: '这个目标还没有已准备的本地题。可以换一个目标，或主动让 AI 编写变式。' }); return; }
        if (owner !== generationEpoch || useAppStore.getState().dataOperation) return;
        const session = await database.createPracticeRun(input);
        if (owner === generationEpoch && !useAppStore.getState().dataOperation) set({ session, screen: 'run', itemIndex: 0, ...inputFor(null) });
        return;
      }
      await generatePractice({ config: { ...useAppStore.getState().modelConfig }, skeleton, anchor: edge.anchor,
        scenarioId: edge.scenarioId, methodId: edge.methodId, level: get().level, signal: task.signal,
        onProgress: (progress) => { if (owner === generationEpoch) set({ generationProgress: progress }); },
        onItem: async (item) => {
          if (owner !== generationEpoch || useAppStore.getState().dataOperation) return;
          generatedSession = generatedSession ? await database.appendPracticeItems(generatedSession, [item])
            : await database.createPracticeRun({ scenarioId: edge.scenarioId, methodId: edge.methodId, items: [item] });
          if (owner !== generationEpoch) return;
          // 用户已退回入口时不再把他弹回做题页，只把题目准备好。
          const toRun = entryEpoch === entryAtStart ? { screen: 'run', itemIndex: 0, ...inputFor(null) } : {};
          if (generatedSession.items.length === 1) set({ session: generatedSession, ...toRun });
          else set({ session: generatedSession });
        } });
      if (owner !== generationEpoch || useAppStore.getState().dataOperation) return;
      generatedSession = await database.appendPracticeItems(generatedSession, [], 'complete');
      if (owner === generationEpoch) set({ session: generatedSession });
    } catch (error) {
      // 取消把 generationEpoch 往前推了，但这次 start 自己的 controller 被 abort 仍要收尾：
      // 已生成的题目保留为 failed，提示用取消文案（cancel 已经写过同样的提示）。
      const aborted = error.name === 'AbortError' || task.signal.aborted;
      if (owner === generationEpoch || aborted) {
        if (generatedSession && !useAppStore.getState().dataOperation) {
          try {
            generatedSession = await database.appendPracticeItems(generatedSession, [], 'failed');
            if (owner === generationEpoch) set({ session: generatedSession, ...(generatedSession.finishedAt ? { screen: 'finished' } : {}) });
            else set({ session: generatedSession });
          } catch { /* Storage error remains visible. */ }
        }
        set({ error: aborted ? '已停止出题，已生成的题目仍可练。' : error.userMessage || '这轮题目没能生成，请重试。' });
      }
    } finally { if (owner === generationEpoch) { generationController = null; set({ busy: false, generating: false, generationProgress: '' }); } }
  },
  // 取消同时推进两条 epoch：epoch 管判分/读库，generationEpoch 管出题回调，
  // 否则迟到的 onItem 仍会被当成有效结果。
  cancel: () => {
    const wasGenerating = get().generating;
    epoch += 1; generationEpoch += 1;
    controller?.abort(); controller = null;
    generationController?.abort(); generationController = null;
    set({ busy: false, modelBusy: false, generating: false, generationProgress: '',
      error: wasGenerating ? '已停止出题，已生成的题目仍可练。' : '' });
  },
  setMode: (mode) => { if (['selection','steps'].includes(mode) && !get().busy) { set({ mode }); rememberInput(get()); } },
  setSteps: (steps) => { set({ steps }); rememberInput(get()); const item = get().session?.items[get().itemIndex]; if (item) get().scheduleDraft(item.id); },
  toggleMethod: (id) => {
    if (get().busy) return;
    set((state) => {
      const question = state.session?.items[state.itemIndex]?.question;
      return { selectedIds: isRouteQuestion(question) && question.selectionMode !== 'multi' ? [id]
        : state.selectedIds.includes(id) ? state.selectedIds.filter((value) => value !== id) : [...state.selectedIds, id] };
    });
    rememberInput(get());
    const item = get().session?.items[get().itemIndex]; if (item) get().scheduleDraft(item.id);
  },
  submit: async () => {
    const { session, itemIndex, mode, selectedIds, steps, busy } = get();
    if (!session || busy || !session.items[itemIndex] || (mode === 'selection' ? !selectedIds.length : !steps.trim())) return;
    const owner = ++epoch;
    controller = new AbortController();
    const item = session.items[itemIndex];
    set({ busy: true, modelBusy: mode === 'steps', error: '' });
    try {
      const assessment = mode === 'steps' ? await assessSteps({ config: { ...useAppStore.getState().modelConfig },
        question: item.question, steps, skeleton: await loadSkeleton(), signal: controller.signal }) : undefined;
      if (owner !== epoch || useAppStore.getState().dataOperation) return;
      const updated = await database.gradePracticeItem(session, item.id, { mode, selectedIds, steps, assessment });
      if (owner === epoch) {
        clearTimeout(draftTimers.get(item.id)); draftTimers.delete(item.id); draftPending.delete(item.id);
        savedDrafts.delete(item.id); draftSavedAt.delete(item.id);
        inputDrafts.delete(item.id);
        set({ session: updated, feedbackHidden: false });
      }
    } catch (error) { if (owner === epoch && error.name !== 'AbortError') set({ error: error.userMessage || '这次作答没能检查完成，请重试。' }); }
    finally { if (owner === epoch) { controller = null; set({ busy: false, modelBusy: false }); } }
  },
  retryItem: () => { if (!get().busy) { set({ selectedIds: [], steps: '', error: '', feedbackHidden: true }); rememberInput(get()); } },
  reveal: async () => {
    const { session, itemIndex, busy } = get();
    if (!session || busy || !session.items[itemIndex]) return;
    const owner = epoch;
    set({ busy: true, error: '' });
    try { const updated = await database.revealPracticeItem(session, session.items[itemIndex].id); if (owner === epoch) set({ session: updated }); }
    catch (error) { if (owner === epoch) set({ error: error.userMessage || '答案暂时没有读出来。' }); }
    finally { if (owner === epoch) set({ busy: false }); }
  },
  // 未提交就点「下一道」会把这道题标成 advanced 且不可回退，必须先确认。
  next: async (options = {}) => {
    const { session, itemIndex, busy } = get();
    if (!session || busy || !session.items[itemIndex]) return;
    const item = session.items[itemIndex];
    if (!options?.confirm && !item.answer?.outcome && !item.answer?.revealed) {
      set({ pendingNext: true, error: '这一题还没提交。确认跳过后不能回退，未提交的输入会保留为草稿。' });
      return;
    }
    set({ pendingNext: false });
    const owner = epoch;
    set({ busy: true, error: '' });
    try {
      const updated = await database.advancePracticeItem(session, item.id);
      if (owner !== epoch) return;
      const index = Math.min(itemIndex + 1, 2);
      set({ session: updated, itemIndex: index, screen: updated.finishedAt ? 'finished' : 'run', ...inputFor(updated.items[index]) });
      if (updated.finishedAt) {
        const selectedKey = get().choices[get().choiceIndex]?.key;
        const choices = await edges();
        if (owner === epoch) set({ choices, choiceIndex: Math.max(0, choices.findIndex((choice) => choice.key === selectedKey)) });
      }
    } catch (error) { if (owner === epoch) set({ error: error.userMessage || '没能保存这一题，请重试。' }); }
    finally { if (owner === epoch) set({ busy: false }); }
  },
  confirmStart: () => {
    const pending = get().pendingStart;
    if (!pending) return;
    set({ pendingStart: null, error: '' });
    return get().start({ ...pending, confirm: true });
  },
  cancelStart: () => set({ pendingStart: null, error: '' }),
  confirmNext: () => {
    if (!get().pendingNext) return;
    set({ pendingNext: false, error: '' });
    return get().next({ confirm: true });
  },
  cancelNext: () => set({ pendingNext: false, error: '' }),
}));

usePracticeStore.subscribe((state, previous) => {
  if (state.session?.id !== previous.session?.id) { inputDrafts.clear(); clearDraftTimers(); }
});
// 关闭/隐藏应用时把还没到点的独立练习草稿立刻写掉（App 里最后 350ms 打的字不能靠定时器）。
registerPracticeExitFlush(() => usePracticeStore.getState().flushDrafts());

useAppStore.subscribe((state, previous) => {
  if (state.learnerId !== previous.learnerId || (state.dataOperation && !previous.dataOperation)) {
    epoch += 1; generationEpoch += 1; initialization = null; controller?.abort(); generationController?.abort(); controller = null; generationController = null;
    clearDraftTimers();
    usePracticeStore.setState({ ...initial });
  } else if (state.modelConfig !== previous.modelConfig && (usePracticeStore.getState().busy || usePracticeStore.getState().generating)) usePracticeStore.getState().cancel();
});
