import { create } from 'zustand';
import { createDefaultModelConfig, providers, validateModelConfig } from '../core/config/providers.js';
import { streamAnswer } from '../core/ai/client.js';
import { attachPersistence } from './persistence.js';
import { ASK_SYSTEM_PROMPT } from '../core/ai/prompts.js';
import { answerRequest } from '../core/ai/answerThinking.js';
import { routeTrailLocation } from '../core/skeleton/trailLocation.js';
import { routeScenarioIds } from '../core/chat/questionRoutes.js';
import { IMAGE_TRANSCRIPT_INSTRUCTION, splitImageTranscript } from '../core/ai/imageTranscript.js';
import { generateTitle } from '../core/ai/title.js';
import { normalizePreferences } from '../core/config/preferences.js';
import { methodDiscussionPrompt } from '../core/ai/methodContext.js';
import { branchBefore, visibleMessages, captureRevisionPaths, selectRevision } from '../core/chat/revisions.js';
import { normalizeLightTemperature } from '../core/ui/lightTemperature.js';
import { wantsChatPractice, chatRouteLetters, parseChatRouteAnswer } from '../core/chat/practiceIntent.js';

let nextId = 0;
const activeRequests = new Map();
const titleRequests = new Map();
let persistence = null;
let bootPromise = null;

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++nextId}`}`;
}

function createConversation(methodId = null) {
  const now = new Date().toISOString();
  return {
    id: makeId('conversation'),
    title: '新对话',
    titleStatus: 'pending',
    methodId,
    createdAt: now,
    updatedAt: now,
    messages: [],
    loaded: true,
  };
}

function newConversationState(conversations) {
  const conversation = createConversation();
  return {
    route: 'main',
    activeArea: 'ask',
    drawerOpen: false,
    conversations: [conversation, ...conversations],
    currentConversationId: conversation.id,
    conversationLoading: false,
    methodChatOpen: false,
    methodConversationId: null,
    methodId: null,
    scenarioRef: null,
    knowledgeBack: [],
  };
}

function answerError(error) {
  // The transport supplies messages safe to show. Never surface raw provider
  // payloads here, since those may echo credentials or request details.
  return error?.userMessage || '暂时没能取得回答。请检查网络和模型设置后再试。';
}

function validImage(image) {
  return Boolean(image && typeof image.dataUrl === 'string' && image.dataUrl.trim());
}

function resetTrail(state) {
  return { preferences: { ...state.preferences, trailExpanded: {}, trailScroll: 0 }, trailEpoch: state.trailEpoch + 1 };
}

async function requestConversationTitle(id) {
  const state = useAppStore.getState();
  // Memory-only M1 harnesses deliberately perform only the foreground request.
  if (!state.storageInitialized || state.dataOperation || titleRequests.has(id)) return;
  const conversation = state.conversations.find((entry) => entry.id === id);
  if (!conversation || conversation.loaded === false || conversation.titleStatus !== 'pending') return;
  const first = conversation.messages.find((message) => message.role === 'user' && !message.superseded);
  const question = [first?.content, ...(first?.attachments ?? []).filter((item) => item.kind === 'document').map((item) => item.text)].filter(Boolean).join('\n\n');
  const image = !question.trim() && state.modelConfig.supportsImage ? first?.image : undefined;
  if (!question.trim() && !image) return;
  const controller = new AbortController(); titleRequests.set(id, controller);
  const update = (patch) => {
    if (titleRequests.get(id) !== controller || controller.signal.aborted) return;
    useAppStore.setState((current) => ({ conversations: current.conversations.map((entry) => entry.id === id && entry.titleStatus === 'pending' ? { ...entry, ...patch } : entry) }));
  };
  try { update({ title: await generateTitle({ config: { ...state.modelConfig }, question, image, signal: controller.signal }), titleStatus: 'auto' }); }
  catch { update({ titleStatus: 'failed' }); }
  finally { if (titleRequests.get(id) === controller) titleRequests.delete(id); }
}

function buildModelMessages(history, config) {
  let preserveThinking = false;
  try { preserveThinking = /^(?:api\.moonshot\.(?:cn|ai)|tokendance\.space)$/.test(new URL(config.apiBase).hostname) && /^kimi-k(?:3|2\.7)/i.test(config.model); } catch { /* Config validation reports the error. */ }
  return history.filter((entry) => (
    ['user', 'assistant'].includes(entry.role)
    && !entry.superseded
    && entry.status !== 'error'
    && entry.status !== 'streaming'
    && (String(entry.content ?? '').trim() || entry.attachments?.length || (entry.role === 'user' && validImage(entry.image)))
  )).map((entry) => {
    const target = entry.role === 'user' && entry.recheckOf
      ? history.find((answer) => answer.id === entry.recheckOf && answer.role === 'assistant')
      : null;
    let content = target
      ? `${entry.content}\n\n需要核查的回答：\n\n${target.content}`
      : entry.content;
    const documents = (entry.attachments ?? []).filter((attachment) => attachment.kind === 'document');
    if (documents.length) content = `${content || '请解答附件中的题目。'}\n\n${documents.map((document) => `附件《${document.name}》的本地提取内容：\n${document.text || '扫描页或图形见图片。'}`).join('\n\n')}`;
    if (!String(content ?? '').trim()) content = config.supportsImage ? '请解答图片中的题目。' : '之前发送了一张题目图片。';
    const images = (entry.attachments ?? (entry.image ? [entry.image] : [])).filter((attachment) => validImage(attachment));
    if (entry.role === 'user' && config.supportsImage && images.length) {
      if (entry.imageCorrected) {
        content = `请以用户修正的题面为准：\n\n${content}\n\n原图仅用于补充图形信息，不要以原图覆盖用户修正的题面。`;
      }
      content = [
        { type: 'text', text: content },
        ...images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
      ];
    }
    return { role: entry.role, content, ...(preserveThinking && entry.role === 'assistant' && entry.reasoningContent ? { reasoning_content: entry.reasoningContent } : {}) };
  });
}

function abortAllRequests(onlyId) {
  for (const [id, controller] of titleRequests) if (onlyId === undefined || id === onlyId) { titleRequests.delete(id); controller.abort(); }
  const requests = onlyId === undefined ? new Map(activeRequests) : new Map(activeRequests.has(onlyId) ? [[onlyId, activeRequests.get(onlyId)]] : []);
  requests.forEach((request) => request.flush?.());
  requests.forEach((_, id) => activeRequests.delete(id));
  requests.forEach((request) => request.controller.abort());
  if (!requests.size) return;
  useAppStore.setState((state) => ({
    conversations: state.conversations.map((conversation) => {
      const request = requests.get(conversation.id);
      if (!request) return conversation;
      return {
        ...conversation,
        messages: conversation.messages.map((message) => message.id === request.messageId
          ? { ...message, status: 'stopped', error: '已停止接收回答。' } : message),
      };
    }),
  }));
}

// M1 tests keep memory behavior; production attaches SQLite during startup.
export const useAppStore = create((set, get) => ({
  route: 'onboarding',
  methodId: null,
  methodChatOpen: false,
  methodConversationId: null,
  scenarioRef: null,
  knowledgeBack: [],
  preferences: normalizePreferences(),
  trailEpoch: 0,
  activeArea: 'ask',
  drawerOpen: false,
  trailFocus: null,
  modelConfig: createDefaultModelConfig(),
  conversations: [],
  currentConversationId: null,
  conversationLoading: false,
  onboarded: false,
  learnerId: null,
  storageStatus: 'memory',
  storageError: '',
  storageInitialized: false,
  dataOperation: null,

  setTheme: (theme) => {
    if (!get().dataOperation && ['light', 'dark', 'system'].includes(theme)) set((state) => ({ preferences: { ...state.preferences, theme } }));
  },
  setLightTemperature: (value) => {
    if (!get().dataOperation) set((state) => ({ preferences: { ...state.preferences, lightTemperature: normalizeLightTemperature(value) } }));
  },
  toggleTrailNode: (id) => set((state) => {
    const trailExpanded = { ...state.preferences.trailExpanded };
    if (trailExpanded[id]) delete trailExpanded[id]; else trailExpanded[id] = true;
    return { preferences: { ...state.preferences, trailExpanded } };
  }),
  setTrailScroll: (trailScroll, epoch) => {
    if (epoch === get().trailEpoch && !get().dataOperation) set((state) => ({ preferences: { ...state.preferences, trailScroll } }));
  },

  setModelConfig: (patch) => {
    if (get().dataOperation) return;
    set((state) => ({ modelConfig: { ...state.modelConfig, ...patch } }));
  },
  setAnswerThinking: (answerThinking) => {
    if (!get().dataOperation && ['auto', 'enabled', 'disabled'].includes(answerThinking)) set((state) => ({ preferences: { ...state.preferences, answerThinking } }));
  },
  locateQuestionRoute: async (route, messageId) => {
    if (get().dataOperation || !routeScenarioIds(route).length) return;
    const { loadSkeleton } = await import('../core/skeleton/load.js');
    const skeleton = await loadSkeleton();
    if (get().dataOperation) return;
    const scenarioIds = routeScenarioIds(route).filter(id => skeleton.scenarioById.has(id));
    const { expanded, targetPath } = routeTrailLocation(skeleton, scenarioIds, get().preferences.trailExpanded);
    set(state => ({ activeArea: 'trail', drawerOpen: false, trailFocus: { scenarioIds, targetPath, messageId, nonce: Date.now() },
      preferences: { ...state.preferences, trailExpanded: expanded } }));
  },
  returnToQuestion: () => set({ activeArea: 'ask', trailFocus: null }),

  selectProvider: (id) => {
    if (get().dataOperation) return;
    const provider = providers.find((entry) => entry.id === id);
    if (!provider) return;

    set((state) => ({
      modelConfig: {
        ...state.modelConfig,
        providerId: provider.id,
        apiBase: provider.apiBase,
        model: provider.defaultModel,
        auxiliaryModel: '', auxiliaryThinking: 'auto',
      },
    }));
  },

  completeOnboarding: () => {
    const validation = validateModelConfig(get().modelConfig);
    if (get().dataOperation) return { valid: false, errors: { storage: '正在处理本地数据，请稍后再试。' } };
    if (validation.valid) {
      set((state) => ({ ...newConversationState(state.conversations), ...resetTrail(state), onboarded: true }));
    }
    return validation;
  },

  openSettings: () => set({ route: 'settings', drawerOpen: false }),
  closeSettings: () => set({ route: 'main', drawerOpen: false }),
  openMethod: (methodId) => {
    const state = get();
    if (typeof methodId !== 'string' || state.dataOperation) return;
    const knowledgeBack = state.route === 'scenario'
      ? [...state.knowledgeBack, { route: 'scenario', scenarioRef: state.scenarioRef, methodId: state.methodId }]
      : [];
    set({ route: 'method', methodId, drawerOpen: false, methodChatOpen: false, methodConversationId: null, knowledgeBack });
  },
  closeMethod: () => {
    const state = get(), previous = state.knowledgeBack.at(-1);
    if (previous) set({ ...previous, knowledgeBack: state.knowledgeBack.slice(0, -1), methodChatOpen: false, drawerOpen: false });
    else set({ route: 'main', activeArea: 'trail', methodId: null, methodChatOpen: false, scenarioRef: null, knowledgeBack: [] });
  },
  openScenario: (nodeRef) => {
    const state = get();
    if (state.dataOperation || !nodeRef || typeof nodeRef.id !== 'string' || !['scenario','group','block'].includes(nodeRef.kind)) return;
    const previous = { route: state.route, methodId: state.methodId, scenarioRef: state.scenarioRef,
      methodChatOpen: false, methodConversationId: state.methodConversationId, activeArea: state.activeArea };
    set({ route: 'scenario', scenarioRef: { id: nodeRef.id, kind: nodeRef.kind }, drawerOpen: false, methodChatOpen: false,
      knowledgeBack: [...state.knowledgeBack, previous] });
  },
  closeScenario: () => {
    const state = get(), previous = state.knowledgeBack.at(-1);
    if (previous) set({ ...previous, knowledgeBack: state.knowledgeBack.slice(0, -1), drawerOpen: false });
    else set({ route: 'main', activeArea: 'trail', scenarioRef: null, methodId: null, methodChatOpen: false, knowledgeBack: [] });
  },
  setMethodChatOpen: (open) => set({ methodChatOpen: Boolean(open) }),
  openMethodChat: async () => {
    const state = get();
    if (!state.methodId || state.dataOperation) return;
    const saved = state.conversations.filter((entry) => entry.methodId === state.methodId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    set({ methodChatOpen: true, methodConversationId: saved?.id ?? null });
    if (saved?.loaded === false && persistence) { try { await persistence.loadConversation(saved.id); } catch { /* Safe storage error is in state. */ } }
  },
  sendMethodMessage: (content) => {
    const state = get();
    if (!String(content ?? '').trim() || !state.methodId || state.dataOperation) return null;
    let id = state.methodConversationId;
    if (!state.conversations.some((entry) => entry.id === id && entry.methodId === state.methodId)) {
      const conversation = createConversation(state.methodId); id = conversation.id;
      set((current) => ({ conversations: [conversation, ...current.conversations], methodConversationId: id }));
    }
    return get().sendMessage(content, { conversationId: id });
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen: Boolean(drawerOpen) }),
  setActiveArea: (activeArea) => {
    if (!['ask', 'practice', 'trail'].includes(activeArea)) return;
    set({ activeArea, drawerOpen: false });
  },

  newConversation: () => {
    if (!get().dataOperation) set((state) => ({ ...newConversationState(state.conversations), ...resetTrail(state) }));
  },

  selectConversation: async (id) => {
    const conversation = get().conversations.find((entry) => entry.id === id);
    if (get().dataOperation || !conversation) return;
    if (conversation.methodId) set({ route: 'method', methodId: conversation.methodId, methodChatOpen: true, methodConversationId: id, drawerOpen: false, scenarioRef: null, knowledgeBack: [] });
    else set({ route: 'main', activeArea: 'ask', drawerOpen: false, currentConversationId: id, conversationLoading: conversation.loaded === false, scenarioRef: null, knowledgeBack: [] });
    if (persistence && conversation.loaded === false) {
      try { await persistence.loadConversation(id); } catch { /* State holds the safe error and can retry. */ }
    }
    const loaded = get().conversations.find((entry) => entry.id === id);
    const first = loaded?.messages.find((message) => message.role === 'user');
    if (loaded?.titleStatus === 'legacy' && first && loaded.title === Array.from(first.content.replace(/\s+/g,' ')).slice(0,32).join('')) {
      set((state) => ({ conversations: state.conversations.map((entry) => entry.id === id ? { ...entry, title: '新对话', titleStatus: 'pending' } : entry) }));
    }
    requestConversationTitle(id);
  },

  updateConversation: async (id, patch) => {
    if (get().dataOperation) return;
    const safe = { ...(typeof patch.title === 'string' && patch.title.trim() ? { title: patch.title.trim().slice(0,80) } : {}),
      ...(typeof patch.pinned === 'boolean' ? { pinned: patch.pinned } : {}) };
    if (safe.title) {
      titleRequests.get(id)?.abort(); titleRequests.delete(id);
      safe.titleStatus = 'manual';
      set((state) => ({ conversations: state.conversations.map((entry) => entry.id === id ? { ...entry, titleStatus: 'manual' } : entry) }));
    }
    if (persistence) return persistence.updateConversation(id, safe);
    set((state) => ({ conversations: state.conversations.map((entry) => entry.id === id ? { ...entry, ...safe } : entry) }));
  },
  deleteConversation: async (id, includeLearning) => {
    if (get().dataOperation) return;
    if (persistence) return persistence.deleteConversation(id, includeLearning);
    abortAllRequests(id);
    set((state) => ({ conversations: state.conversations.filter((entry) => entry.id !== id) }));
    if (get().currentConversationId === id) get().newConversation();
  },

  sendMessage: async (content, { recheckOf, image, attachments, correctedImage = false, conversationId, revisionOf, revisionAction } = {}) => {
    const text = String(content ?? '').trim();
    if (!text && image === undefined && !attachments?.length) return null;
    if (get().dataOperation || get().conversationLoading || (get().storageStatus === 'loading' && !get().storageInitialized)) return null;
    if (image !== undefined && (!get().modelConfig.supportsImage || !validImage(image))) return null;
    if (attachments?.some((item) => item.kind === 'image' && (!get().modelConfig.supportsImage || !validImage(item)))) return null;
    if (attachments) image = attachments.find((item) => item.kind === 'image');

    const selectedConversation = get().conversations.find((entry) => entry.id === (conversationId ?? get().currentConversationId));
    if (selectedConversation?.loaded === false) return null;
    const branched = revisionOf ? branchBefore(selectedConversation?.messages ?? [], revisionOf) : null;
    if (revisionOf && !branched) return null;
    if (recheckOf !== undefined) {
      const target = selectedConversation?.messages.find((entry) => entry.id === recheckOf);
      if (target?.role !== 'assistant' || target.superseded || target.status === 'streaming' || !target.content?.trim()) return null;
    }

    if (conversationId && !selectedConversation) return null;
    if (!conversationId && !get().conversations.some((conversation) => conversation.id === get().currentConversationId)) {
      get().newConversation();
    }
    const currentId = conversationId ?? get().currentConversationId;
    if (activeRequests.has(currentId)) return null;

    const conversation = get().conversations.find((entry) => entry.id === currentId);
    const config = { ...get().modelConfig };
    const message = {
      id: makeId('message'),
      role: 'user',
      content: text,
      ...(recheckOf !== undefined ? { recheckOf } : {}),
      ...(revisionOf ? { revisionOf, revisionAction } : {}),
      ...(image !== undefined ? { image, imageCorrected: Boolean(correctedImage) } : {}),
      ...(attachments?.length ? { attachments } : {}),
      createdAt: new Date().toISOString(),
    };
    const answer = {
      id: makeId('message'),
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: message.createdAt,
    };
    const request = { controller: new AbortController(), messageId: answer.id };
    let raw = '', transcript = '', reasoning = '', reasoningChanged = false;
    let pendingContent, batchQueued = false;
    activeRequests.set(currentId, request);

    let messages = buildModelMessages([...(branched ?? conversation.messages), message], config);
    const transcribeImage = image && !correctedImage;

    const updateAnswer = (patch) => {
      if (activeRequests.get(currentId) !== request) return;
      set((state) => ({
        conversations: state.conversations.map((entry) => {
          if (entry.id !== currentId) return entry;
          return {
            ...entry,
            updatedAt: new Date().toISOString(),
            messages: entry.messages.map((item) => (
              item.id === answer.id ? { ...item, ...patch(item) } : item
            )),
          };
        }),
      }));
    };

    request.flush = () => {
      if (reasoningChanged) { reasoningChanged = false; updateAnswer(() => ({ reasoningContent: reasoning })); }
      if (pendingContent === undefined) return;
      const content = pendingContent; pendingContent = undefined;
      updateAnswer(() => ({ content }));
    };
    function publish(content) {
      pendingContent = content;
      if (!batchQueued) {
        request.flush(); batchQueued = true;
        queueMicrotask(() => { batchQueued = false; request.flush(); });
      }
    }

    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== currentId) return conversation;
        return {
          ...conversation,
          title: conversation.messages.length === 0 && conversation.titleStatus !== 'manual'
            ? conversation.methodId ? '方法讨论' : image ? '图片题目' : '新对话' : conversation.title,
          updatedAt: message.createdAt,
          messages: [...(branched ?? conversation.messages), message, answer],
          revisionViewOnly: false,
          revisionPaths: captureRevisionPaths(conversation.messages, conversation.revisionPaths, revisionOf),
        };
      }),
    }));

    if (!image) requestConversationTitle(currentId);

    try {
      const history = branched ?? conversation.messages;
      const latestCard = [...visibleMessages(history)].reverse().find(m => m.practiceItemId);
      if (latestCard && !image && !attachments?.length && get().storageInitialized && chatRouteLetters(text)) {
        const database = await import('../core/db/database.js');
        const item = await database.loadPracticeItem(latestCard.practiceItemId);
        const selectedIds = parseChatRouteAnswer(text, item.question);
        if (selectedIds && !item.finishedAt) {
          if (request.controller.signal.aborted || activeRequests.get(currentId) !== request || get().dataOperation) return message;
          const graded = await database.gradePracticeItem({ id: item.runId, generation: item.generation }, item.id, { mode: 'selection', selectedIds });
          updateAnswer(() => ({ content: graded.items.find(i => i.id === item.id).answer.feedback, status: 'complete' }));
          return message;
        }
      }
      if (!image && !attachments?.length && !conversation.methodId && get().storageInitialized && wantsChatPractice(text)) {
        updateAnswer(() => ({ content: '正在从已审核题库选择相关题目…' }));
        const learnerId = get().learnerId;
        const database = await import('../core/db/database.js');
        const { loadSkeleton } = await import('../core/skeleton/load.js');
        const { pickChatPractice } = await import('../core/chat/practice.js');
        const [skeleton, trail, usage] = await Promise.all([loadSkeleton(), database.loadTrail(), database.loadPracticeUsage()]);
        const selection = await pickChatPractice({ config, conversation: { ...conversation, messages: history }, text, skeleton, trail, usage, signal: request.controller.signal });
        if (request.controller.signal.aborted || activeRequests.get(currentId) !== request || get().dataOperation || get().learnerId !== learnerId) return message;
        if (selection.clarification) { updateAnswer(() => ({ content: selection.clarification, status: 'complete' })); return message; }
        await get().flushStorage();
        if (request.controller.signal.aborted || activeRequests.get(currentId) !== request || get().dataOperation || get().learnerId !== learnerId) return message;
        const run = await database.createPracticeRun({ scenarioId: selection.target.scenarioId, methodId: selection.target.methodId,
          items: [selection.question], localPrepared: true, chat: { conversationId: currentId, messageId: answer.id, sourceMessageId: selection.sourceMessageId } });
        updateAnswer(() => ({ content: selection.question.question, practiceItemId: run.items[0].id, status: 'complete', error: undefined }));
        return message;
      }
      if (history.some(m => m.practiceItemId) && get().storageInitialized) {
        const database = await import('../core/db/database.js');
        const { chatPracticeContext } = await import('../core/chat/practice.js');
        messages = buildModelMessages([...(await chatPracticeContext(history, database, text)), message], config);
      }
      const systemPrompt = conversation.methodId ? methodDiscussionPrompt(await (await import('../core/skeleton/load.js')).loadSkeleton(), conversation.methodId) : ASK_SYSTEM_PROMPT;
      const content = await streamAnswer({
        ...answerRequest(config, conversation.methodId ? 'auto' : get().preferences.answerThinking),
        messages,
        signal: request.controller.signal,
        systemPrompt: systemPrompt + (transcribeImage ? IMAGE_TRANSCRIPT_INSTRUCTION : ''),
        onReasoning: (delta) => { reasoning += delta; reasoningChanged = true; },
        onDelta: (delta) => {
          if (typeof delta !== 'string' || !delta) return;
          raw += delta;
          const parsed = transcribeImage ? splitImageTranscript(raw) : { answer: raw, question: '' };
          if (parsed.question && parsed.question !== transcript && activeRequests.get(currentId) === request) {
            transcript = parsed.question;
            set((state) => ({ conversations: state.conversations.map((entry) => entry.id === currentId ? { ...entry,
              messages: entry.messages.map((item) => item.id === message.id ? { ...item, content: text ? `${transcript}\n\n${text}` : transcript } : item) } : entry) }));
            requestConversationTitle(currentId);
          }
          publish(parsed.answer);
        },
      });
      const parsed = transcribeImage ? splitImageTranscript(content) : { answer: content };
      if (parsed.pending) throw Object.assign(new Error(), { userMessage: '模型只返回了部分题面，没有完成回答，请重试。' });
      request.flush();
      updateAnswer(() => ({ content: parsed.answer, status: 'complete', error: undefined }));
    } catch (error) {
      request.flush();
      if (request.controller.signal.aborted) {
        updateAnswer(() => ({ status: 'stopped', error: '已停止接收回答。' }));
      } else {
        updateAnswer(() => ({ status: 'error', error: answerError(error) }));
      }
    } finally {
      request.flush();
      if (activeRequests.get(currentId) === request) activeRequests.delete(currentId);
      if (image) requestConversationTitle(currentId);
    }
    return message;
  },

  reviseUserMessage: (messageId, content, { action = 'edit', conversationId } = {}) => {
    const conversation = get().conversations.find((entry) => entry.id === (conversationId ?? get().currentConversationId));
    if (!conversation || conversation.loaded === false || activeRequests.has(conversation.id)) return null;
    const message = visibleMessages(conversation.messages).find((entry) => entry.id === messageId);
    if (message?.role !== 'user') return null;
    const text = action === 'retry' ? message.content : String(content ?? '').trim();
    if (!text && !message.image && !message.attachments?.length) return null;
    return get().sendMessage(text, {
      conversationId: conversation.id, revisionOf: message.id, revisionAction: action,
      image: message.image, attachments: message.attachments,
      correctedImage: Boolean(message.image && text.trim()),
      ...(message.recheckOf ? { recheckOf: message.recheckOf } : {}),
    });
  },

  selectMessageRevision: (messageId) => {
    const state = get(), conversation = state.conversations.find(entry => entry.id === state.currentConversationId);
    if (!conversation || conversation.loaded === false || state.dataOperation || state.conversationLoading || activeRequests.has(conversation.id)) return false;
    const selected = selectRevision(conversation.messages, conversation.revisionPaths, messageId);
    if (!selected) return false;
    set({ conversations: state.conversations.map(entry => entry.id === conversation.id ? { ...entry, ...selected, revisionViewOnly: true } : entry) });
    return true;
  },

  stopGenerating: (conversationId) => {
    const currentId = typeof conversationId === 'string' ? conversationId : get().currentConversationId;
    const request = activeRequests.get(currentId);
    if (!request) return false;

    request.flush?.();
    activeRequests.delete(currentId);
    request.controller.abort();
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id !== currentId ? conversation : {
          ...conversation,
          updatedAt: new Date().toISOString(),
          messages: conversation.messages.map((message) => (
            message.id === request.messageId
              ? { ...message, status: 'stopped', error: '已停止接收回答。' }
              : message
          )),
        }
      )),
    }));
    return true;
  },

  recheckMessage: (messageId) => {
    const conversation = get().conversations.find((entry) => entry.id === get().currentConversationId);
    if (!conversation || activeRequests.has(conversation.id)) return null;
    const answer = conversation.messages.find((message) => message.id === messageId);
    if (answer?.role !== 'assistant' || answer.superseded || answer.status === 'streaming' || !answer.content?.trim()) return null;

    return get().sendMessage('这题不对，请重新检查并解释修正。', { recheckOf: answer.id });
  },

  clearAllData: () => {
    if (persistence) return persistence.clearAllData();
    abortAllRequests();
    set({
      route: 'onboarding',
      activeArea: 'ask',
      drawerOpen: false,
      modelConfig: createDefaultModelConfig(),
      conversations: [],
      currentConversationId: null,
      conversationLoading: false,
      onboarded: false,
      preferences: normalizePreferences(), trailEpoch: get().trailEpoch + 1,
      methodChatOpen: false, methodConversationId: null, methodId: null,
      scenarioRef: null, knowledgeBack: [],
    });
  },

  initializeStorage: () => {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      try {
        if (!persistence) {
          set({ storageStatus: 'loading', storageError: '' });
          const database = await import('../core/db/database.js');
          attachAppPersistence(database);
        }
        return await persistence.initialize();
      } catch (error) {
        const message = error?.userMessage || '本地数据暂时未能读写。当前内容仍保留，请重试。';
        set({ storageStatus: 'error', storageError: message });
        throw new Error(message);
      }
    })().finally(() => { bootPromise = null; });
    return bootPromise;
  },
  retryStorage: () => persistence ? persistence.retry() : get().initializeStorage(),
  flushStorage: () => persistence ? persistence.flush() : Promise.resolve(),
  prepareForExit: () => { abortAllRequests();return persistence ? persistence.flush() : Promise.resolve(); },
  exportData: () => persistence ? persistence.exportData() : Promise.reject(new Error('本地存储尚未准备好。')),
  prepareImport: (bytes) => persistence ? persistence.prepareImport(bytes) : Promise.reject(new Error('本地存储尚未准备好。')),
  confirmImport: (token) => persistence ? persistence.confirmImport(token) : Promise.reject(new Error('本地存储尚未准备好。')),
  cancelImport: (token) => persistence ? persistence.cancelImport(token) : Promise.resolve(),
}));

export function attachAppPersistence(database, options = {}) {
  if (persistence) persistence.dispose();
  persistence = attachPersistence(useAppStore, database, { ...options, abortRequests: abortAllRequests });
  return persistence;
}
