// Keep old message IDs, answers and learning evidence intact. Only the active
// branch is used as model context and shown in the ordinary conversation flow.
export function visibleMessages(messages = []) {
  return messages.filter((message) => !message.superseded);
}

export function revisionHistory(messages, message) {
  if (!message?.revisionOf) return [];
  const start = messages.findIndex((item) => item.id === message.revisionOf);
  const end = messages.findIndex((item) => item.id === message.id);
  if (start < 0 || end <= start) return [];
  return messages.slice(start, end).filter((item) => item.superseded);
}

export function branchBefore(messages, userId) {
  const index = messages.findIndex((message) => message.id === userId && message.role === 'user' && !message.superseded);
  if (index < 0) return null;
  return messages.map((message, position) => position < index || message.superseded ? message : { ...message, superseded: true });
}

// E3：整会话一次性建索引。单次 revisionVersions 是 O(n)，而渲染期会对每条 user
// 消息各调用一次（合计 O(n·u)），发送消息时 captureRevisionPaths 里还会再叠加
// 一层同样的开销。这里把"同一版本的问答集合"一次算好，之后按 id 查表即可。
export function revisionIndex(messages = []) {
  const users = new Map();
  for (const message of messages) if (message.role === 'user') users.set(message.id, message);
  const roots = new Map();
  const root = (id) => {
    if (roots.has(id)) return roots.get(id);
    const seen = [];
    let current = id;
    while (users.get(current)?.revisionOf && users.has(users.get(current).revisionOf) && !seen.includes(current)) {
      seen.push(current); current = users.get(current).revisionOf;
    }
    // 路径压缩：同一条链上走过的每个节点都直接指向最终根。
    for (const visited of seen) roots.set(visited, current);
    roots.set(id, current);
    return current;
  };
  const grouped = new Map();
  for (const id of users.keys()) {
    const key = root(id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(users.get(id));
  }
  const versions = new Map();
  for (const [key, list] of grouped) {
    const ordered = list.slice().sort((a, b) => Number(b.id === key) - Number(a.id === key));
    for (const message of ordered) versions.set(message.id, ordered);
  }
  return { rootOf: root, versionsOf: (id) => versions.get(id) ?? [] };
}

// Revisions share a turn, while every version keeps its own continuation.
// Paths contain message IDs only; text, attachments and evidence stay intact.
export function revisionVersions(messages, userId) {
  return revisionIndex(messages).versionsOf(userId);
}

export function normalizeRevisionPaths(value, messages) {
  const ids = new Set(messages.map(m => m.id)), users = new Set(messages.filter(m => m.role === 'user').map(m => m.id));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, path]) => users.has(id) && Array.isArray(path)
    && path.includes(id) && path.every(key => typeof key === 'string' && ids.has(key)) && new Set(path).size === path.length)
    .map(([id, path]) => [id, [...path]]));
}

function remember(messages, paths, activeIds, extraId) {
  const active = new Set(activeIds);
  // E3：一次建索引后循环查表，取代"每个 active user 消息各扫一遍全量消息"。
  const index = revisionIndex(messages);
  for (const message of messages) if (message.role === 'user' && active.has(message.id)
    && (message.id === extraId || index.versionsOf(message.id).length > 1)) paths[message.id] = [...activeIds];
  return paths;
}

// Upgrade the earlier append-only edit history without discarding any turns.
function inferRevisionPaths(messages) {
  const paths = {};
  let active = [];
  for (const message of messages) {
    if (message.role === 'user' && message.revisionOf) {
      remember(messages, paths, active);
      const parent = active.includes(message.revisionOf) ? active : paths[message.revisionOf] ?? [];
      const index = parent.indexOf(message.revisionOf);
      if (index >= 0) active = parent.slice(0, index);
    }
    active.push(message.id);
  }
  return remember(messages, paths, active);
}

export function captureRevisionPaths(messages, previous = {}, extraId) {
  const paths = { ...inferRevisionPaths(messages), ...normalizeRevisionPaths(previous, messages) };
  return remember(messages, paths, visibleMessages(messages).map(m => m.id), extraId);
}

export function selectRevision(messages, previous, userId) {
  const paths = captureRevisionPaths(messages, previous);
  const path = paths[userId];
  if (!path) return null;
  const selected = new Set(path);
  // Preserve chronological archive order and stable version numbering.
  const next = messages.map(m => ({ ...m, superseded: !selected.has(m.id) }));
  return { messages: next, revisionPaths: normalizeRevisionPaths(paths, next) };
}
