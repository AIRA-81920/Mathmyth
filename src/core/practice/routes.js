import { canonicalStructure, fingerprintQuestion } from '../mastery/fingerprint.js';
import { withTaskDimensions, validateTaskDimensions } from './classification.js';

export const isRouteQuestion = (question) => question?.format === 'route-v1';
const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());
export const practiceLevels = [
  { id: 'single', name: '找到一条路线', instruction: '选出一条你认为能走通的完整路线。' },
  { id: 'multi', name: '辨别多条路线', instruction: '选出下面所有能走通的路线；只需判断给出的选项。' },
  { id: 'best', name: '比较路线', instruction: '按题目给出的比较标准，选出更合适的一条路线。' },
];

export function routeQuestionError(message = '题目的路线与条件不完整，请换一题。') {
  return Object.assign(new Error(message), { userMessage: message });
}

// Structure validation is separate from mathematical verification. A valid JSON
// chain never makes a model draft into a human-reviewed classical problem.
export function validateRouteQuestion(question, skeleton) {
  if (!isRouteQuestion(question) || !nonempty(question.question) || !nonempty(question.solution)
    || !practiceLevels.some((level) => level.id === question.selectionMode)
    || !Array.isArray(question.routes) || question.routes.length < 3 || question.routes.length > 5
    || !skeleton.scenarioById.has(question.entranceScenarioId)
    || !nonempty(question.metadata?.motherId) || !nonempty(question.metadata?.trainingGoal)
    || !nonempty(question.metadata?.source?.kind) || !nonempty(question.metadata?.reviewStatus)
    || !Array.isArray(question.metadata?.invariants) || !question.metadata.invariants.length
    || question.metadata.invariants.some((value) => !nonempty(value))
    || !Array.isArray(question.metadata?.allowedVariations) || !question.metadata.allowedVariations.length
    || question.metadata.allowedVariations.some((value) => !nonempty(value))
    || !Array.isArray(question.variables) || !question.variables.length
    || question.variables.some((variable) => !/^[A-Za-z]$/.test(variable))
    || new Set(question.variables).size !== question.variables.length
    || !nonempty(question.comparisonCriterion)) throw routeQuestionError();
  canonicalStructure(question.structure);
  if (question.task != null) validateTaskDimensions(question);
  const ids = new Set();
  for (const route of question.routes) {
    if (!nonempty(route.id) || ids.has(route.id) || !nonempty(route.summary) || typeof route.valid !== 'boolean'
      || typeof route.preferred !== 'boolean' || (route.equallyPreferred != null && typeof route.equallyPreferred !== 'boolean')
      || (route.equallyPreferred && !route.valid) || !nonempty(route.reason) || !nonempty(route.condition)
      || !Array.isArray(route.steps) || !route.steps.length || route.steps.length > 6
      || (!route.valid && (!Number.isInteger(route.failedStep) || route.failedStep < 0 || route.failedStep >= route.steps.length))) throw routeQuestionError();
    ids.add(route.id);
    for (const step of route.steps) {
      const scenario = skeleton.scenarioById.get(step.scenarioId);
      if (!scenario?.methods.some((edge) => edge.method_id === step.methodId)
        || !nonempty(step.state) || !nonempty(step.transformedState) || !nonempty(step.condition)) throw routeQuestionError();
    }
    if (route.steps[0].scenarioId !== question.entranceScenarioId) throw routeQuestionError('路线的入口情景与题面不一致。');
  }
  const valid = question.routes.filter((route) => route.valid);
  if (!valid.length || valid.length > 3 || !question.routes.some((route) => !route.valid)
    || valid.filter((route) => route.preferred).length !== 1
    || question.routes.some((route) => route.preferred && !route.valid)) throw routeQuestionError();
  return question;
}

export async function prepareRouteQuestion(question, skeleton, selectionMode = 'single') {
  const copy = withTaskDimensions(structuredClone(question));
  copy.selectionMode = selectionMode;
  for (const route of copy.routes) for (const step of route.steps) step.methodId = skeleton.aliases.get(step.methodId) || step.methodId;
  validateRouteQuestion(copy, skeleton);
  const main = copy.routes.find((route) => route.preferred);
  copy.coreMethodIds = [...new Set(main.steps.map((step) => step.methodId))];
  copy.applicableMethodIds = [...new Set(copy.routes.filter((route) => route.valid).flatMap((route) => route.steps.map((step) => step.methodId)))];
  const scenarioIds = [...new Set(copy.routes.flatMap((route) => route.steps.map((step) => step.scenarioId)))];
  copy.allowedEdges = scenarioIds.flatMap((scenarioId) => skeleton.scenarioById.get(scenarioId).methods.map((edge) => ({ scenarioId, methodId: edge.method_id })));
  copy.candidateMethodIds = [...new Set(copy.allowedEdges.map((edge) => edge.methodId))];
  copy.options = copy.routes.map((route) => ({ id: route.id, name: route.summary }));
  const fingerprint = await fingerprintQuestion(copy);
  // Stable per-question rotation prevents the main route from always being the
  // first answer while preserving historical option snapshots.
  const rotation = parseInt(fingerprint.questionKey.slice(0, 2), 16) % copy.options.length;
  copy.options = [...copy.options.slice(rotation), ...copy.options.slice(0, rotation)];
  return { ...copy, ...fingerprint };
}

export function routeAssessment(question, selectedIds) {
  const selected = [...new Set(selectedIds)];
  if (!selected.length) return { outcome: 'uncertain', feedback: '先选出你认为能走通的路线。', methodIds: [] };
  const routes = selected.map((id) => question.routes.find((route) => route.id === id));
  if (routes.some((route) => !route)) return { outcome: 'wrong', feedback: '这条路线不在当前题的选项中。', methodIds: [] };
  if (question.selectionMode !== 'multi' && selected.length !== 1) return { outcome: 'wrong', feedback: '这一题只需选择一条路线。', methodIds: [] };
  const invalid = routes.find((route) => !route.valid);
  if (invalid) return { outcome: 'wrong', feedback: `这条路线在第 ${invalid.failedStep + 1} 个转折失效：${invalid.reason}`, methodIds: [] };
  if (question.selectionMode === 'multi') {
    const missing = question.routes.filter((route) => route.valid && !selected.includes(route.id));
    if (missing.length) return { outcome: 'wrong', feedback: `所选路线都可行，但还漏了 ${missing.length} 条给出的可行路线。提交后可以展开路线比较。`, methodIds: [] };
    return { outcome: 'right', feedback: '给出的可行路线都辨认出来了，也排除了条件不成立的路线。', methodIds: [] };
  }
  if (question.selectionMode === 'best' && !routes[0].preferred && !routes[0].equallyPreferred) return {
    outcome: 'uncertain', mathematicallyValid: true, feedback: `这条路线能做通。按“${question.comparisonCriterion}”比较，还有更合适的路线；这次不会记作数学错误。${routes[0].reason}`, methodIds: [],
  };
  return { outcome: 'right', feedback: `这条路线能走通。${routes[0].reason}${question.selectionMode === 'single' ? ' 其它正确路线也可以，展开后可作比较。' : ''}`, methodIds: [] };
}

export function entranceMethodIds(question, selectedIds = []) {
  if (!isRouteQuestion(question)) return question.coreMethodIds;
  return [...new Set(question.routes.filter((route) => route.valid && selectedIds.includes(route.id))
    .map((route) => route.steps[0].methodId))];
}

export const selectionPrompt = (question) => isRouteQuestion(question)
  ? question.selectionMode === 'best' ? `按“${question.comparisonCriterion}”，选择更合适的一条路线。`
    : practiceLevels.find((level) => level.id === question.selectionMode)?.instruction
  : '看到这道题，你会想到哪些解法？';
