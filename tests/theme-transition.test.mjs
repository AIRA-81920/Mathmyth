import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionTheme } from '../src/core/ui/themeTransition.js';

test('theme transition retains reduced-motion behavior and applies the chosen theme', () => {
  const previousDocument = globalThis.document, previousMatchMedia = globalThis.matchMedia;
  const classes = new Set();
  const root = { dataset: {}, classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value) } };
  globalThis.document = { documentElement: root, startViewTransition() { throw new Error('motion must be skipped'); } };
  globalThis.matchMedia = () => ({ matches: true });
  let theme;
  try {
    transitionTheme('dark', (next) => { theme = next; });
    assert.equal(theme, 'dark'); assert.equal(root.dataset.theme, 'dark');
    assert.equal(classes.size, 0);
  } finally { globalThis.document = previousDocument; globalThis.matchMedia = previousMatchMedia; }
});

test('rapid theme requests cannot let an older transition overwrite the final choice', async () => {
  const previousDocument = globalThis.document, previousMatchMedia = globalThis.matchMedia;
  const pending = [], selected = [];
  const root = { dataset: {}, classList: { remove() {} }, animate() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.document = { documentElement: root, startViewTransition(commit) {
    pending.push(commit);
    return { skipTransition() {}, ready: Promise.resolve(), finished: Promise.resolve() };
  } };
  try {
    transitionTheme('dark', (next) => selected.push(next));
    transitionTheme('light', (next) => selected.push(next));
    pending[1](); pending[0]();
    await Promise.resolve();
    assert.deepEqual(selected, ['light']); assert.equal(root.dataset.theme, 'light');
  } finally { globalThis.document = previousDocument; globalThis.matchMedia = previousMatchMedia; }
});
