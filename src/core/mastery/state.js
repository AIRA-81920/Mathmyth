export function applyPractice(previous, { targetType, right, face, now = new Date().toISOString() }) {
  const current = previous ?? { state: 'exposed', successCount: 0, faces: [] };
  let successCount = current.successCount;
  let state = current.state;
  const faces = new Set(current.faces);
  if (right) {
    successCount += 1;
    faces.add(face);
    const threshold = targetType === 'scenario' ? 3 : 2;
    state = successCount >= threshold && faces.size >= threshold ? 'mastered' : 'consolidating';
  } else {
    if (state === 'mastered') successCount = Math.max(0, successCount - 1);
    state = 'consolidating';
  }
  return { state, successCount, faces: [...faces], updatedAt: now };
}
