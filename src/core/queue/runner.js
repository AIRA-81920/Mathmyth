import { validateModelConfig } from '../config/providers.js';
import { locateBlocks, locateEdges } from '../ai/locate.js';
import { AiRequestError, waitWithSignal } from '../ai/transport.js';
// 诊断埋点：只记录，不参与任何判断。整个 diagnostics.js 可以直接删除。
import { record, markQueueStart, markQueueDispose, markActivity, setQueueState, noteBreakdown,
  breakdownUsable, breakdownBusy } from './diagnostics.js';

// Network work runs independently of Ask. SQLite work stays in its own Worker.
export const LOCATION_JOB_TIMEOUT_MS = 45_000;

export function startQueue({ store, database, getSkeleton, blocks = locateBlocks, edges = locateEdges, pollDelay = 5000,
  jobTimeoutMs = LOCATION_JOB_TIMEOUT_MS,
  isForegroundBusy = () => false, subscribeForeground = () => () => {}, foregroundStores = () => ({}) }) {
  let stopped = false;
  let running = false;
  let timer;
  let controller;
  let session = 0;
  markQueueStart({ pollDelay, hasForegroundSignals: subscribeForeground !== undefined });

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
  // 只读拆解：把 usable/busy 的每一项摊开写进诊断事件，便于在手机上区分原因。
  const explain = () => {
    const state = store.getState();
    const usableDetail = breakdownUsable(state);
    const busyDetail = breakdownBusy({ ...foregroundStores(), signal: isForegroundBusy(),
      streamingCount: typeof state.streamingCount === 'number' ? state.streamingCount : null });
    noteBreakdown({ usable: usableDetail, busy: busyDetail });
    return { usable: usableDetail, busy: busyDetail };
  };
  function schedule(delay = 0) {
    if (stopped || timer || running) return;
    timer = setTimeout(() => { timer = undefined; setQueueState({ hasTimer: false }); pump(); }, delay);
    setQueueState({ hasTimer: true });
  }
  function invalidate() { session += 1; controller?.abort(); }

  async function pump() {
    markActivity();
    if (stopped) { record('pump:aborted', 'stopped=true'); return; }
    if (running) { record('pump:skipped', 'running=true'); return; }
    const detail = explain();
    record('pump:enter', 'usable=' + detail.usable.ok + ' busy=' + detail.busy.busy
      + ' | usable: ' + detail.usable.text + ' | busy: ' + detail.busy.text);
    if (!detail.usable.ok) { markActivity(); record('pump:not-usable', detail.usable.text); return; }
    if (foregroundBusy()) { record('pump:busy', detail.busy.text); schedule(pollDelay); return; }
    running = true;
    setQueueState({ running: true });
    const owner = session;
    const config = { ...store.getState().modelConfig };
    controller = new AbortController();
    let claim;
    let deadline;
    let completed = false;
    try {
      // E6：先取任务，确有任务时才加载骨架 JSON（25 个 chunk）。反过来会让
      // 冷启动就为"可能并没有的后台工作"付出加载代价。
      claim = await database.claimNextJob({ conversationId: store.getState().currentConversationId ?? null });
      record(claim ? 'pump:claimed' : 'pump:no-claim',
        claim ? 'jobId=' + claim.id + ' phase=' + claim.payload?.phase + ' attempts=' + claim.attempts : 'claimNextJob 返回 null');
      if (!claim) return;
      deadline = setTimeout(() => controller.abort(new AiRequestError('本题路径整理超时。', 'location_timeout')), jobTimeoutMs);
      const skeleton = await waitWithSignal(getSkeleton(), controller.signal);
      if (stopped || owner !== session || !usable()) throw new DOMException('Aborted', 'AbortError');
      if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // D7：后台分类只吃文本。图片题的用户消息正文已含转写题面，不再加载原图。
      let blockIds = claim.payload.blockIds;
      if (claim.payload.phase !== 'edges') {
        const location = await waitWithSignal(blocks({ config, source: claim.payload.source, skeleton, signal: controller.signal }), controller.signal);
        blockIds = Array.isArray(location) ? location : location.blockIds;
        if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await database.checkpointJob(claim, blockIds, Array.isArray(location) ? undefined : location);
        record('pump:checkpoint', 'jobId=' + claim.id + ' blockIds=' + JSON.stringify(blockIds));
      }
      if (foregroundBusy()) throw new DOMException('Aborted', 'AbortError');
      const entries = claim.payload.classificationOnly ? [] : await waitWithSignal(edges({ config, source: claim.payload.source, skeleton, blockIds, signal: controller.signal }), controller.signal);
      if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // Do not time out a local commit after its transaction has started.
      clearTimeout(deadline);
      await database.completeJob(claim, entries);
      completed = true;
      record('pump:completed', 'jobId=' + claim.id + ' entries=' + (Array.isArray(entries) ? entries.length : 'routes'));
    } catch (error) {
      if (controller.signal.reason?.code === 'location_timeout') error = controller.signal.reason;
      if (error?.location) record('pump:validation', { jobId: claim?.id, ...error.location });
      record(error?.name === 'AbortError' ? 'pump:aborted' : 'pump:failed',
        (claim ? 'jobId=' + claim.id + ' ' : '') + (error?.name || 'Error') + ': ' + (error?.message ?? String(error))
        + '\n' + String(error?.stack ?? '').slice(0, 300));
      if (claim) {
        try { await database.failJob(claim, { cancelled: error?.name === 'AbortError' }); }
        catch { /* Replaced databases reject the old epoch/lease without writing. */ }
      }
    } finally {
      clearTimeout(deadline);
      running = false;
      controller = undefined;
      setQueueState({ running: false, lastExit: claim ? 'claimed' : 'idle' });
      markActivity();
      schedule(completed ? 0 : pollDelay);
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
    record('queue:stop', 'stop() 进入 stopped=true');
    if (timer) clearTimeout(timer);
    setQueueState({ hasTimer: false, running: false });
    invalidate();
    unsubscribeStore();
    unsubscribeDb();
    unsubscribeForeground();
    markQueueDispose();
  };
}
