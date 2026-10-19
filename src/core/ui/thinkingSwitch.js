export function thinkingDragProgress(checked, distance, travel = 14) {
  return Math.max(0, Math.min(1, Number(checked) + distance / Math.max(1, travel)));
}
