import { isRouteQuestion, routeAssessment } from '../practice/routes.js';

export function assessSelection(question, selectedIds) {
  if (isRouteQuestion(question)) return routeAssessment(question, selectedIds);
  const selected = new Set(selectedIds);
  if (!selected.size) return { outcome: 'uncertain', feedback: '先选出你想到的方法。' };
  const invalidIds = [...selected].filter((id) => !question.applicableMethodIds.includes(id));
  const missing = question.coreMethodIds.filter((id) => !selected.has(id));
  if (invalidIds.length) return { outcome: 'wrong', feedback: question.methodReasons?.[invalidIds[0]] || '选到本题不适用的方法了，再看一下它的适用前提。' };
  if (missing.length) return { outcome: 'wrong', feedback: `还漏了一个核心方法：${question.methodReasons?.[missing[0]] || '再看一下题面里的条件。'}` };
  return { outcome: 'right', feedback: `主要方法都想到了。${question.methodReasons?.[question.coreMethodIds[0]] || '选到的其他方法也适用。'}` };
}
