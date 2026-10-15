import { create } from 'zustand';
import { useAppStore } from './appStore.js';
import * as database from '../core/db/database.js';
import { loadSkeleton } from '../core/skeleton/load.js';
import { generatePractice, assessSteps } from '../core/ai/practice.js';
import { practiceChoices, nextPreparedChoiceIndex } from '../core/mastery/choices.js';
import { prepareLocalRound } from '../core/practice/bank.js';
import { isRouteQuestion } from '../core/practice/routes.js';

let epoch = 0;
let controller;
let initialization;
let generationEpoch = 0, generationController;
const initial = { screen: 'entry', choices: [], choiceIndex: 0, session: null, itemIndex: 0,
  selectedIds: [], steps: '', mode: 'selection', level: 'single', busy: false, modelBusy: false, generating: false, generationProgress: '', error: '', feedbackHidden: false,
  history: [], historyBusy: false, historyMore: false };
function inputFor(item) {
  return { selectedIds: item?.answer?.selectedIds ?? [], steps: item?.answer?.steps ?? '', mode: item?.answer?.mode ?? 'selection', error: '', feedbackHidden: false };
}

async function edges() {
  const [skeleton, data] = await Promise.all([loadSkeleton(), database.loadTrail()]);
  return practiceChoices(skeleton, data, { includePrepared: true });
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
      } catch (error) { if (owner === epoch) set({ error: error.userMessage || '练习暂时没能读出来，请重试。' }); }
    })().finally(() => { if (initialization === request) initialization = null; });
    initialization = request;
    return request;
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
  showEntry: () => { if (!get().busy) set({ screen: 'entry' }); },
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
  start: async (options = {}) => {
    const edge = get().choices[get().choiceIndex];
    if (!edge || get().busy || get().generating) return;
    const useAi = options?.ai === true;
    const owner = ++generationEpoch;
    const task = new AbortController(); generationController = task;
    let generatedSession;
    set({ generating: useAi, busy: !useAi, generationProgress: useAi ? '正在连接模型…' : '', error: '' });
    try {
      const skeleton = await loadSkeleton();
      if (!useAi) {
        const usage = await database.loadPracticeUsage();
        if (owner !== generationEpoch || useAppStore.getState().dataOperation) return;
        const items = await prepareLocalRound(edge, skeleton, get().level, usage);
        if (task.signal.aborted) throw Object.assign(new Error(), { name: 'AbortError' });
        if (!items) { set({ error: '这个目标还没有已准备的本地题。可以换一个目标，或主动让 AI 编写变式。' }); return; }
        const session = await database.createPracticeRun({ scenarioId: edge.scenarioId, methodId: edge.methodId, items, localPrepared: true });
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
          if (generatedSession.items.length === 1) set({ session: generatedSession, screen: 'run', itemIndex: 0, ...inputFor(null) });
          else set({ session: generatedSession });
        } });
      if (owner !== generationEpoch || useAppStore.getState().dataOperation) return;
      generatedSession = await database.appendPracticeItems(generatedSession, [], 'complete');
      if (owner === generationEpoch) set({ session: generatedSession });
    } catch (error) {
      if (owner === generationEpoch) {
        if (generatedSession && !useAppStore.getState().dataOperation) {
          try { generatedSession = await database.appendPracticeItems(generatedSession, [], 'failed'); if (owner === generationEpoch) set({ session: generatedSession, ...(generatedSession.finishedAt ? { screen: 'finished' } : {}) }); } catch { /* Storage error remains visible. */ }
        }
        set({ error: error.name === 'AbortError' ? '已停止出题，已生成的题目仍可练。' : error.userMessage || '这轮题目没能生成，请重试。' });
      }
    } finally { if (owner === generationEpoch) { generationController = null; set({ busy: false, generating: false, generationProgress: '' }); } }
  },
  cancel: () => { epoch += 1; controller?.abort(); controller = null; generationController?.abort(); set({ busy: false, modelBusy: false, error: '' }); },
  setMode: (mode) => { if (['selection','steps'].includes(mode) && !get().busy) set({ mode }); },
  setSteps: (steps) => set({ steps }),
  toggleMethod: (id) => {
    if (get().busy) return;
    set((state) => {
      const question = state.session?.items[state.itemIndex]?.question;
      return { selectedIds: isRouteQuestion(question) && question.selectionMode !== 'multi' ? [id]
        : state.selectedIds.includes(id) ? state.selectedIds.filter((value) => value !== id) : [...state.selectedIds, id] };
    });
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
      if (owner === epoch) set({ session: updated, feedbackHidden: false });
    } catch (error) { if (owner === epoch && error.name !== 'AbortError') set({ error: error.userMessage || '这次作答没能检查完成，请重试。' }); }
    finally { if (owner === epoch) { controller = null; set({ busy: false, modelBusy: false }); } }
  },
  retryItem: () => { if (!get().busy) set({ selectedIds: [], steps: '', error: '', feedbackHidden: true }); },
  reveal: async () => {
    const { session, itemIndex, busy } = get();
    if (!session || busy || !session.items[itemIndex]) return;
    const owner = epoch;
    set({ busy: true, error: '' });
    try { const updated = await database.revealPracticeItem(session, session.items[itemIndex].id); if (owner === epoch) set({ session: updated }); }
    catch (error) { if (owner === epoch) set({ error: error.userMessage || '答案暂时没有读出来。' }); }
    finally { if (owner === epoch) set({ busy: false }); }
  },
  next: async () => {
    const { session, itemIndex, busy } = get();
    if (!session || busy || !session.items[itemIndex]) return;
    const owner = epoch;
    set({ busy: true, error: '' });
    try {
      const updated = await database.advancePracticeItem(session, session.items[itemIndex].id);
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
}));

useAppStore.subscribe((state, previous) => {
  if (state.learnerId !== previous.learnerId || (state.dataOperation && !previous.dataOperation)) {
    epoch += 1; generationEpoch += 1; initialization = null; controller?.abort(); generationController?.abort(); controller = null; generationController = null; usePracticeStore.setState({ ...initial });
  } else if (state.modelConfig !== previous.modelConfig && (usePracticeStore.getState().busy || usePracticeStore.getState().generating)) usePracticeStore.getState().cancel();
});
