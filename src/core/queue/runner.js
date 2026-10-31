import { validateModelConfig } from '../config/providers.js';
import { locateBlocks, locateEdges } from '../ai/locate.js';

// Network work runs independently of Ask. SQLite work stays in its own Worker.
export function startQueue({ store, database, getSkeleton, blocks = locateBlocks, edges = locateEdges, pollDelay = 5000,
  isForegroundBusy = () => false, subscribeForeground = () => () => {} }) {
  let stopped = false;
  let running = false;
  let timer;
  let controller;
  let session = 0;

  const usable = () => {
    const state = store.getState();
    return state.storageInitialized && state.onboarded && !state.dataOperation && state.route !== 'settings'
      && state.storageStatus !== 'error' && validateModelConfig(state.modelConfig).valid;
  };
  // D12：优先读 store 上 O(1) 的 streamingCount，取代"遍历所有会话的所有消息"。
  // 只有完全没有这个字段的旧/测试 store 才退回遍历，保证既有行为不丢。
  const storeStreaming = (state) => (typeof state.streamingCount === 'number'
    ? state.streamingCount > 0
    : state.conversations.some((conversation) => conversation.messages.some((message) => !message.superseded && message.status === 'streaming')));
  const foregroundBusy = () => isForegroundBusy() || storeStreaming(store.getState());
  function schedule(delay = 0) {
    if (stopped || timer || running) return;
    timer = setTimeout(() => { timer = undefined; pump(); }, delay);
  }
  function invalidate() { session += 1; controller?.abort(); }

  async function pump() {
    if (stopped || running || !usable()) return;
    if (foregroundBusy()) { schedule(pollDelay); return; }
    running = true;
    const owner = session;
    const config = { ...store.getState().modelConfig };
    controller = new AbortController();
    let claim;
    try {
      // E6：先取任务，确有任务时才加载骨架 JSON（25 个 chunk）。反过来会让
      // 冷启动就为"可能并没有的后台工作"付出加载代价。
      claim = await database.claimNextJob();
      if (!claim) return;
      const skeleton = await getSkeleton();
      if (stopped || owner !== session || !usable()) throw new DOMException('Aborted', 'AbortError');
      if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // D7：后台分类只吃文本。图片题的用户消息正文已含转写题面，不再加载原图。
      let blockIds = claim.payload.blockIds;
      if (claim.payload.phase !== 'edges') {
        const location = await blocks({ config, source: claim.payload.source, skeleton, signal: controller.signal });
        blockIds = Array.isArray(location) ? location : location.blockIds;
        if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await database.checkpointJob(claim, blockIds, Array.isArray(location) ? undefined : location);
      }
      if (foregroundBusy()) throw new DOMException('Aborted', 'AbortError');
      const entries = claim.payload.classificationOnly ? [] : await edges({ config, source: claim.payload.source, skeleton, blockIds, signal: controller.signal });
      if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await database.completeJob(claim, entries);
    } catch (error) {
      if (claim) {
        try { await database.failJob(claim, { cancelled: error?.name === 'AbortError' }); }
        catch { /* Replaced databases reject the old epoch/lease without writing. */ }
      }
    } finally {
      running = false;
      controller = undefined;
      schedule(pollDelay);
    }
  }

  const unsubscribeStore = store.subscribe((state, previous) => {
    if ((state.dataOperation && !previous.dataOperation)
      || state.learnerId !== previous.learnerId || state.modelConfig !== previous.modelConfig
      // 学科切换后正在跑的后台归位任务必须放弃：它拿到的是上一学科的骨架 ID。
      || state.subjectEpoch !== previous.subjectEpoch
      || !state.onboarded) invalidate();
    const wasBusy = storeStreaming(previous);
    if (!wasBusy && foregroundBusy()) invalidate();
    if (usable()) schedule();
  });
  const unsubscribeDb = database.onDatabaseChange((event) => {
    if (event.method === 'clearDatabase' || event.method === 'commitImport') invalidate();
    if (usable()) schedule();
  });
  const unsubscribeForeground = subscribeForeground(() => { if (foregroundBusy() && running) invalidate(); else if (usable()) schedule(); });
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    invalidate();
    unsubscribeStore();
    unsubscribeDb();
    unsubscribeForeground();
  };
}
