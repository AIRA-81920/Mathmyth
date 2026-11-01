import { visibleMessages } from '../core/chat/revisions.js';
import { routePaths } from '../core/chat/questionRoutes.js';

const requests = new Map();
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const failure = (error, canGenerate = false) => ({ ok: false, error, canGenerate });

export function cancelRelatedPractice(conversationId) {
  for (const [key, request] of requests) if (!conversationId || request.conversationId === conversationId) {
    request.controller.abort(); requests.delete(key);
  }
}

export async function startRelatedPractice(store, options = {}, dependencies = {}) {
  const before = store.getState();
  if (!before.storageInitialized || before.dataOperation || before.conversationLoading) return failure('本地记录尚未准备好，请稍后重试。');
  const originalConversationId = before.currentConversationId;
  const key = originalConversationId || 'review';
  if (requests.has(key) || before.streamingCount) return failure('请等当前操作结束后再试。');
  const request = { controller: new AbortController(), conversationId: originalConversationId };
  requests.set(key, request);
  const learnerId = before.learnerId;
  let placeholderId, destinationId, linkedItemId;
  const current = () => !request.controller.signal.aborted && !store.getState().dataOperation
    && store.getState().learnerId === learnerId && !store.getState().streamingCount && requests.get(key) === request;
  try {
    const database = dependencies.database ?? await import('../core/db/database.js');
    const skeleton = dependencies.skeleton ?? await (await import('../core/skeleton/load.js')).loadSkeleton();
    const matching = dependencies.matching ?? await import('../core/practice/related.js');
    if (!current()) return failure('操作已取消。');
    if (options.reviewId) {
      const reviews = await database.listPracticeReviews();
      const review = reviews.find(entry => entry.id === options.reviewId && entry.sourceItemId === options.sourceItemId && entry.status === 'pending');
      if (!review) return failure('这条复习安排已变化，请刷新后重试。');
      if (review.activeItemId && review.activeConversationId) {
        const state = store.getState();
        if (!current() || state.currentConversationId !== originalConversationId || state.route !== before.route || state.activeArea !== before.activeArea) return failure('已保留当前页面，请从复习入口重新进入。');
        await state.selectConversation(review.activeConversationId);
        return { ok: true, itemId: review.activeItemId, conversationId: review.activeConversationId, resumed: true };
      }
    }
    let sourceQuestion, sourceAnswer = '', sourceRoute, userMessageId = options.userMessageId ?? null;
    let sourceItem;
    const conversation = store.getState().conversations.find(entry => entry.id === originalConversationId);
    if (options.sourceItemId) {
      sourceItem = await database.loadPracticeItem(options.sourceItemId);
      sourceQuestion = sourceItem.question;
      const route = sourceQuestion.routes?.find(entry => entry.id === sourceQuestion.metadata?.learning?.targetRouteId && entry.valid)
        ?? sourceQuestion.routes?.find(entry => entry.preferred && entry.valid)
        ?? sourceQuestion.routes?.find(entry => entry.valid);
      if (!route) return failure('这道练习没有可追溯的解法，请从原题重新进入。');
      sourceRoute = { steps: route.steps };
      sourceAnswer = sourceQuestion.solution;
      const sourceCard = conversation?.messages.find(message => message.practiceItemId === options.sourceItemId);
      if (!options.reviewId && !sourceCard) return failure('请从这道练习所在的对话继续。');
      const anchor = sourceItem.source?.sourceMessageId ?? sourceQuestion.metadata?.learning?.provenance?.userMessageId;
      userMessageId = conversation?.messages.some(message => message.id === anchor && message.role === 'user' && !message.superseded) ? anchor : null;
    } else {
      if (!conversation || conversation.loaded === false) return failure('原对话尚未读取完成。');
      const answer = visibleMessages(conversation.messages).find(message => message.id === options.answerId && message.role === 'assistant' && message.status === 'complete');
      if (!answer || answer.practiceItemId) return failure('这轮解答已变化，请从当前解答重新进入。');
      const snapshots = await database.loadAnswerQuestionRoutes(conversation.id);
      const snapshot = snapshots.find(entry => entry.answerId === answer.id && entry.messageId === userMessageId);
      const route = snapshot?.routes?.find(entry => entry.question_index === (options.questionIndex ?? 1));
      if (!snapshot?.ordered || !route) return failure('本题路径尚未整理完成，请稍后重试。');
      const paths = routePaths(route);
      if (paths.length > 1 && !Number.isInteger(options.pathIndex)) return failure('请先选择想练的那条思路。');
      const path = paths[options.pathIndex ?? 0];
      if (!path?.steps?.length) return failure('所选思路已变化，请重新选择。');
      const source = conversation.messages.find(message => message.id === userMessageId && message.role === 'user' && !message.superseded);
      if (!source) return failure('原题已变化，请从当前题目重新进入。');
      sourceQuestion = [source.content || source.recognizedQuestion,
        ...(source.attachments ?? []).filter(entry => entry.kind === 'document').map(entry => entry.text)].filter(Boolean).join('\n\n');
      sourceAnswer = answer.content;
      sourceRoute = { steps: path.steps };
    }
    const usage = await database.loadPracticeUsage();
    if (!current()) return failure('操作已取消。');
    const argumentsForMatch = { sourceRoute, sourceQuestion, sourceAnswer, skeleton,
      relation: options.relation ?? 'similar', usage,
      excludeQuestionKeys: sourceItem ? [sourceItem.question.questionKey] : [] };
    // AI 出题要边流边显示题面，所以占位消息必须在发请求之前就存在。
    // 复习入口（reviewId）会另开新对话，那条路不预建，保持原样。
    if (options.ai && !options.reviewId) {
      destinationId = store.getState().currentConversationId;
      if (!destinationId) return failure('无法打开练习对话，请重试。');
      placeholderId = id('related-answer');
      const started = new Date().toISOString();
      store.setState(state => ({ conversations: state.conversations.map(entry => entry.id === destinationId ? { ...entry, updatedAt: started,
        messages: [...entry.messages, { id: placeholderId, role: 'assistant', content: '正在准备相关练习…', status: 'streaming', createdAt: started }] } : entry) }));
      await store.getState().flushStorage();
      if (!current()) return failure('操作已取消。');
    }
    const selection = options.ai
      ? await matching.generateRelatedPractice({ ...argumentsForMatch, config: { ...before.modelConfig }, signal: request.controller.signal,
        // 题面一到就先显示：不等整段 JSON 收尾。占位消息在这个阶段是"未完成"的纯文本，
        // 收口时再换成正式题面 + practiceItemId（那时才渲染练习卡）。
        onQuestionPartial: (text) => {
          if (!placeholderId || !current()) return;
          store.setState(state => ({ conversations: state.conversations.map(entry => entry.id === destinationId
            ? { ...entry, messages: entry.messages.map(message => message.id === placeholderId
              ? { ...message, content: text, pendingDetail: '正在补全练习结构…', partial: true } : message) } : entry) }));
        } })
      : await matching.findRelatedPractice(argumentsForMatch);
    if (!current()) return failure('操作已取消。');
    // 出口优先：本地严格匹配没有、或结构核对不了，都要给"让 AI 编一道"的机会，
    // 只有用户主动要 AI 时才不再重复给这个按钮。
    if (!selection?.question) {
      const canGenerate = !options.ai && ['no_exact_match', 'route_unresolved'].includes(selection?.code);
      return { ...failure(selection?.reason || '暂时没有匹配这条思路的练习。', canGenerate), canSelectPractice: true };
    }
    // Navigation while matching must not redirect the user back to an old chat.
    const selectedState = store.getState();
    if (selectedState.currentConversationId !== originalConversationId || selectedState.route !== before.route || selectedState.activeArea !== before.activeArea) return failure('已保留当前页面。回到原位置后可重新开始。');
    if (options.answerId && !visibleMessages(selectedState.conversations.find(entry => entry.id === originalConversationId)?.messages ?? [])
      .some(message => message.id === options.answerId && message.status === 'complete')) return failure('这轮解答已变化，请从当前解答重新进入。');
    if (options.reviewId) {
      const reviews = await database.listPracticeReviews();
      if (!reviews.some(review => review.id === options.reviewId && review.sourceItemId === options.sourceItemId && review.status !== 'cancelled' && review.status !== 'completed')) return failure('这条复习安排已变化，请刷新后重试。');
      if (!current()) return failure('操作已取消。');
      const stillSelected = store.getState();
      if (stillSelected.currentConversationId !== originalConversationId || stillSelected.route !== before.route || stillSelected.activeArea !== before.activeArea) return failure('已保留当前页面，请从复习入口重新进入。');
      store.getState().newConversation();
      userMessageId = null;
    }
    destinationId = store.getState().currentConversationId;
    if (!destinationId) return failure('无法打开练习对话，请重试。');
    const now = new Date().toISOString();
    const question = structuredClone(selection.question);
    question.metadata = { ...question.metadata, learning: { ...question.metadata?.learning,
      relation: options.relation ?? 'similar', reviewId: options.reviewId ?? null,
      provenance: { userMessageId, answerId: options.answerId ?? null,
        questionIndex: options.questionIndex ?? 1, pathIndex: options.pathIndex ?? 0,
        sourceItemId: options.sourceItemId ?? null } } };
    if (placeholderId) {
      // 占位气泡已经建好了（AI 那条路）：这里只收口对话状态，不重复插一条。
      store.setState(state => ({ route: 'main', activeArea: 'ask', drawerOpen: false,
        conversations: state.conversations.map(entry => entry.id === destinationId ? { ...entry,
          ...(options.reviewId ? { title: '接着上次练习', titleStatus: 'manual' } : {}), updatedAt: now } : entry) }));
    } else {
      placeholderId = id('related-answer');
      store.setState(state => ({ route: 'main', activeArea: 'ask', drawerOpen: false,
        conversations: state.conversations.map(entry => entry.id === destinationId ? { ...entry,
          ...(options.reviewId ? { title: '接着上次练习', titleStatus: 'manual' } : {}), updatedAt: now,
          messages: [...entry.messages, { id: placeholderId, role: 'assistant', content: '正在准备相关练习…', status: 'streaming', createdAt: now }] } : entry) }));
      await store.getState().flushStorage();
    }
    if (!current()) return failure('操作已取消。');
    const run = await database.createPracticeRun({ scenarioId: question.entranceScenarioId ?? selection.target.scenarioId,
      methodId: selection.target.methodId, items: [question],
      ...(question.metadata?.reviewStatus === 'worked_example_checked' ? { localPrepared: true, preparedTarget: selection.target } : {}),
      chat: { conversationId: destinationId, messageId: placeholderId, sourceMessageId: userMessageId } });
    linkedItemId = run.items[0].id;
    if (store.getState().learnerId !== learnerId || store.getState().dataOperation) return failure('操作已取消。');
    if (requests.get(key) !== request) {
      // Cancellation cannot undo a transaction which already committed. Check
      // that its item still belongs to the current database before reconciling
      // the old placeholder; an import may have replaced that database.
      try { await database.loadPracticeItem(linkedItemId); } catch { return failure('操作已取消。'); }
      if (store.getState().learnerId !== learnerId || store.getState().dataOperation) return failure('操作已取消。');
    }
    store.setState(state => ({ conversations: state.conversations.map(entry => entry.id === destinationId
      ? { ...entry, messages: entry.messages.map(message => message.id === placeholderId
        ? { ...message, content: question.question, status: 'complete', practiceItemId: run.items[0].id, pendingDetail: '' } : message) } : entry) }));
    await store.getState().flushStorage();
    return { ok: true, itemId: run.items[0].id, conversationId: destinationId };
  } catch (error) {
    if (linkedItemId && current()) return { ok: true, itemId: linkedItemId, conversationId: destinationId };
    if (placeholderId && current()) store.setState(state => ({ conversations: state.conversations.map(entry => entry.id === destinationId
      ? { ...entry, messages: entry.messages.map(message => message.id === placeholderId
        ? { ...message, content: '这次练习尚未准备完成。', status: 'error', error: '请从原题重试，原有记录仍保留。', pendingDetail: '' } : message) } : entry) }));
    return failure(error?.userMessage || '这次练习没有准备完成，请重试。');
  } finally {
    if (placeholderId && !linkedItemId && store.getState().learnerId === learnerId && !store.getState().dataOperation) {
      store.setState(state => ({ conversations: state.conversations.map(entry => entry.id === destinationId ? { ...entry,
        messages: entry.messages.map(message => message.id === placeholderId && message.status === 'streaming'
          ? { ...message, status: 'error', error: '练习准备已停止，可从原题重试。', pendingDetail: '' } : message) } : entry) }));
    }
    if (requests.get(key) === request) requests.delete(key);
  }
}
