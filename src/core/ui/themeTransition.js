const DURATION = 180;
let currentTransition = null;
let fallbackTimer = null;
let sequence = 0;

export function transitionTheme(theme, applyTheme, point = {}) {
  const doc = globalThis.document;
  if (!doc) { applyTheme(theme); return; }
  const request = ++sequence;
  const commit = () => { if (request === sequence) { applyTheme(theme); doc.documentElement.dataset.theme = theme; } };
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  currentTransition?.skipTransition();
  clearTimeout(fallbackTimer);
  doc.documentElement.classList.remove('theme-colors-transition');
  if (reduced) { commit(); return; }
  if (!doc.startViewTransition) {
    doc.documentElement.classList.add('theme-colors-transition');
    commit(); fallbackTimer = setTimeout(() => doc.documentElement.classList.remove('theme-colors-transition'), DURATION + 30);
    return;
  }
  const x = Number.isFinite(point.x) ? point.x : globalThis.innerWidth / 2;
  const y = Number.isFinite(point.y) ? point.y : globalThis.innerHeight / 2;
  const radius = Math.hypot(Math.max(x, globalThis.innerWidth - x), Math.max(y, globalThis.innerHeight - y));
  const transition = doc.startViewTransition(commit);
  currentTransition = transition;
  transition.ready.then(() => { if (currentTransition !== transition || sequence !== request) return; return doc.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${Math.ceil(radius)}px at ${x}px ${y}px)`] },
    { duration: DURATION, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
  ); }).catch(() => {});
  transition.finished.catch(() => {}).finally(() => { if (currentTransition === transition) currentTransition = null; });
}
