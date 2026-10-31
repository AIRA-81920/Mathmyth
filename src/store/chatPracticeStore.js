import { create } from 'zustand';
import { useAppStore } from './appStore.js';
import * as database from '../core/db/database.js';
import { assessSteps } from '../core/ai/practice.js';
import { registerPracticeDraftFlush } from '../core/learning/draftFlush.js';
import { registerPracticeExitCancel } from '../core/learning/practiceExit.js';

let epoch = 0;
const controllers = new Map(), draftTimers = new Map();
const savedDrafts = new Map();
const ref = item => ({ id: item.runId, generation: item.generation });
export const useChatPracticeStore = create((set, get) => ({
  items: {}, busy: {}, checking: {}, errors: {}, drafts: {},
  load: async id => {
    const owner = epoch;
    try {
      const item = await database.loadPracticeItem(id);
      if (owner === epoch) set(s => ({ items: { ...s.items, [id]: item }, errors: { ...s.errors, [id]: '' } }));
    } catch (error) { if (owner === epoch) set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '这道练习暂时无法读取。' } })); }
  },
  setDraft: (id, text) => {
    const item = get().items[id];
    if (!item || item.finishedAt) return;
    // 导入/导出/清库期间照样收下输入，只是先不落库：操作结束后由 appStore.subscribe 统一补写，
    // 否则这段时间打的字会被静默丢弃。
    set(s => ({ drafts: { ...s.drafts, [id]: text } }));
    clearTimeout(draftTimers.get(id));
    draftTimers.delete(id);
    if (useAppStore.getState().dataOperation) return;
    draftTimers.set(id, setTimeout(() => { get().flushDraft(id); }, 350));
  },
  flushDraft: async id => {
    clearTimeout(draftTimers.get(id)); draftTimers.delete(id);
    const item = get().items[id], text = get().drafts[id], owner = epoch;
    if (!item || item.finishedAt || text === undefined || text === savedDrafts.get(id) || text === item.answer?.draft || useAppStore.getState().dataOperation) return true;
    try { await database.savePracticeDraft(ref(item), id, text); if (owner === epoch) savedDrafts.set(id, text); return owner === epoch; }
    catch (error) { if (owner === epoch) set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '草稿暂未保存，请稍后重试。' } })); return false; }
  },
  flushDrafts: async () => {
    let saved = true;
    for (const id of Object.keys(get().drafts)) if (!await get().flushDraft(id)) saved = false;
    return saved;
  },
  submit: async (id, attempt) => {
    if (get().busy[id] || useAppStore.getState().dataOperation) return false;
    const item = get().items[id]; if (!item || item.finishedAt) return false;
    const owner = epoch, controller = new AbortController(); controllers.set(id, controller);
    set(s => ({ busy: { ...s.busy, [id]: true }, checking: { ...s.checking, [id]: true }, errors: { ...s.errors, [id]: '' } }));
    try {
      if (!await get().flushDraft(id) || owner !== epoch || controller.signal.aborted) return false;
      const assessment = attempt.mode === 'steps' ? await assessSteps({ config: { ...useAppStore.getState().modelConfig },
        question: item.question, steps: attempt.steps, skeleton: await (await import('../core/skeleton/load.js')).loadSkeleton(), signal: controller.signal,
        learningContext: { goal: item.question.metadata?.learning?.goal, relation: item.question.metadata?.learning?.relation,
          revealedHints: (item.answer?.helpEvents ?? []).filter(event => event.kind === 'hint').map(event => ({ level: event.level, content: item.question.metadata?.learning?.hints?.[event.level - 1] })),
          solutionRevealed: Boolean(item.answer?.revealed), assisted: Boolean(item.answer?.assisted),
          previousAttempts: item.answer?.attemptHistory ?? [] } }) : undefined;
      if (owner !== epoch || controller.signal.aborted) return false;
      await database.gradePracticeItem(ref(item), id, { ...attempt, assessment });
      await get().load(id); return owner === epoch;
    } catch (error) { if (owner === epoch && error.name !== 'AbortError') set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '这次检查未完成，作答会保留，请重试。' } })); return false; }
    finally { if (owner === epoch) { controllers.delete(id); set(s => ({ busy: { ...s.busy, [id]: false }, checking: { ...s.checking, [id]: false } })); } }
  },
  mutate: async (id, method, ...args) => {
    const item = get().items[id]; if (!item || get().busy[id] || useAppStore.getState().dataOperation) return false;
    const owner = epoch;
    set(s => ({ busy: { ...s.busy, [id]: true }, errors: { ...s.errors, [id]: '' } }));
    try {
      if (method === 'finishChatPractice' && !await get().flushDraft(id)) return false;
      if (owner !== epoch) return false;
      await database[method](ref(item), id, ...args);
      await get().load(id); return owner === epoch;
    } catch (error) { if (owner === epoch) set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '这次操作尚未保存，请重试。' } })); return false; }
    finally { if (owner === epoch) set(s => ({ busy: { ...s.busy, [id]: false } })); }
  },
  reveal: (id, options) => get().mutate(id, 'revealPracticeItem', options),
  hint: (id, level) => get().mutate(id, 'recordPracticeHint', level),
  finish: id => get().mutate(id, 'finishChatPractice'),
  scheduleReview: (id, enabled) => get().mutate(id, 'setPracticeReview', enabled),
  dispute: id => get().mutate(id, 'disputePracticeItem'),
  openSource: async id => {
    const item = get().items[id]; if (!item || useAppStore.getState().dataOperation) return false;
    let original = item, source = item.source;
    const visited = new Set([id]);
    while (original.question.metadata?.learning?.provenance?.sourceItemId && visited.size <= 16) {
      const priorId = original.question.metadata.learning.provenance.sourceItemId;
      if (visited.has(priorId)) break;
      visited.add(priorId);
      try { original = await database.loadPracticeItem(priorId); }
      catch { break; }
      if (original.source?.conversationId && original.source.sourceMessageId) source = original.source;
    }
    if (!source?.conversationId || !source.sourceMessageId) return false;
    if (item.question.metadata?.learning?.reviewId && !item.finishedAt && !await get().reveal(id, { assisted: true })) return false;
    return useAppStore.getState().openQuestionSource({ sourceMessageId: source.sourceMessageId, sourceConversationId: source.conversationId });
  },
  // 停止检查要立刻生效：只 abort 不收拾状态的话，等信号的一方早就把界面留在「正在检查」。
  cancel: id => {
    controllers.get(id)?.abort(); controllers.delete(id);
    set(s => ({ busy: { ...s.busy, [id]: false }, checking: { ...s.checking, [id]: false } }));
  },
  cancelAll: () => { for (const id of [...controllers.keys()]) get().cancel(id); },
}));
useAppStore.subscribe((state, previous) => {
  if (state.learnerId !== previous.learnerId || state.dataRevision !== previous.dataRevision) {
    epoch++; controllers.forEach(c => c.abort()); controllers.clear();
    draftTimers.forEach(timer => clearTimeout(timer)); draftTimers.clear();
    savedDrafts.clear();
    useChatPracticeStore.setState({ items: {}, busy: {}, checking: {}, errors: {}, drafts: {} });
  } else if (state.dataOperation && !previous.dataOperation) {
    epoch++; controllers.forEach(c => c.abort()); controllers.clear();
    draftTimers.forEach(timer => clearTimeout(timer)); draftTimers.clear();
    useChatPracticeStore.setState({ busy: {}, checking: {} });
  } else if (state.modelConfig !== previous.modelConfig) controllers.forEach(c => c.abort());
  if (!state.dataOperation && (previous.dataOperation || state.currentConversationId !== previous.currentConversationId)) {
    useChatPracticeStore.getState().flushDrafts().catch(() => {});
  }
});
registerPracticeDraftFlush(() => useChatPracticeStore.getState().flushDrafts());
registerPracticeExitCancel(() => useChatPracticeStore.getState().cancelAll());
