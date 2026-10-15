export const SWIPE_START_PX = 10;
export const SWIPE_SETTLE_MS = 180;

// History is the neighbor before Ask, never a shortcut from another area.
export function swipeMode(index, dx) { return index === 0 && dx > 0 ? 'drawer' : 'area'; }
export function commitsHistory(dx, width) { return dx >= Math.max(64, Math.min(96, width * .2)); }

// Waiting for a clear horizontal direction lets normal page scrolling continue.
export function swipeIntent(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_START_PX) return 'waiting';
  if (Math.abs(dy) > Math.abs(dx) * 1.15) return 'vertical';
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return 'horizontal';
  return 'waiting';
}

export function swipeCommitIndex(index, count, dx, width) {
  const threshold = Math.max(64, Math.min(112, width * .22));
  if (Math.abs(dx) < threshold) return index;
  return Math.max(0, Math.min(count - 1, index + (dx < 0 ? 1 : -1)));
}

export function swipeOffset(index, count, dx) {
  return (index === 0 && dx > 0) || (index === count - 1 && dx < 0) ? dx * .24 : dx;
}

export function blocksAreaSwipe(target, boundary) {
  if (!target?.closest || !boundary?.contains(target)) return true;
  if (globalThis.getSelection?.()?.isCollapsed === false) return true;
  if (target.closest('button, a, input, textarea, select, label, [contenteditable="true"], [role="dialog"], [role="menu"], [data-no-area-swipe]')) return true;
  for (let node = target; node && node !== boundary; node = node.parentElement) {
    // Formula/table/photo strips retain their own horizontal pan gestures.
    if (node.scrollWidth > node.clientWidth + 2) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}
