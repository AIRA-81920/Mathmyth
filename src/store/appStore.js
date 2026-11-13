import { create } from 'zustand';
import { createDefaultModelConfig, providers, validateModelConfig } from '../core/config/providers.js';
import { streamAnswer } from '../core/ai/client.js';
import { attachPersistence } from './persistence.js';
import { askSystemPrompt } from '../core/ai/prompts.js';
import { getActiveSubject, setActiveSubject } from '../core/config/subject.js';
import { answerRequest, preservesReasoning, sendWithReasoningFallback } from '../core/ai/answerThinking.js';
import { routeTrailLocation } from '../core/skeleton/trailLocation.js';
import { routeScenarioIds } from '../core/chat/questionRoutes.js';
import { IMAGE_TRANSCRIPT_INSTRUCTION, IMAGE_FOLLOWUP_INSTRUCTION, splitImageTranscript, stripTranscriptTag } from '../core/ai/imageTranscript.js';
import { generateTitle } from '../core/ai/title.js';
import { normalizePreferences } from '../core/config/preferences.js';
import { methodDiscussionPrompt } from '../core/ai/methodContext.js';
import { branchBefore, visibleMessages, captureRevisionPaths, selectRevision } from '../core/chat/revisions.js';
import { normalizeLightTemperature } from '../core/ui/lightTemperature.js';
import { wantsChatPractice, chatRouteLetters, parseChatRouteAnswer } from '../core/chat/practiceIntent.js';
import { startRelatedPractice, cancelRelatedPractice } from './relatedPracticeActions.js';
import { flushPracticeDrafts } from '../core/learning/draftFlush.js';
import { cancelPracticeRequests, flushIndependentPracticeDrafts } from '../core/learning/practiceExit.js';

let nextId = 0;
const activeRequests = new Map();
const titleRequests = new Map();
// D11：被自动重连过的回答，避免一次中断被反复重发（每个回答只自动重连一次）。
const autoResumed = new Set();
// 续写补救（P-续写）：每条回答开始时的思考模式，补救请求必须沿用同一个值，
// 否则"接着写"的内容不在同一条思考链里。只放内存：App 被杀后断连的回答走"重新生成"。
const answerModes = new Map();
// 每个回答只自动补救一次；用户手动点"继续"不受此限制。
const autoRepaired = new Set();

// 模型续写时常把已有结尾再抄一遍，也可能从开头整段重来。算出要裁掉多少字符。
export function repeatedPrefixLength(base, incoming) {
  if (!base || !incoming) return 0;
  if (incoming.startsWith(base)) return base.length;
  const max = Math.min(base.length, incoming.length, 2000);
  for (let length = max; length >= 8; length -= 1) {
    if (base.endsWith(incoming.slice(0, length))) return length;
  }
  return 0;
}

// 没有正文可续时，用思考摘录当材料：开头留上下文，结尾留真正想到的地方。
function reasoningExcerpt(text) {
  const value = String(text ?? '').trim();
  if (value.length <= 2500) return value;
  return `${value.slice(0, 500)}\n……\n${value.slice(-2000)}`;
}
// D12：每个会话上一次刷新 updatedAt 的时刻，流式期间最多每秒刷新一次。
const updatedAtClocks = new Map();
// D12：流式 delta 的帧节流器。浏览器用 requestAnimationFrame（每帧最多一次状态
// 更新，取代原来每个 delta 都同步 set）；无 rAF 的环境（Node 单测）退化为立即
// 执行，保持"onDelta 返回后即可读到最新内容"的既有契约。
const scheduleFrame = typeof globalThis.requestAnimationFrame === 'function'
  ? (callback) => globalThis.requestAnimationFrame(() => callback())
  : (callback) => callback();
let persistence = null;
let bootPromise = null;
// 学科切换后的会话摘要加载序号：连续切换时只接受最后一次的结果。
let subjectLoad = 0;

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++nextId}`}`;
}

function createConversation(methodId = null, ephemeral = false) {
  const now = new Date().toISOString();
  return {
    id: makeId('conversation'),
    title: '新对话',
    titleStatus: 'pending',
    methodId,
    // 会话在创建时固定学科：之后切换学科，它仍属于创建它的那一套骨架。
    subject: getActiveSubject(),
    createdAt: now,
    updatedAt: now,
    messages: [],
    loaded: true,
    // 讨论默认只活在这次运行里：不进历史、不落库，用户点“存进历史”才转成真会话。
    ...(ephemeral ? { ephemeral: true } : {}),
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
  const preserveThinking = preservesReasoning(config);
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

function abortAllRequests(onlyId, { reason = '已停止接收回答。' } = {}) {
  cancelRelatedPractice(onlyId);
  for (const [id, controller] of titleRequests) if (onlyId === undefined || id === onlyId) { titleRequests.delete(id); controller.abort(); }
  const requests = onlyId === undefined ? new Map(activeRequests) : new Map(activeRequests.has(onlyId) ? [[onlyId, activeRequests.get(onlyId)]] : []);
  requests.forEach((request) => request.flush?.());
  requests.forEach((_, id) => activeRequests.delete(id));
  requests.forEach((request) => request.controller.abort());
  if (!requests.size) return;
  useAppStore.setState((state) => ({
    streamingCount: activeRequests.size,
    conversations: state.conversations.map((conversation) => {
      const request = requests.get(conversation.id);
      if (!request) return conversation;
      return {
        ...conversation,
        messages: conversation.messages.map((message) => message.id === request.messageId
          ? { ...message, status: 'stopped', error: reason } : message),
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
  // 学科切换计数：骨架派生的页面（问答、足迹、练习）据此重新读取对应学科数据。
  subjectEpoch: 0,
  activeArea: 'ask',
  drawerOpen: false,
  trailFocus: null,
  questionFocus: null,
  modelConfig: createDefaultModelConfig(),
  conversations: [],
  currentConversationId: null,
  chatDrafts: {},
  conversationLoading: false,
  onboarded: false,
  learnerId: null,
  storageStatus: 'memory',
  storageError: '',
  exitError: '',
  storageInitialized: false,
  dataOperation: null,
  dataRevision: 0,
  // D12/D9：活跃请求数的 O(1) 镜像。runner 与持久化层只读这一个数字，
  // 不必再遍历所有会话的所有消息去找 streaming 状态。
  streamingCount: 0,

  startRelatedPractice: (options) => startRelatedPractice(useAppStore, options),
  // 卡内的「再练一道 / 再选一道」：从这张练习本身继续找题。
  // forceNew 跳过"同思路已有卡就定位"的检查，因为这里就是用户主动要求换一道。
  startRelatedFromItem: async (itemId, { ai = false } = {}) => {
    const result = await startRelatedPractice(useAppStore, { sourceItemId: itemId, forceNew: true, ai });
    if (result?.ok && !result.existing && result.messageId) {
      set({ questionFocus: { conversationId: result.conversationId, messageId: result.messageId, nonce: globalThis.crypto.randomUUID() } });
    }
    return result;
  },
  // 重复点击同一思路时，把界面滚到已有那张卡并高亮。
  focusMessage: (conversationId, messageId) => {
    if (!conversationId || !messageId) return;
    set({ activeArea: 'ask', questionFocus: { conversationId, messageId, nonce: globalThis.crypto.randomUUID() } });
  },
  // 导入/导出/清库期间也收下草稿：只丢在内存里，等操作结束后再随会话一起落库，
  // 否则用户在操作期间打的字会被静默吞掉。
  setChatDraft: (conversationId, text) => {
    if (conversationId) set(state => ({ chatDrafts: { ...state.chatDrafts, [conversationId]: text } }));
  },

  setTheme: (theme) => {
    if (!get().dataOperation && ['light', 'dark', 'system'].includes(theme)) set((state) => ({ preferences: { ...state.preferences, theme } }));
  },
  // 切换学科：偏好写入 ui_preferences，模块级当前学科立即生效，
  // 同时清空当前会话列表（会话按学科存库，不能把另一学科的对话留在界面上）。
  // 练习状态单独重置（见 practiceStore.reset），避免把另一学科的一轮练习带过来。
  setSubject: (value) => {
    if (get().dataOperation) return false;
    const next = setActiveSubject(value);
    if (next === get().preferences.subject) return true;
    // 上一学科还在生成的回答不能继续流进已被清空的列表。
    abortAllRequests(undefined, { reason: '已切换学科，未完成的回答已停止。' });
    const conversation = createConversation();
    set((state) => ({
      preferences: { ...state.preferences, subject: next },
      conversations: [conversation],
      currentConversationId: conversation.id,
      conversationLoading: false,
      chatDrafts: {},
      drawerOpen: false,
      methodId: null, methodChatOpen: false, methodConversationId: null,
      scenarioRef: null, knowledgeBack: [], trailFocus: null, questionFocus: null,
      subjectEpoch: state.subjectEpoch + 1, trailEpoch: state.trailEpoch + 1,
    }));
    // 再异步把新学科已有的会话摘要补回来；序号用于丢弃连续切换产生的过期结果。
    const request = ++subjectLoad;
    import('../core/db/database.js')
      .then((database) => database.listConversations(next))
      .then((items) => {
        const state = useAppStore.getState();
        if (request !== subjectLoad || state.preferences.subject !== next || state.dataOperation) return;
        useAppStore.setState((current) => {
          const fresh = current.conversations.find((entry) => entry.id === conversation.id);
          const known = new Set(current.conversations.map((entry) => entry.id));
          const rest = items.filter((item) => item.id !== conversation.id && !known.has(item.id));
          return { conversations: [...(fresh ? [fresh] : []), ...current.conversations.filter((entry) => entry.id !== conversation.id), ...rest] };
        });
      })
      .catch(() => {});
    import('./practiceStore.js')
      .then(({ usePracticeStore }) => usePracticeStore.getState().reset())
      .catch(() => {});
    return true;
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
  openQuestionSource: async ({ sourceMessageId, sourceConversationId }) => {
    if (get().dataOperation || !sourceMessageId || !sourceConversationId) return false;
    await get().selectConversation(sourceConversationId);
    const state = get();
    if (state.dataOperation || state.currentConversationId !== sourceConversationId || state.activeArea !== 'ask') return false;
    const message = state.conversations.find(item => item.id === sourceConversationId)?.messages.find(item => item.id === sourceMessageId);
    if (!message || (message.superseded && !get().selectMessageRevision(sourceMessageId))) return false;
    set({ questionFocus: { conversationId: sourceConversationId, messageId: sourceMessageId, nonce: globalThis.crypto.randomUUID() } });
    return true;
  },

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
      const conversation = createConversation(state.methodId, true); id = conversation.id;
      set((current) => ({ conversations: [conversation, ...current.conversations], methodConversationId: id }));
    }
    return get().sendMessage(content, { conversationId: id });
  },
  // 用户显式要求留档时才整条落库；之后它才出现在历史里（历史用 methodId 标「讨论」）。
  saveMethodConversation: async (conversationId) => {
    const conversation = get().conversations.find((entry) => entry.id === conversationId);
    if (!conversation?.ephemeral || get().dataOperation) return false;
    const revision = get().dataRevision;
    try { if (persistence) await persistence.saveConversation(conversationId); }
    catch { return false; }
    if (get().dataRevision !== revision || get().dataOperation || !get().conversations.some(entry => entry.id === conversationId)) return false;
    set((state) => ({ conversations: state.conversations.map((entry) => entry.id === conversationId ? { ...entry, ephemeral: false } : entry) }));
    return true;
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

  sendMessage: async (content, { recheckOf, image, attachments, correctedImage = false, conversationId, revisionOf, revisionAction, useBank = false } = {}) => {
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
    // D6：纯文本追问 + 可见历史里有有效图 → 启用"尽力而为"的增量转写：
    // 模型若读了图里的新题，就把题面落字到这条追问消息正文；不输出标签也绝不报错。
    const historyHasImage = [...(branched ?? conversation.messages)].some((entry) =>
      validImage(entry.image) || (entry.attachments ?? []).some((item) => validImage(item)));
    const followupTranscript = !transcribeImage && Boolean(config.supportsImage && historyHasImage);

    const updateAnswer = (patch) => {
      if (activeRequests.get(currentId) !== request) return;
      const stamp = Date.now();
      // D12：流式期间 updatedAt 最多每秒刷新一次（历史列表排序不需要毫秒级抖动）。
      const refreshStamp = stamp - (updatedAtClocks.get(currentId) ?? 0) >= 1000;
      if (refreshStamp) updatedAtClocks.set(currentId, stamp);
      set((state) => ({
        streamingCount: activeRequests.size,
        conversations: state.conversations.map((entry) => {
          if (entry.id !== currentId) return entry;
          return {
            ...entry,
            ...(refreshStamp ? { updatedAt: new Date(stamp).toISOString() } : {}),
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
    // D12：流式 delta 走帧节流——浏览器每帧最多应用一次，避免每个 token 都触发
    // 一次全量 store 重建；无 rAF 环境退化为立即应用（见 scheduleFrame）。
    function publish(content) {
      pendingContent = content;
      schedulePublish();
    }
    function schedulePublish() {
      if (batchQueued) return;
      batchQueued = true;
      scheduleFrame(() => { batchQueued = false; request.flush(); });
    }

    set((state) => ({
      streamingCount: activeRequests.size,
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
      // 出题分流：默认把「给我一道题」交给模型随手出；只有用户点了「用题库，拔高练」
      // （useBank）或显式写了 /练习 才进审核题库 —— 题库题偏难，不该是默认路径。
      if (useBank && !image && !attachments?.length && !conversation.methodId && get().storageInitialized && wantsChatPractice(text)) {
        updateAnswer(() => ({ content: '正在从已审核题库选择相关题目…' }));
        const learnerId = get().learnerId;
        const database = await import('../core/db/database.js');
        const { loadSkeleton } = await import('../core/skeleton/load.js');
        const { pickChatPractice } = await import('../core/chat/practice.js');
        const [skeleton, trail, usage] = await Promise.all([loadSkeleton(), database.loadTrail(), database.loadPracticeUsage()]);
        // 本对话已经出过的题不再重复出现（题库入口也要排除，而不只是排序降权）。
        const usedKeys = await database.listChatPracticeQuestionKeys(currentId);
        const selection = await pickChatPractice({ config, conversation: { ...conversation, messages: history }, text, skeleton, trail, usage, usedKeys, signal: request.controller.signal });
        if (request.controller.signal.aborted || activeRequests.get(currentId) !== request || get().dataOperation || get().learnerId !== learnerId) return message;
        if (selection.clarification) { updateAnswer(() => ({ content: selection.clarification, status: 'complete' })); return message; }
        await get().flushStorage();
        if (request.controller.signal.aborted || activeRequests.get(currentId) !== request || get().dataOperation || get().learnerId !== learnerId) return message;
        const run = await database.createPracticeRun({ scenarioId: selection.target.scenarioId, methodId: selection.target.methodId,
          items: [selection.question], localPrepared: true, preparedTarget: selection.target,
          chat: { conversationId: currentId, messageId: answer.id, sourceMessageId: selection.sourceMessageId } });
        updateAnswer(() => ({ content: selection.question.question, practiceItemId: run.items[0].id, status: 'complete', error: undefined }));
        return message;
      }
      if (history.some(m => m.practiceItemId) && get().storageInitialized) {
        const database = await import('../core/db/database.js');
        const { chatPracticeContext } = await import('../core/chat/practice.js');
        messages = buildModelMessages([...(await chatPracticeContext(history, database, text)), message], config);
      }
      // 记录这条回答开始时的思考模式：后续补救续写必须沿用，不能读当时的偏好。
      const answerMode = conversation.methodId ? 'disabled' : get().preferences.answerThinking;
      answerModes.set(answer.id, answerMode);
      const systemPrompt = conversation.methodId ? methodDiscussionPrompt(await (await import('../core/skeleton/load.js')).loadSkeleton(), conversation.methodId) : askSystemPrompt();
      // 方法讨论优先即时性：关闭思考，等一个能立刻读懂的回答（主问答仍按用户偏好）。
      // 思考字段由 sendWithReasoningFallback 发送：网关用 400 拒绝时会自动退回一次。
      const content = await sendWithReasoningFallback({ config, mode: answerMode, send: (requested) => streamAnswer({
        ...requested,
        messages,
        signal: request.controller.signal,
        systemPrompt: systemPrompt + (transcribeImage ? IMAGE_TRANSCRIPT_INSTRUCTION : followupTranscript ? IMAGE_FOLLOWUP_INSTRUCTION : ''),
        onReasoning: (delta) => { reasoning += delta; reasoningChanged = true; schedulePublish(); },
        onDelta: (delta) => {
          if (typeof delta !== 'string' || !delta) return;
          raw += delta;
          const parsed = (transcribeImage || followupTranscript) ? splitImageTranscript(raw) : { answer: raw, question: '' };
          if (parsed.question && parsed.question !== transcript && activeRequests.get(currentId) === request) {
            transcript = parsed.question;
            set((state) => ({ conversations: state.conversations.map((entry) => entry.id === currentId ? { ...entry,
              messages: entry.messages.map((item) => item.id === message.id ? { ...item, content: text ? `${transcript}\n\n${text}` : transcript } : item) } : entry) }));
            requestConversationTitle(currentId);
          }
          publish(parsed.answer);
        },
      }) });
      const parsed = (transcribeImage || followupTranscript) ? splitImageTranscript(content) : { answer: content };
      // 严格模式（首题带图）没有完整标签才报错可重试。追问的尽力而为模式永不在此
      // 报错：标签缺失或未闭合时整段按正常回答保留，只去掉裸露的开标签。
      if (transcribeImage && parsed.pending) throw Object.assign(new Error(), { userMessage: '模型只返回了部分题面，没有完成回答，请重试。' });
      // D12：先清掉可能还在等下一帧的中间态，再用权威的完整正文覆盖，避免迟到的
      // 帧把已完成的内容倒退回局部前缀。
      pendingContent = undefined;
      request.flush();
      const finalAnswer = !transcribeImage && parsed.pending ? stripTranscriptTag(content) : parsed.answer;
      updateAnswer(() => ({ content: finalAnswer, status: 'complete', error: undefined }));
    } catch (error) {
      request.flush();
      if (request.controller.signal.aborted) {
        updateAnswer(() => ({ status: 'stopped', error: '已停止接收回答。' }));
      } else {
        // D11：把错误分类留在内存（不落库，schema 不变），供回前台时判断是否
        // 值得自动重连。用户手动停止走的是 stopped，不会被重连。
        // 有任何产出（正文或思考）才有"续写"可言；一条都没有只给重试。
        updateAnswer(() => ({ status: 'error', error: answerError(error), errorCode: error?.code ?? 'unknown',
          ...(raw.trim() || reasoning.trim() ? { canRepair: true } : {}) }));
      }
    } finally {
      request.flush();
      if (activeRequests.get(currentId) === request) activeRequests.delete(currentId);
      if (get().streamingCount !== activeRequests.size) set({ streamingCount: activeRequests.size });
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

  // 续写补救：不重放整段，把已有产出当材料让模型接着说，结果并入同一条回答（不动版本）。
  repairAnswer: async (conversationId, messageId, { manual = false } = {}) => {
    const state = get();
    if (state.dataOperation || state.conversationLoading) return false;
    const currentId = conversationId ?? state.currentConversationId;
    const conversation = state.conversations.find((entry) => entry.id === currentId);
    if (!conversation || conversation.loaded === false || activeRequests.has(currentId)) return false;
    const all = conversation.messages ?? [];
    const at = all.findIndex((entry) => entry.id === messageId);
    if (at < 0) return false;
    const target = all[at];
    if (target.role !== 'assistant' || target.superseded) return false;
    const base = String(target.content ?? '');
    const reasoning = String(target.reasoningContent ?? '');
    if (!base.trim() && !reasoning.trim()) return false;
    const key = `${currentId}:${messageId}`;
    if (!manual && autoRepaired.has(key)) return false;
    autoRepaired.add(key);

    let preceding = null;
    for (let index = at - 1; index >= 0; index -= 1) {
      if (all[index].role === 'user' && !all[index].superseded) { preceding = all[index]; break; }
    }
    if (!preceding) return false;

    const config = { ...get().modelConfig };
    // 有正文就续写；只有思考就请它基于已有分析直接给答案。材料并进原提问，避免两条连续 user。
    const material = base.trim()
      ? `（上一次的回答在传输中断开，服务商不保留没发出来的部分。）已经写出的内容：\n\n<<<\n${base.slice(-3000)}\n>>>\n\n请从停顿处直接接着写下去，不要重复已经出现过的任何内容，也不要解释发生了什么。`
      : `（上一次的回答分析到一半就中断了。）此前的分析记录：\n\n<<<\n${reasoningExcerpt(reasoning)}\n>>>\n\n请基于这份分析直接给出完整回答，不必再重复分析过程。`;
    const history = all.slice(0, at).map((entry) => entry.id === preceding.id
      ? { ...entry, content: `${String(entry.content ?? '')}\n\n${material}` }
      : entry);
    const messages = buildModelMessages(history, config);

    const request = { controller: new AbortController(), messageId };
    activeRequests.set(currentId, request);
    let incoming = '';
    let queued = false, trim = 0;
    const merged = () => {
      if (!incoming) return base;
      if (trim === 0) trim = repeatedPrefixLength(base, incoming);
      return base + incoming.slice(trim);
    };
    const writeAnswer = (patch) => {
      if (activeRequests.get(currentId) !== request) return;
      const stamp = Date.now();
      const refreshStamp = stamp - (updatedAtClocks.get(currentId) ?? 0) >= 1000;
      if (refreshStamp) updatedAtClocks.set(currentId, stamp);
      set((current) => ({
        streamingCount: activeRequests.size,
        conversations: current.conversations.map((entry) => entry.id !== currentId ? entry : {
          ...entry,
          ...(refreshStamp ? { updatedAt: new Date(stamp).toISOString() } : {}),
          messages: entry.messages.map((item) => item.id === messageId ? { ...item, ...patch(item) } : item),
        }),
      }));
    };
    request.flush = () => {
      if (!incoming) return;
      writeAnswer(() => ({ content: merged() }));
    };
    const publish = (text) => {
      incoming = text;
      if (queued) return;
      queued = true;
      scheduleFrame(() => { queued = false; request.flush(); });
    };

    writeAnswer(() => ({ status: 'streaming', error: undefined, errorCode: undefined, canRepair: false }));
    try {
      const mode = answerModes.get(messageId) ?? (conversation.methodId ? 'disabled' : get().preferences.answerThinking);
      const systemPrompt = conversation.methodId
        ? methodDiscussionPrompt(await (await import('../core/skeleton/load.js')).loadSkeleton(), conversation.methodId)
        : askSystemPrompt();
      const content = await sendWithReasoningFallback({ config, mode, send: (requested) => streamAnswer({
        ...requested,
        messages,
        signal: request.controller.signal,
        systemPrompt,
        onDelta: (delta) => { if (typeof delta === 'string' && delta) publish(incoming + delta); },
      }) });
      incoming = content;
      writeAnswer(() => ({ content: merged(), status: 'complete', error: undefined, errorCode: undefined, canRepair: false, repaired: true }));
      return true;
    } catch (error) {
      const current = merged();
      if (request.controller.signal.aborted) {
        writeAnswer(() => ({ content: current, status: 'stopped', error: undefined, errorCode: undefined, canRepair: Boolean(current.trim()) }));
      } else {
        writeAnswer(() => ({ content: current, status: 'error', error: answerError(error), errorCode: error?.code ?? 'unknown', canRepair: Boolean(current.trim()) }));
      }
      return false;
    } finally {
      if (activeRequests.get(currentId) === request) activeRequests.delete(currentId);
      if (get().streamingCount !== activeRequests.size) set({ streamingCount: activeRequests.size });
    }
  },

  // 重新生成：整段重来，旧回答降级为上一版。只有用户显式点它才允许版本 +1。
  regenerateAnswer: (conversationId, messageId) => {
    const state = get();
    const currentId = conversationId ?? state.currentConversationId;
    const conversation = state.conversations.find((entry) => entry.id === currentId);
    if (!conversation) return null;
    const all = conversation.messages ?? [];
    const at = all.findIndex((entry) => entry.id === messageId);
    if (at < 0) return null;
    for (let index = at - 1; index >= 0; index -= 1) {
      const entry = all[index];
      if (entry.role === 'user' && !entry.superseded) {
        return get().reviseUserMessage(entry.id, undefined, { action: 'retry', conversationId: currentId });
      }
    }
    return null;
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
      streamingCount: activeRequests.size,
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
  // 回到前台时若最后一个回答卡死或因网络/超时中断，就做一次**续写补救**：
  // 把已有产出当材料让模型接着写，并入同一条回答、不动版本号。
  // 完全没有产出（连接都没建立）时不动手 —— 那种情况交给用户点「重新生成」。
  // 每个回答只自动补救一次；用户手动停止（stopped）绝不自动补救。
  resumeInterruptedRequests: () => {
    const state = get();
    if (!state.storageInitialized || state.dataOperation || state.conversationLoading) return false;
    const conversation = state.conversations.find((entry) => entry.id === state.currentConversationId);
    if (!conversation || conversation.loaded === false || activeRequests.has(conversation.id)) return false;
    const raw = conversation.messages ?? [];
    const lastAnswer = [...visibleMessages(raw)].reverse().find((entry) => entry.role === 'assistant');
    if (!lastAnswer) return false;
    const interrupted = lastAnswer.status === 'streaming'
      || (lastAnswer.status === 'error' && ['network', 'timeout'].includes(lastAnswer.errorCode));
    if (!interrupted) return false;
    const at = raw.findIndex((entry) => entry.id === lastAnswer.id);
    let preceding = null;
    for (let index = at - 1; index >= 0; index -= 1) {
      if (raw[index].role === 'user' && !raw[index].superseded) { preceding = raw[index]; break; }
    }
    if (!preceding) return false;
    // 没有任何产出（正文与思考都为空）时没有"续写"可言，交给用户点「重新生成」。
    if (!String(lastAnswer.content ?? '').trim() && !String(lastAnswer.reasoningContent ?? '').trim()) return false;
    const key = `${conversation.id}:${lastAnswer.id}`;
    if (autoResumed.has(key)) return false;
    autoResumed.add(key);
    get().repairAnswer(conversation.id, lastAnswer.id);
    return true;
  },
  prepareForExit: async () => {
    set({ exitError: '' });
    try {
      abortAllRequests(undefined, { reason: '应用关闭，回答尚未完成。' });
      // 先停练习判定（自己的 controllers，不归 abortAllRequests 管），再 flush 草稿：
      // 独立练习的草稿按 350ms 节流写，退出时必须把还没到点的那一笔立刻写掉。
      cancelPracticeRequests();
      if (!await flushIndependentPracticeDrafts()) throw new Error('draft_flush_failed');
      if (!await flushPracticeDrafts()) throw new Error('draft_flush_failed');
      if (persistence) await persistence.flush();
      set({ exitError: '', storageError: '', ...(get().storageInitialized ? { storageStatus: 'ready' } : {}) });
    } catch {
      const message = '草稿或本地数据尚未保存，应用暂未关闭。请重试保存后再关闭。';
      set({ storageStatus: 'error', storageError: message, exitError: message });
      throw new Error(message);
    }
  },
  exportData: async () => {
    if (!persistence) throw new Error('本地存储尚未准备好。');
    if (!await flushPracticeDrafts()) throw new Error('练习草稿尚未保存，请稍后重试导出。');
    return persistence.exportData();
  },
  prepareImport: (bytes) => persistence ? persistence.prepareImport(bytes) : Promise.reject(new Error('本地存储尚未准备好。')),
  confirmImport: (token) => persistence ? persistence.confirmImport(token) : Promise.reject(new Error('本地存储尚未准备好。')),
  cancelImport: (token) => persistence ? persistence.cancelImport(token) : Promise.resolve(),
}));

useAppStore.subscribe((state, previous) => {
  if ((state.learnerId !== previous.learnerId || state.dataRevision !== previous.dataRevision)
    && Object.keys(state.chatDrafts).length) useAppStore.setState({ chatDrafts: {} });
  // 启动恢复、导入备份或清空数据都会整批替换 preferences；
  // 这里同步模块级当前学科，保证后续骨架加载与提示词取到同一学科。
  if (state.preferences.subject !== previous.preferences.subject) setActiveSubject(state.preferences.subject);
});

export function attachAppPersistence(database, options = {}) {
  if (persistence) persistence.dispose();
  persistence = attachPersistence(useAppStore, database, { ...options, abortRequests: abortAllRequests,
    beforeFlush: () => activeRequests.forEach(request => request.flush?.()) });
  return persistence;
}
