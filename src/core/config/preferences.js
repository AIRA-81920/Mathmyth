import { normalizeLightTemperature } from '../ui/lightTemperature.js';
export const themeModes = ['system', 'light', 'dark'];
export function normalizePreferences(value = {}) {
  const expanded = Object.fromEntries(Object.entries(value.trailExpanded ?? {}).filter(([key, open]) => typeof key === 'string' && key.length < 180 && open === true));
  return { theme: themeModes.includes(value.theme) ? value.theme : 'system', lightTemperature: normalizeLightTemperature(value.lightTemperature), trailExpanded: expanded,
    answerThinking: ['auto', 'enabled', 'disabled'].includes(value.answerThinking) ? value.answerThinking : 'auto',
    trailScroll: Number.isFinite(value.trailScroll) ? Math.max(0, value.trailScroll) : 0 };
}
