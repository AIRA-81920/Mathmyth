import test from 'node:test';
import assert from 'node:assert/strict';
import { swipeIntent, swipeCommitIndex, swipeOffset, swipeMode, swipeTravel, commitsHistory } from '../src/core/ui/areaSwipe.js';

test('area swipe waits for direction and never takes a vertical gesture', () => {
  assert.equal(swipeIntent(8, 2), 'waiting');
  assert.equal(swipeIntent(14, 3), 'horizontal');
  assert.equal(swipeIntent(12, 28), 'vertical');
  assert.equal(swipeIntent(16, 15), 'waiting');
});

test('a short drag snaps back while a committed drag moves one adjacent area', () => {
  assert.equal(swipeCommitIndex(0, 3, -65, 390), 0);
  assert.equal(swipeCommitIndex(0, 3, -100, 390), 1);
  assert.equal(swipeCommitIndex(1, 3, -600, 390), 2);
  assert.equal(swipeCommitIndex(1, 3, 100, 390), 0);
  assert.equal(swipeCommitIndex(0, 3, 100, 390), 0);
  assert.equal(swipeCommitIndex(2, 3, -100, 390), 2);
  assert.equal(swipeCommitIndex(0, 3, -90, 640), 0);
});

test('only the outer two area edges resist dragging; interior drags follow the finger', () => {
  assert.equal(swipeOffset(0, 3, 100), 24);
  assert.equal(swipeOffset(2, 3, -100), -24);
  assert.equal(swipeOffset(1, 3, 100), 100);
  assert.equal(swipeOffset(0, 3, -100), -100);
});

test('the tab line finishes exactly one tab of travel when the swipe would commit', () => {
  const span = 390 * .22;
  assert.equal(swipeTravel(0, 3, 0, 390), 0);
  assert.equal(swipeTravel(0, 3, -span / 2, 390), 0.5);
  assert.equal(swipeTravel(0, 3, -span, 390), 1);
  assert.equal(swipeTravel(0, 3, -200, 390), 1);
  assert.equal(swipeTravel(1, 3, span, 390), 0);
  assert.equal(swipeTravel(0, 3, span, 390), 0);
  assert.equal(swipeTravel(2, 3, -span, 390), 2);
  // 不变量：判定换区的那一刻，线正好走满一格（否则抬手会跳一格）。
  assert.equal(swipeCommitIndex(0, 3, -86, 390), 1);
  assert.equal(swipeTravel(0, 3, -86, 390), 1);
  assert.equal(swipeCommitIndex(0, 3, -80, 390), 0);
  assert.ok(swipeTravel(0, 3, -80, 390) < 1);
  assert.equal(swipeCommitIndex(0, 3, -90, 640), 0);
  assert.ok(swipeTravel(0, 3, -90, 640) < 1);
});

test('history opens only past the Ask boundary, never during an ordinary area change', () => {
  assert.equal(swipeMode(0,110),'drawer'); assert.equal(swipeMode(0,-110),'area');
  assert.equal(swipeMode(1,300),'area'); assert.equal(swipeMode(2,300),'area');
  assert.equal(commitsHistory(40,390),false); assert.equal(commitsHistory(100,390),true);
  assert.equal(commitsHistory(-200,390),false);
});
