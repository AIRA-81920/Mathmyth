import test from 'node:test';
import assert from 'node:assert/strict';
import { thinkingDragProgress } from '../src/core/ui/thinkingSwitch.js';

test('the thinking switch can be dragged in both directions and snaps at the midpoint', () => {
  assert.ok(thinkingDragProgress(false,6)<.5);
  assert.ok(thinkingDragProgress(false,8)>.5);
  assert.ok(thinkingDragProgress(true,-6)>.5);
  assert.ok(thinkingDragProgress(true,-8)<.5);
  assert.equal(thinkingDragProgress(false,100),1);
  assert.equal(thinkingDragProgress(true,-100),0);
  assert.equal(thinkingDragProgress(true,0),1);
  assert.equal(thinkingDragProgress(false,0),0);
});
