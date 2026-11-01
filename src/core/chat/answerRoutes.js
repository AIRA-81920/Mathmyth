import { routePaths } from './questionRoutes.js';

const signature = route => JSON.stringify([route.question_index,
  routePaths(route).map(path => path.steps.map(step => [step.scenario_id, step.method_id ?? null]))]);

// Keep the route snapshot beside the answer which actually supplied it. The
// older user-level aggregation remains available for knowledge navigation.
// 任务迟迟没有结论（pending/running 超过这个时间）就算"卡住"：
// 界面据此给出"重新整理"，不再让用户永远看着"整理中"。
export const STALL_MS = 2 * 60 * 1000;
function isStalled(record, now, payload) {
  if (record.status === 'done' || record.status === 'failed') return false;
  const createdAt = Date.parse(payload?.requeuedAt ?? record.created_at ?? '');
  return Number.isFinite(createdAt) ? now - createdAt > STALL_MS : false;
}

export function answerRouteSnapshots(records, users, encounters = [], now = Date.now()) {
  const byUser = new Map(users.map(user => [user.id, user]));
  const latest = new Map(), output = [];
  for (const record of [...records].sort((a, b) => a.seq - b.seq)) {
    let payload;
    try { payload = JSON.parse(record.payload); } catch { continue; }
    if (payload?.classificationOnly) continue;
    const immediateId = payload?.source?.userMessageId;
    const immediate = byUser.get(immediateId);
    if (!immediate) continue;
    const groups = new Map();
    for (const route of Array.isArray(payload.questionRoutes) ? payload.questionRoutes : []) {
      if (!byUser.has(route.user_message_id)) continue;
      const group = groups.get(route.user_message_id) ?? [];
      group.push(route); groups.set(route.user_message_id, group);
    }
    if (!groups.size && immediate.is_math_question !== 0) groups.set(immediateId, []);
    for (const [messageId, routes] of groups) {
      const user = byUser.get(messageId);
      let ordered = routes.length > 0, visibleRoutes = routes;
      if (!ordered && record.status === 'done') {
        const linked = encounters.filter(entry => entry.message_id === record.source_message_id);
        if (linked.length) visibleRoutes = [{ user_message_id: messageId, question_index: 1,
          steps: linked.map(entry => ({ scenario_id: entry.scenario_id, method_id: entry.method_id })) }];
      }
      const key = visibleRoutes.map(signature).join('|');
      const previous = latest.get(messageId);
      const updated = messageId !== immediateId;
      // An explanation of an existing step must not manufacture a new task.
      if (updated && (!ordered || previous?.key === key)) continue;
      const item = { answerId: record.source_message_id, messageId, status: record.status,
        isMathQuestion: user.is_math_question === null ? null : Boolean(user.is_math_question),
        ordered, routes: structuredClone(visibleRoutes), updated, stalled: isStalled(record, now, payload) };
      if (record.status === 'done' && visibleRoutes.length) {
        if (previous && previous.key !== key) previous.item.updatedBy = item.answerId;
        latest.set(messageId, { key, item });
      }
      output.push(item);
    }
  }
  return output;
}
