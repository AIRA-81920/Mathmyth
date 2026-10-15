import { create } from 'zustand';
import { useAppStore } from './appStore.js';
import * as database from '../core/db/database.js';
import { loadSkeleton } from '../core/skeleton/load.js';
import { assessSteps } from '../core/ai/practice.js';

let epoch = 0;
const controllers = new Map();
export const useChatPracticeStore = create((set, get) => ({
  items: {}, busy: {}, errors: {},
  load: async id => {
    const owner = epoch;
    try { const item = await database.loadPracticeItem(id); if (owner === epoch) set(s => ({ items: { ...s.items, [id]: item }, errors: { ...s.errors, [id]: '' } })); }
    catch (error) { if (owner === epoch) set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '这道练习暂时无法读取。' } })); }
  },
  submit: async (id, attempt) => {
    if (get().busy[id] || useAppStore.getState().dataOperation) return false;
    const item = get().items[id]; if (!item || item.finishedAt) return false;
    const owner = epoch, controller = new AbortController(); controllers.set(id, controller);
    set(s => ({ busy: { ...s.busy, [id]: true }, errors: { ...s.errors, [id]: '' } }));
    try {
      const assessment = attempt.mode === 'steps' ? await assessSteps({ config: { ...useAppStore.getState().modelConfig },
        question: item.question, steps: attempt.steps, skeleton: await loadSkeleton(), signal: controller.signal }) : undefined;
      if (owner !== epoch || controller.signal.aborted) return false;
      await database.gradePracticeItem({ id: item.runId, generation: item.generation }, id, { ...attempt, assessment });
      await get().load(id); return owner === epoch;
    } catch (error) { if (owner === epoch && error.name !== 'AbortError') set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '这次作答未能保存，请重试。' } })); return false; }
    finally { if (owner === epoch) { controllers.delete(id); set(s => ({ busy: { ...s.busy, [id]: false } })); } }
  },
  reveal: async id => {
    const item = get().items[id]; if (!item || get().busy[id] || useAppStore.getState().dataOperation) return false;
    const owner = epoch;
    try { await database.revealPracticeItem({ id: item.runId, generation: item.generation }, id); await get().load(id); return owner === epoch; }
    catch (error) { if (owner === epoch) set(s => ({ errors: { ...s.errors, [id]: error.userMessage || '答案暂时无法读取。' } })); return false; }
  },
  cancel: id => { controllers.get(id)?.abort(); },
}));
useAppStore.subscribe((state, previous) => {
  if (state.learnerId !== previous.learnerId || (state.dataOperation && !previous.dataOperation)) {
    epoch++; controllers.forEach(c => c.abort()); controllers.clear(); useChatPracticeStore.setState({ items: {}, busy: {}, errors: {} });
  } else if (state.modelConfig !== previous.modelConfig) controllers.forEach(c => c.abort());
});
