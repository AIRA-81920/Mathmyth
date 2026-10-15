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
  const foregroundBusy = () => isForegroundBusy() || store.getState().conversations.some((conversation) => conversation.messages.some((message) => !message.superseded && message.status === 'streaming'));
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
      const skeleton = await getSkeleton();
      if (stopped || owner !== session || !usable()) return;
      claim = await database.claimNextJob();
      if (!claim) return;
      if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const image = claim.payload.source.imageId && config.supportsImage
        ? await database.loadImage(claim.payload.source.imageId) : undefined;
      if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let blockIds = claim.payload.blockIds;
      if (claim.payload.phase !== 'edges') {
        const location = await blocks({ config, source: claim.payload.source, image, skeleton, signal: controller.signal });
        blockIds = Array.isArray(location) ? location : location.blockIds;
        if (owner !== session || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        await database.checkpointJob(claim, blockIds, Array.isArray(location) ? undefined : location);
      }
      if (foregroundBusy()) throw new DOMException('Aborted', 'AbortError');
      const entries = claim.payload.classificationOnly ? [] : await edges({ config, source: claim.payload.source, image, skeleton, blockIds, signal: controller.signal });
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
      || !state.onboarded) invalidate();
    const wasBusy = previous.conversations.some((conversation) => conversation.messages.some((message) => !message.superseded && message.status === 'streaming'));
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
