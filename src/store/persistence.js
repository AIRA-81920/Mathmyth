import { createDefaultModelConfig } from '../core/config/providers.js';
import { normalizePreferences } from '../core/config/preferences.js';

function storageFailure(error) {
  const safe = new Error(error?.userMessage || '本地数据暂时未能读写。当前内容仍保留，请重试。');
  safe.userMessage = safe.message;
  return safe;
}

// The database is injected so tests do not create a browser Worker or IndexedDB.
export function attachPersistence(store, database, { flushDelay = 80, abortRequests = () => {}, eventTarget = globalThis.window, visibilityTarget = globalThis.document } = {}) {
  const dirty = new Map();
  const loads = new Map();
  let settings = null;
  let muted = false;
  let replacing = false;
  let generation = 0;
  let timer;
  let initialization;
  let queue = Promise.resolve();
  let disposed = false;

  const enqueue = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  const silence = (operation) => {
    muted = true;
    try { return operation(); } finally { muted = false; }
  };
  const reportError = (error) => {
    const safe = storageFailure(error);
    store.setState({ storageStatus: 'error', storageError: safe.message });
    return safe;
  };

  function applyBootstrap(bootstrap) {
    generation += 1;
    loads.clear();
    dirty.clear();
    settings = null;
    silence(() => {
      store.setState({
        modelConfig: bootstrap.modelConfig ?? createDefaultModelConfig(),
        preferences: normalizePreferences(bootstrap.preferences),
        methodChatOpen: false, methodConversationId: null, methodId: null,
        scenarioRef: null, knowledgeBack: [],
        onboarded: Boolean(bootstrap.onboarded),
        learnerId: bootstrap.learnerId ?? null,
        conversations: bootstrap.conversations ?? [],
        currentConversationId: null,
        conversationLoading: false,
        drawerOpen: false,
        activeArea: 'ask',
        route: bootstrap.onboarded ? 'main' : 'onboarding',
        storageInitialized: true,
        storageStatus: 'ready',
        storageError: '',
        dataOperation: null,
      });
      if (bootstrap.onboarded) store.getState().newConversation();
    });
  }

  function schedule() {
    if (timer || replacing || disposed || !store.getState().storageInitialized || store.getState().storageStatus === 'error') return;
    timer = setTimeout(() => {
      timer = undefined;
      flush().catch(() => {});
    }, flushDelay);
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (muted || disposed || !state.storageInitialized) return;
    let changed = false;
    if (state.modelConfig !== previous.modelConfig || state.onboarded !== previous.onboarded || state.preferences !== previous.preferences) {
      settings = { modelConfig: state.modelConfig, onboarded: state.onboarded, preferences: state.preferences };
      changed = true;
    }
    if (state.conversations !== previous.conversations) {
      const previousById = new Map(previous.conversations.map((conversation) => [conversation.id, conversation]));
      for (const conversation of state.conversations) {
        if (conversation.loaded !== false && previousById.get(conversation.id) !== conversation) {
          dirty.set(conversation.id, conversation);
          changed = true;
        }
      }
    }
    if (changed && (dirty.size || settings)) schedule();
  });

  function initialize() {
    if (store.getState().storageInitialized) return Promise.resolve();
    if (initialization) return initialization;
    store.setState({ storageStatus: 'loading', storageError: '' });
    initialization = enqueue(async () => {
      try {
        const bootstrap = await database.initializeDatabase();
        if (!disposed) applyBootstrap(bootstrap);
        return bootstrap;
      } catch (error) { throw reportError(error); }
    }).finally(() => { initialization = null; });
    return initialization;
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    return enqueue(async () => {
      if (!store.getState().storageInitialized || disposed) return;
      if (!dirty.size && !settings) return;
      const batch = new Map(dirty);
      const savedSettings = settings;
      dirty.clear();
      settings = null;
      store.setState({ storageStatus: 'saving', storageError: '' });
      try {
        await database.saveChanges({
          ...(savedSettings ?? {}),
          ...(batch.size ? { conversations: [...batch.values()] } : {}),
        });
        store.setState({ storageStatus: 'ready', storageError: '' });
      } catch (error) {
        for (const [id, conversation] of batch) if (!dirty.has(id)) dirty.set(id, conversation);
        if (!settings) settings = savedSettings;
        throw reportError(error);
      }
      if (dirty.size || settings) schedule();
    });
  }

  function loadConversation(id) {
    const selected = store.getState().conversations.find((conversation) => conversation.id === id);
    if (!selected || selected.loaded !== false) return Promise.resolve(selected);
    if (loads.has(id)) return loads.get(id);
    const fence = generation;
    if (store.getState().currentConversationId === id) store.setState({ conversationLoading: true });
    const result = (async () => {
      try {
        const conversation = await database.loadConversation(id);
        if (fence !== generation || disposed || !store.getState().conversations.some((entry) => entry.id === id)) return null;
        silence(() => store.setState((state) => ({
          conversations: state.conversations.map((entry) => entry.id === id && entry.loaded === false ? { ...conversation, title: entry.title, titleStatus: entry.titleStatus ?? conversation.titleStatus, pinned: entry.pinned, loaded: true } : entry),
          ...(state.currentConversationId === id ? { conversationLoading: false } : {}),
        })));
        return conversation;
      } catch (error) {
        if (fence !== generation || disposed) return null;
        if (store.getState().currentConversationId === id) store.setState({ conversationLoading: false });
        throw reportError(error);
      }
    })().finally(() => { if (loads.get(id) === result) loads.delete(id); });
    loads.set(id, result);
    return result;
  }

  async function replace(kind, operation) {
    if (replacing || store.getState().storageStatus === 'loading') throw storageFailure();
    replacing = true;
    store.setState({ dataOperation: kind });
    try {
      abortRequests();
      try { await flush(); }
      catch {
        // Confirmed replacement can recover from quota, corruption or stale-tab
        // writes. A failed batch stays pending if the atomic replacement fails.
      }
      generation += 1;
      loads.clear();
      const bootstrap = await enqueue(operation);
      applyBootstrap(bootstrap);
      return bootstrap;
    } catch (error) { throw reportError(error); }
    finally {
      replacing = false;
      store.setState({ dataOperation: null });
      if (dirty.size || settings) schedule();
    }
  }

  const bestEffortFlush = () => { flush().catch(() => {}); };
  const visibilityChange = () => { if (visibilityTarget?.visibilityState === 'hidden') bestEffortFlush(); };
  eventTarget?.addEventListener?.('pagehide', bestEffortFlush);
  visibilityTarget?.addEventListener?.('visibilitychange', visibilityChange);

  return {
    initialize,
    retry: async () => {
      if (!store.getState().storageInitialized) return initialize();
      await flush();
      store.setState({ storageStatus: 'ready', storageError: '' });
      const state = store.getState();
      if (state.conversations.some((entry) => entry.id === state.currentConversationId && entry.loaded === false)) {
        return loadConversation(state.currentConversationId);
      }
    },
    flush,
    loadConversation,
    updateConversation: async (id, patch) => {
      try {
        await flush();
        await enqueue(() => database.updateConversation(id, patch));
        silence(() => store.setState((state) => ({ conversations: state.conversations.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) })));
        if (dirty.has(id)) dirty.set(id, store.getState().conversations.find((entry) => entry.id === id));
      } catch (error) { throw reportError(error); }
    },
    deleteConversation: async (id, includeLearning) => {
      if (replacing) throw storageFailure();
      replacing = true;
      store.setState({ dataOperation: 'deleting' });
      try {
        abortRequests(id);
        await flush();
        await enqueue(() => database.deleteConversation(id, includeLearning));
        dirty.delete(id); loads.delete(id);
        silence(() => {
          store.setState((state) => ({ conversations: state.conversations.filter((entry) => entry.id !== id) }));
          if (store.getState().currentConversationId === id) { store.setState({ dataOperation: null }); store.getState().newConversation(); }
        });
      } catch (error) { throw reportError(error); }
      finally { replacing = false; store.setState({ dataOperation: null }); if (dirty.size || settings) schedule(); }
    },
    exportData: async () => {
      try { await flush(); return await enqueue(() => database.exportDatabase()); }
      catch (error) { throw reportError(error); }
    },
    prepareImport: async (bytes) => {
      try { return await enqueue(() => database.prepareImport(bytes)); }
      catch (error) { throw storageFailure(error); }
    },
    confirmImport: (token) => replace('importing', () => database.commitImport(token)),
    cancelImport: (token) => enqueue(() => database.cancelImport(token)),
    clearAllData: () => replace('clearing', () => database.clearDatabase()),
    dispose: () => {
      disposed = true;
      generation += 1;
      loads.clear();
      if (timer) clearTimeout(timer);
      unsubscribe();
      eventTarget?.removeEventListener?.('pagehide', bestEffortFlush);
      visibilityTarget?.removeEventListener?.('visibilitychange', visibilityChange);
    },
  };
}
