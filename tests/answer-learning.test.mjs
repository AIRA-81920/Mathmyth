import test from 'node:test';
import assert from 'node:assert/strict';
import { answerRouteSnapshots } from '../src/core/chat/answerRoutes.js';
import { startRelatedPractice, cancelRelatedPractice } from '../src/store/relatedPracticeActions.js';

const step = (scenario_id = 'S.one', method_id = 'M.one') => ({ scenario_id, method_id, evidence: '实际解答' });
const route = steps => ({ user_message_id: 'u1', question_index: 1, paths: [{ steps }], steps });
const record = (answerId, seq, immediate, routes, status = 'done') => ({ source_message_id: answerId, seq, status,
  payload: JSON.stringify({ source: { userMessageId: immediate }, questionRoutes: routes }) });

test('answer footers keep historical route snapshots and suppress an ordinary followup', () => {
  const users = [{ id: 'u1', is_math_question: 1 }, { id: 'u2', is_math_question: 0 }, { id: 'u3', is_math_question: 0 }];
  const first = route([step()]);
  const updated = route([step(), step('S.two', 'M.two')]);
  const rows = answerRouteSnapshots([record('a1', 1, 'u1', [first]), record('a2', 3, 'u2', [first]), record('a3', 5, 'u3', [updated])], users);
  assert.deepEqual(rows.map(row => row.answerId), ['a1', 'a3']);
  assert.equal(rows[0].routes[0].steps.length, 1);
  assert.equal(rows[0].updatedBy, 'a3');
  assert.equal(rows[1].routes[0].steps.length, 2);
  assert.equal(rows[1].updated, true);
  assert.equal(first.steps.length, 1);
});

test('answer snapshots reject deleted anchors and distinguish pending, failed, empty and legacy records', () => {
  const users = [{ id: 'u1', is_math_question: 1 }, { id: 'chat', is_math_question: 0 }];
  const rows = answerRouteSnapshots([record('pending', 1, 'u1', [], 'pending'), record('failed', 2, 'u1', [], 'failed'),
    record('empty', 3, 'u1', []), record('legacy', 4, 'u1', []), record('chat-a', 5, 'chat', []),
    record('deleted-a', 6, 'deleted', [route([step()])])], users, [{ message_id: 'legacy', ...step() }]);
  assert.deepEqual(rows.map(row => row.status), ['pending', 'failed', 'done', 'done']);
  assert.equal(rows[2].routes.length, 0);
  assert.equal(rows[3].ordered, false);
  assert.equal(rows[3].routes[0].steps[0].method_id, 'M.one');
});

function harness() {
  const writes = [];
  let state = { storageInitialized: true, dataOperation: null, conversationLoading: false, learnerId: 'learner', streamingCount: 0,
    currentConversationId: 'c1', modelConfig: {}, conversations: [{ id: 'c1', loaded: true, messages: [
      { id: 'u1', role: 'user', content: '原题', status: 'complete' }, { id: 'a1', role: 'assistant', content: '实际解答', status: 'complete' },
    ] }], flushStorage: async () => {}, newConversation: () => { state = { ...state, currentConversationId: 'review-chat',
      conversations: [{ id: 'review-chat', messages: [] }, ...state.conversations] }; } };
  const store = { getState: () => state, setState: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } };
  const question = { question: '新题', solution: '解答', entranceScenarioId: 'S.one', questionKey: 'new',
    routes: [{ preferred: true, valid: true, steps: [{ scenarioId: 'S.one', methodId: 'M.one' }] }],
    metadata: { reviewStatus: 'worked_example_checked', learning: { goal: '具体目标' } } };
  const dependencies = { skeleton: {}, matching: { findRelatedPractice: async () => ({ target: { scenarioId: 'S.one', methodId: 'M.one', questions: [question] }, question }) },
    database: { loadAnswerQuestionRoutes: async () => [{ answerId: 'a1', messageId: 'u1', ordered: true, routes: [route([step()])] }],
      loadPracticeUsage: async () => [], createPracticeRun: async input => { writes.push(input); return { items: [{ id: 'new-item' }] }; },
      loadPracticeItem: async () => ({ question }), listPracticeReviews: async () => [{ id: 'r1', sourceItemId: 'old-item', status: 'pending' }] } };
  return { store, dependencies, writes };
}

test('a footer action binds the exact original answer and persists the linked card', async () => {
  const h = harness();
  const result = await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies);
  assert.equal(result.ok, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].chat.sourceMessageId, 'u1');
  assert.equal(h.writes[0].items[0].metadata.learning.provenance.answerId, 'a1');
  assert.equal(h.store.getState().conversations[0].messages.at(-1).practiceItemId, 'new-item');
});

test('ambiguous routes and missing precision never silently choose another route', async () => {
  const h = harness();
  h.dependencies.database.loadAnswerQuestionRoutes = async () => [{ answerId: 'a1', messageId: 'u1', ordered: true,
    routes: [{ ...route([step()]), paths: [{ steps: [step()] }, { steps: [step('S.two', 'M.two')] }] }] }];
  assert.equal((await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies)).ok, false);
  assert.equal(h.writes.length, 0);
  h.dependencies.database.loadAnswerQuestionRoutes = async () => [];
  assert.equal((await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies)).ok, false);
  assert.equal(h.writes.length, 0);
});

test('navigation during matching preserves the new page and does not insert an old-context card', async () => {
  const h = harness();
  let release;
  const selected = h.dependencies.matching.findRelatedPractice;
  h.dependencies.matching.findRelatedPractice = async input => { await new Promise(resolve => { release = resolve; }); return selected(input); };
  const pending = startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  h.store.setState({ currentConversationId: 'another' }); release();
  assert.equal((await pending).ok, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.getState().currentConversationId, 'another');
});

test('failed persistence keeps the original question and leaves an explicit failed card', async () => {
  const h = harness();
  h.store.setState({ flushStorage: async () => { throw new Error('disk'); } });
  assert.equal((await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies)).ok, false);
  assert.equal(h.writes.length, 0);
  const messages = h.store.getState().conversations[0].messages;
  assert.equal(messages[0].content, '原题');
  assert.equal(messages.at(-1).status, 'error');
});

test('switching areas in the same chat during matching does not pull the user back', async () => {
  const h = harness();
  h.store.setState({ route: 'main', activeArea: 'ask' });
  const selected = h.dependencies.matching.findRelatedPractice;
  h.dependencies.matching.findRelatedPractice = async input => { h.store.setState({ activeArea: 'trail' }); return selected(input); };
  assert.equal((await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies)).ok, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.getState().activeArea, 'trail');
});

test('a voluntarily scheduled review opens a separate chat without linking a foreign user message', async () => {
  const h = harness();
  assert.equal((await startRelatedPractice(h.store, { sourceItemId: 'old-item', reviewId: 'r1' }, h.dependencies)).ok, true);
  assert.equal(h.writes[0].chat.conversationId, 'review-chat');
  assert.equal(h.writes[0].chat.sourceMessageId, null);
  assert.equal(h.writes[0].items[0].metadata.learning.reviewId, 'r1');
  assert.equal(h.store.getState().conversations.find(c => c.id === 'c1').messages.length, 2);
});

test('continuing a card uses its saved origin even after another question in the chat', async () => {
  const h = harness();
  const conversation = h.store.getState().conversations[0];
  conversation.messages.push({ id: 'u-other', role: 'user', content: '另一题' }, { id: 'card', role: 'assistant', practiceItemId: 'old-item' });
  const read = h.dependencies.database.loadPracticeItem;
  h.dependencies.database.loadPracticeItem = async () => ({ ...await read(), source: { sourceMessageId: 'u1', conversationId: 'c1' } });
  assert.equal((await startRelatedPractice(h.store, { sourceItemId: 'old-item' }, h.dependencies)).ok, true);
  assert.equal(h.writes[0].chat.sourceMessageId, 'u1');
});

test('navigation during the second review check cannot create a new chat', async () => {
  const h = harness(); h.store.setState({ route: 'main', activeArea: 'practice' });
  let reads = 0;
  h.dependencies.database.listPracticeReviews = async () => {
    if (++reads === 2) h.store.setState({ activeArea: 'trail' });
    return [{ id: 'r1', sourceItemId: 'old-item', status: 'pending' }];
  };
  assert.equal((await startRelatedPractice(h.store, { sourceItemId: 'old-item', reviewId: 'r1' }, h.dependencies)).ok, false);
  assert.equal(h.store.getState().activeArea, 'trail'); assert.equal(h.writes.length, 0);
});

test('a committed card is reconciled even when another foreground answer starts meanwhile', async () => {
  const h = harness(), create = h.dependencies.database.createPracticeRun;
  h.dependencies.database.createPracticeRun = async input => {
    const result = await create(input); h.store.setState({ streamingCount: 1 }); return result;
  };
  assert.equal((await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies)).ok, true);
  const card = h.store.getState().conversations[0].messages.at(-1);
  assert.equal(card.status, 'complete'); assert.equal(card.practiceItemId, 'new-item');
});

test('stopping after the local transaction commits cannot leave an endless streaming placeholder', async () => {
  const h = harness(), create = h.dependencies.database.createPracticeRun;
  h.dependencies.database.createPracticeRun = async input => {
    const result = await create(input); cancelRelatedPractice('c1'); return result;
  };
  assert.equal((await startRelatedPractice(h.store, { answerId: 'a1', userMessageId: 'u1' }, h.dependencies)).ok, true);
  assert.equal(h.store.getState().conversations[0].messages.at(-1).status, 'complete');
});
