import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistorySelector } from '../src/core/chat/historySummary.js';
import { practiceChoiceFor } from '../src/core/practice/targetChoice.js';

test('history preserves its snapshot during streamed text and reasoning changes', () => {
  const select = createHistorySelector();
  const conversation = { id: 'c1', title: '求极限', updatedAt: '2026-10-28T01:00:00Z',
    messages: [{ id: 'u1', content: '题目' }, { id: 'a1', content: '', status: 'streaming' }] };
  const first = select({ conversations: [conversation] });
  const streamed = { ...conversation, messages: [conversation.messages[0], { ...conversation.messages[1], content: '推导', reasoningContent: '思考' }] };
  assert.equal(select({ conversations: [streamed] }), first);
  assert.equal(select({ conversations: [{ ...streamed, loaded: false, messageCount: 2, messages: [] }] }), first);
  assert.notEqual(select({ conversations: [{ ...streamed, title: '新的标题' }] }), first);
  assert.equal(select({ conversations: [{ ...streamed, pinned: true }] })[0].pinned, true);
  assert.equal(select({ conversations: [{ ...streamed, messages: [...streamed.messages, { id: 'u2' }] }] })[0].messageCount, 3);
  assert.equal(select({ conversations: [] }).length, 0);
});

test('practice shortcuts select the exact scenario and prefer the method before related scenarios', () => {
  const choices = [{ key: 'a', scenarioId: 's1', methodId: 'm1' }, { key: 'b', scenarioId: 's2', methodId: 'm2' }];
  assert.equal(practiceChoiceFor(choices, { scenarioId: 's2' }).key, 'b');
  assert.equal(practiceChoiceFor(choices, { methodId: 'm2', scenarioIds: ['s1'] }).key, 'b');
  assert.equal(practiceChoiceFor(choices, { methodId: 'm3', scenarioIds: ['s1'] }).key, 'a');
  assert.equal(practiceChoiceFor(choices, { scenarioId: 'missing' }), undefined);
  assert.equal(practiceChoiceFor(choices, { methodId: 'missing' }), undefined);
});
