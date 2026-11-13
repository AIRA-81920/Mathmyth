import { createDefaultModelConfig, validateModelConfig } from '../core/config/providers.js';
import { preservesReasoning } from '../core/ai/answerThinking.js';
import { normalizePreferences } from '../core/config/preferences.js';

function storageFailure(error) {
  const safe = new Error(error?.userMessage || '本地数据暂时未能读写。当前内容仍保留，请重试。');
  safe.userMessage = safe.message;
  return safe;
}

// The database is injected so tests do not create a browser Worker or IndexedDB.
// D9：脏数据下沉到"消息级"。dirty 的值结构为
//   { conversation, ids: Set<messageId>, fallback: boolean }
// fallback=true 表示这条会话必须走旧的"全量重写"路径（消息顺序被改变或消息被
// 移出会话）——极少见，保留它只为不牺牲正确性。
export function attachPersistence(store, database, { flushDelay = 80, streamingFlushDelay = 2000, abortRequests = () => {}, beforeFlush = () => {}, eventTarget = globalThis.window, visibilityTarget = globalThis.document } = {}) {
  const dirty = new Map();
  const loads = new Map();
  let settings = null;
  let muted = false;
  let replacing = false;
  let generation = 0;
  let timer;
  let timerDelay = 0;
  let timerUrgent = false;
  let scrollTimer;
  let scrollDirty = false;
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
    clearTimeout(scrollTimer); scrollTimer = undefined; scrollDirty = false;
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
        questionFocus: null, trailFocus: null,
        onboarded: Boolean(bootstrap.onboarded),
        learnerId: bootstrap.learnerId ?? null,
        dataRevision: (store.getState().dataRevision ?? 0) + 1,
        chatDrafts: {},
        conversations: bootstrap.conversations ?? [],
        currentConversationId: null,
        conversationLoading: false,
        drawerOpen: false,
        activeArea: 'ask',
        route: bootstrap.onboarded ? 'main' : 'onboarding',
        storageInitialized: true,
        storageStatus: 'ready',
        storageError: '',
        exitError: '',
        dataOperation: null,
      });
      if (bootstrap.onboarded) store.getState().newConversation();
    });
  }

  // D9 提交节流：流式中间态最多每 streamingFlushDelay（默认 2s）落盘一次；
  // "结构变化"（新消息/新会话）必须尽快落盘（沿用 flushDelay），保证刚发出的
  // 题目不会因为节流而丢失；回答完成/停止/出错时 streamingCount 归零，下一次
  // schedule 立刻回到 flushDelay，等价于必落盘。
  const delayFor = (urgent) => (urgent || !(store.getState().streamingCount > 0)
    ? flushDelay
    : Math.max(flushDelay, streamingFlushDelay));

  function schedule({ urgent = false } = {}) {
    if (replacing || disposed || !store.getState().storageInitialized || store.getState().storageStatus === 'error') return;
    const delay = delayFor(urgent);
    if (timer) {
      // 已排在更早的时间点，或本次并不更紧急：保持原计划。
      if (timerUrgent || !urgent || timerDelay <= delay) return;
      clearTimeout(timer);
    }
    timerUrgent = urgent;
    timerDelay = delay;
    timer = setTimeout(() => {
      timer = undefined;
      timerUrgent = false;
      timerDelay = 0;
      flush().catch(() => {});
    }, delay);
  }

  function stageScroll() {
    clearTimeout(scrollTimer); scrollTimer = undefined;
    if (!scrollDirty) return false;
    scrollDirty = false;
    const state = store.getState();
    settings = { modelConfig: state.modelConfig, onboarded: state.onboarded, preferences: state.preferences };
    return true;
  }

  // 累积脏数据：ids 为本次需要写入的消息 id，conversation 始终取最新对象。
  function markDirty(conversation, ids, fallback = false) {
    const entry = dirty.get(conversation.id);
    dirty.set(conversation.id, {
      conversation,
      ids: entry ? new Set([...entry.ids, ...ids]) : new Set(ids),
      fallback: Boolean(fallback || entry?.fallback),
    });
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (muted || disposed || !state.storageInitialized) return;
    let changed = false, urgent = false;
    const scrollOnly = state.preferences !== previous.preferences
      && state.preferences.trailScroll !== previous.preferences.trailScroll
      && Object.keys(state.preferences).every(key => key === 'trailScroll' || state.preferences[key] === previous.preferences[key]);
    if (scrollOnly) {
      // 只滚足迹不写库：浏览期间不再每停手 500ms 导出整库。
      // 最终位置在离开足迹页、切到后台、关闭应用或任何一次真实 flush 时一起落盘。
      scrollDirty = true;
      clearTimeout(scrollTimer);
      scrollTimer = undefined;
    }
    if (state.modelConfig !== previous.modelConfig || state.onboarded !== previous.onboarded || (state.preferences !== previous.preferences && !scrollOnly)) {
      stageScroll();
      settings = { modelConfig: state.modelConfig, onboarded: state.onboarded, preferences: state.preferences };
      changed = true;
    }
    if (scrollDirty && (state.activeArea !== previous.activeArea || state.route !== previous.route)) {
      changed = stageScroll() || changed;
      urgent = true;
    }
    if (state.conversations !== previous.conversations) {
      const previousById = new Map(previous.conversations.map((conversation) => [conversation.id, conversation]));
      for (const conversation of state.conversations) {
        if (conversation.loaded === false) continue;
        // 内存态会话（方法讨论）：从不落库。它转成普通会话的那一次，由
        // saveConversation 整条写一次，不走这里的增量。
        if (conversation.ephemeral) continue;
        const before = previousById.get(conversation.id);
        if (before === conversation) continue;
        const messages = conversation.messages ?? [];
        if (!before) {
          // 首次出现的会话：全量写入；空会话（刚新建）保留旧的"不落盘"行为。
          markDirty(conversation, messages.map((message) => message.id), messages.length === 0);
          changed = true; urgent = true;
          continue;
        }
        const previousMessages = before.messages ?? [];
        const previousIndex = new Map(previousMessages.map((message, index) => [message.id, index]));
        const ids = [];
        // 顺序变化或消息被移出时必须退回全量重写，避免 seq 冲突或漏删。
        let fallback = previousMessages.length > messages.length;
        messages.forEach((message, index) => {
          const at = previousIndex.get(message.id);
          if (at === undefined) { ids.push(message.id); urgent = true; return; }
          if (at !== index) fallback = true;
          else if (previousMessages[at] !== message) ids.push(message.id);
        });
        markDirty(conversation, ids, fallback);
        changed = true;
      }
    }
    if (changed && (dirty.size || settings)) schedule({ urgent });
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

  // 把脏数据翻译成保存载荷：非 fallback 时只带脏消息，每条消息用 seq 标明它在
  // 会话消息数组里的下标，让引擎逐条 upsert 而不必整会话重写。
  function savePayload(entry) {
    if (entry.fallback) return entry.conversation;
    // 思考文本按用途存：Kimi 系多轮必需，未完成的回答（可续写）保留，
    // 其余的完成即丢 —— 其它厂商不接受回传，留着只是白白占库和备份。
    const keepReasoning = preservesReasoning(store.getState().modelConfig);
    const messages = (entry.conversation.messages ?? [])
      .map((message, index) => (entry.ids.has(message.id)
        ? { ...message, ...(keepReasoning || message.status !== 'complete' ? {} : { reasoningContent: null }), seq: index }
        : null))
      .filter(Boolean);
    return { ...entry.conversation, incremental: true, messages };
  }

  function flush({ allowDisposed = false } = {}) {
    beforeFlush();
    stageScroll();
    if (timer) clearTimeout(timer);
    timer = undefined;
    timerUrgent = false;
    timerDelay = 0;
    return enqueue(async () => {
      if (!store.getState().storageInitialized || (disposed && !allowDisposed)) return;
      if (!dirty.size && !settings) return;
      const batch = new Map(dirty);
      const savedSettings = settings;
      dirty.clear();
      settings = null;
      store.setState({ storageStatus: 'saving', storageError: '' });
      try {
        await database.saveChanges({
          ...(savedSettings ?? {}),
          ...(batch.size ? { conversations: [...batch.values()].map(savePayload) } : {}),
        });
        store.setState({ storageStatus: 'ready', storageError: '' });
      } catch (error) {
        for (const [id, entry] of batch) {
          const latest = dirty.get(id);
          dirty.set(id, latest ? { ...latest, ids: new Set([...entry.ids, ...latest.ids]), fallback: entry.fallback || latest.fallback } : entry);
        }
        if (!settings) settings = savedSettings;
        throw reportError(error);
      }
      if (dirty.size || settings) schedule();
    });
  }

  // 内存里的会话上限：最多保留 4 个已加载会话（含刚打开的这个）。
  // 只回收"干净"的普通会话——没有待保存改动、没有流式回答、不是方法讨论。
  // 被回收的会话只留摘要，重新点开时会走原来的 loaded:false 读取路径。
  const MAX_LOADED_CONVERSATIONS = 4;
  function evictLoadedConversations(keepId) {
    const state = store.getState();
    const candidates = state.conversations.filter((entry) => entry.id !== keepId
      && entry.loaded !== false && !entry.ephemeral && !entry.methodId
      && !dirty.has(entry.id)
      && !(entry.messages ?? []).some((message) => message.status === 'streaming'));
    const keepOthers = MAX_LOADED_CONVERSATIONS - 1;
    const excess = candidates.length - keepOthers;
    if (excess <= 0) return;
    const doomed = new Set(candidates
      .slice()
      .sort((a, b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? '')))
      .slice(0, excess)
      .map((entry) => entry.id));
    silence(() => store.setState((current) => ({ conversations: current.conversations.map((entry) => doomed.has(entry.id) ? {
      ...entry,
      messages: [],
      revisionPaths: {},
      revisionViewOnly: false,
      loaded: false,
      // 历史列表在 loaded:false 时用 messageCount 判断"有没有内容"，必须保留。
      messageCount: entry.messageCount ?? (entry.messages ?? []).filter((message) => !message.superseded).length,
    } : entry) })));
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
        if (fence !== generation || disposed || !store.getState().conversations.some((entry) => entry.id === id)) {
          // 会话在读取途中被删除/替换时不能留着"正在读取"：它是输入框的 block 条件，
          // 一旦留真，这个会话的输入框和 ＋ 会永久失效，而且界面没有任何提示。
          if (store.getState().currentConversationId === id) store.setState({ conversationLoading: false });
          return null;
        }
        silence(() => store.setState((state) => ({
          conversations: state.conversations.map((entry) => entry.id === id && entry.loaded === false ? { ...conversation, title: entry.title, titleStatus: entry.titleStatus ?? conversation.titleStatus, pinned: entry.pinned, loaded: true } : entry),
          ...(state.currentConversationId === id ? { conversationLoading: false } : {}),
        })));
        evictLoadedConversations(id);
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
    // 讨论转正：这条会话在订阅里一直被跳过，所以必须整条写一次（含全部消息）。
    saveConversation: async (id) => {
      try {
        await flush();
        const conversation = store.getState().conversations.find((entry) => entry.id === id);
        if (!conversation) return;
        await enqueue(() => database.saveChanges({ conversations: [{ ...conversation, messages: conversation.messages ?? [] }] }));
        store.setState({ storageStatus: 'ready', storageError: '' });
      } catch (error) { throw reportError(error); }
    },
    updateConversation: async (id, patch) => {
      try {
        await flush();
        await enqueue(() => database.updateConversation(id, patch));
        silence(() => store.setState((state) => ({ conversations: state.conversations.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) })));
        // 会话被静默替换过，脏条目必须指向最新的对象（并保持原有的脏消息集合）。
        const entry = dirty.get(id), latest = store.getState().conversations.find((item) => item.id === id);
        if (entry && latest) markDirty(latest, entry.ids, entry.fallback);
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
    // 导入的是“数据”，不是这台设备的模型配置：本机已经填好就原样保留；
    // 只有本机还没有配置（全新安装、或刚清空过）时才采用备份里的那一份。
    confirmImport: (token) => replace('importing', async () => {
      const local = store.getState().modelConfig;
      const imported = await database.commitImport(token, validateModelConfig(local).valid ? { modelConfig: local } : {});
      return validateModelConfig(local).valid ? { ...imported, modelConfig: local } : imported;
    }),
    cancelImport: (token) => enqueue(() => database.cancelImport(token)),
    clearAllData: () => replace('clearing', () => database.clearDatabase()),
    dispose: () => {
      if (disposed) return;
      if (stageScroll()) flush({ allowDisposed: true }).catch(() => {});
      disposed = true;
      clearTimeout(scrollTimer);
      generation += 1;
      loads.clear();
      if (timer) clearTimeout(timer);
      unsubscribe();
      eventTarget?.removeEventListener?.('pagehide', bestEffortFlush);
      visibilityTarget?.removeEventListener?.('visibilitychange', visibilityChange);
    },
  };
}
