// Describe only observations stored with each attempt. Later help must not
// rewrite an earlier independent result, and recognition is not execution.
function executionCoverage(item, attempt) {
  const learning = item?.question?.metadata?.learning;
  if (!learning) return { complete: true, matched: 0 };
  const target = item.question.routes?.find(route => route.id === learning.targetRouteId && route.valid);
  if (!target?.steps?.length) return { complete: false, matched: 0 };
  const attempts = attempt ? [attempt] : item.answer?.attemptHistory?.length ? item.answer.attemptHistory : [item.answer];
  const pair = edge => `${edge.scenarioId}\u0000${edge.methodId}`;
  const performed = new Set(attempts.filter(entry => entry?.mode === 'steps' && entry.outcome === 'right' && !entry.disputed)
    .flatMap(entry => (entry.executedEdges ?? []).map(pair)));
  const matched = target.steps.filter(step => performed.has(pair(step))).length;
  return { complete: matched === target.steps.length, matched };
}

export function targetExecutionComplete(item, attempt) {
  return executionCoverage(item, attempt).complete;
}

export function practiceEvidenceSummary(item) {
  const answer = item?.answer;
  const attempts = answer?.attemptHistory?.length ? answer.attemptHistory : answer?.outcome ? [answer] : [];
  if (answer?.disputed) return { done: '你对这次判断提出了异议，原作答与反馈已保留。', pending: '相关能力结论已暂停，之后可以换题继续检查。' };
  const executed = attempts.findLast(entry => entry.mode === 'steps' && entry.outcome === 'right' && !entry.disputed);
  const recognized = attempts.findLast(entry => entry.mode === 'selection' && entry.outcome === 'right' && !entry.disputed);
  if (executed) {
    const supported = executed.revealed || executed.assisted || !executed.independent;
    const recent = Boolean(item.question?.metadata?.learning?.provenance) && !item.question?.metadata?.learning?.reviewId;
    const target = executed.methodIds?.length ? '完成了已提交的关键操作' : '完成了一种数学上成立的解法';
    const coverage = executionCoverage(item);
    return { done: `${supported ? '借助提示、反馈或重试，' : recent ? '在相近讲解之后，没有使用本题提示，' : '这次没有使用本题提示，'}${target}。`,
      pending: !coverage.complete ? coverage.matched ? '目标思路中的其余关键操作尚未检验，可以接着补写。' : '这次解法成立，原来选择的目标思路尚未检验。'
        : item.question?.metadata?.learning?.reviewId ? '这只说明本次表现，更多变化下的稳定使用还需继续观察。' : '尚未检验：间隔后能否独立完成新题。' };
  }
  if (recognized) return { done: `${recognized.revealed || recognized.assisted || !recognized.independent ? '借助本题提示、反馈或重试，' : '这次'}辨认出了可行路线。`, pending: '尚未检验：能否自己写出相应的关键操作。' };
  if (attempts.some(entry => entry.assessmentScope === 'result' && entry.resultCorrect && !entry.disputed)) return {
    done: '已记录这次结果正确，关键过程尚未检验。', pending: '还需要补充关键变形，才能检查相应的操作；没有据此作出掌握结论。' };
  if (attempts.some(entry => entry.outcome === 'wrong')) return { done: '保留了你的尝试和需要修正的位置。', pending: '这一步还需要检查；结束练习不会增加一次错误。' };
  if (attempts.length) return { done: '已保存你的作答，目前的信息还不足以检查关键步骤。', pending: '没有据此作出答错或掌握结论。' };
  return { done: answer?.revealed || answer?.hintLevel ? '已保存这次看过的提示或解答。' : '这次还没有提交作答，已有草稿会保留。',
    pending: '尚未检验：能否自己完成这道题。' };
}

export function nextHintLevel(item) {
  const learning = item?.question?.metadata?.learning;
  const count = learning?.hints?.length ?? 0;
  let next = (item?.answer?.hintLevel ?? 0) + 1;
  // Skip only operations supported by actual submitted execution evidence.
  const executed = new Set(item?.answer?.outcome === 'right' ? (item.answer.executedEdges ?? []).map(edge => edge.methodId) : []);
  while (next <= count && learning?.hintSteps?.[next - 1] && executed.has(learning.hintSteps[next - 1])) next++;
  return next <= count ? next : null;
}
