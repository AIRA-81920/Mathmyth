// Keep the reading position while exploring related methods and scenarios.
// It is shared for this trail lifecycle, not bound to individual chat IDs.
const views = new Map();
let currentEpoch;
function ensureEpoch(epoch) {
  if (currentEpoch !== epoch) { currentEpoch = epoch; views.clear(); }
}
export function readKnowledgeView(key, epoch) {
  ensureEpoch(epoch);
  return { ...views.get(key) };
}
export function saveKnowledgeView(key, epoch, patch) {
  ensureEpoch(epoch);
  const next = { ...views.get(key), ...patch };
  if (typeof next.scroll !== 'number' || !Number.isFinite(next.scroll) || next.scroll < 0) next.scroll = 0;
  views.set(key, next);
}
