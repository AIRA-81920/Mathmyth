import { normalizeLightTemperature } from '../ui/lightTemperature.js';
import { normalizeSubject } from './subject.js';
export const themeModes = ['system', 'light', 'dark'];
export function normalizePreferences(value = {}) {
  const expanded = Object.fromEntries(Object.entries(value.trailExpanded ?? {}).filter(([key, open]) => typeof key === 'string' && key.length < 180 && open === true));
  // subject 存进 ui_preferences：复用现有设置表，不需要数据库迁移；
  // 缺省为高数，保证老数据打开后与升级前一致。
  return { theme: themeModes.includes(value.theme) ? value.theme : 'system', lightTemperature: normalizeLightTemperature(value.lightTemperature), trailExpanded: expanded,
    answerThinking: ['auto', 'enabled', 'disabled'].includes(value.answerThinking) ? value.answerThinking : 'auto',
    subject: normalizeSubject(value.subject),
    trailScroll: Number.isFinite(value.trailScroll) ? Math.max(0, value.trailScroll) : 0 };
}
