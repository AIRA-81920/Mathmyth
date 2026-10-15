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

// Revisions share a turn, while every version keeps its own continuation.
// Paths contain message IDs only; text, attachments and evidence stay intact.
export function revisionVersions(messages, userId) {
  const users = new Map(messages.filter(m => m.role === 'user').map(m => [m.id, m]));
  function root(id) {
    const seen = new Set();
    while (users.get(id)?.revisionOf && users.has(users.get(id).revisionOf) && !seen.has(id)) {
      seen.add(id); id = users.get(id).revisionOf;
    }
    return id;
  }
  const key = root(userId);
  return messages.filter(m => m.role === 'user' && root(m.id) === key)
    .sort((a, b) => Number(b.id === key) - Number(a.id === key));
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
  for (const message of messages) if (message.role === 'user' && active.has(message.id)
    && (message.id === extraId || revisionVersions(messages, message.id).length > 1)) paths[message.id] = [...activeIds];
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
