import test from 'node:test';
import assert from 'node:assert/strict';
import { bindHistorySwipe } from '../src/core/ui/historySwipe.js';

function setup() {
  const layer = new EventTarget();
  layer.clientWidth = 390;
  let closed = 0, gestures = 0, enabled = true;
  const cleanup = bindHistorySwipe(layer, {
    enabled: () => enabled, onClose: () => closed++, onGesture: () => gestures++,
  });
  function send(type, x = 100, y = 100, extra = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y, ...extra });
    layer.dispatchEvent(event);
    return event;
  }
  function drag(dx, dy = 0) { send('pointerdown'); send('pointermove', 100 + dx, 100 + dy); send('pointerup', 100 + dx, 100 + dy); }
  return { send, drag, cleanup, disable: () => { enabled = false }, get closed() { return closed }, get gestures() { return gestures } };
}

test('open history dismisses in either horizontal direction and suppresses the resulting click', () => {
  for (const dx of [-120, 120]) {
    const s = setup(); s.drag(dx);
    assert.equal(s.closed, 1); assert.equal(s.gestures, 1);
    assert.equal(s.send('click').defaultPrevented, true);
    s.send('pointerdown'); s.send('pointerup');
    assert.equal(s.send('click').defaultPrevented, false);
    s.cleanup();
  }
});

test('short drags, vertical scrolling, taps, cancellation, and disabled overlays never dismiss', () => {
  for (const [dx, dy] of [[30, 0], [20, 160], [0, 0]]) {
    const s = setup(); s.drag(dx, dy); assert.equal(s.closed, 0); s.cleanup();
  }
  const s = setup();
  s.send('pointerdown'); s.send('pointermove', 220); s.send('pointercancel'); s.send('pointerup', 220);
  assert.equal(s.closed, 0);
  s.disable(); s.drag(150); assert.equal(s.closed, 0);
  s.cleanup();
});

test('vertical intent stays scrolling even if the finger later moves sideways', () => {
  const s = setup(); s.send('pointerdown');
  assert.equal(s.send('pointermove', 110, 200).defaultPrevented, false);
  s.send('pointermove', 300, 200); s.send('pointerup', 300, 200);
  assert.equal(s.closed, 0); assert.equal(s.gestures, 0); s.cleanup();
});

test('secondary pointers cancel a gesture and disposal removes event handlers', () => {
  const s = setup(); s.send('pointerdown');
  s.send('pointerdown', 120, 100, { pointerId: 2, isPrimary: false });
  s.send('pointermove', 250); s.send('pointerup', 250); assert.equal(s.closed, 0);
  s.cleanup(); s.drag(150); assert.equal(s.closed, 0);
});
