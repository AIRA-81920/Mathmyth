import data from '../../assets/knowledge/patterns.json' with { type: 'json' };
import { createPatternIndex, matchingPatternLinks } from './patternSchema.js';

const indexes = new WeakMap();
function index(skeleton) {
  if (!indexes.has(skeleton)) indexes.set(skeleton, createPatternIndex(skeleton, data));
  return indexes.get(skeleton);
}

export function patternsForScenario(skeleton, id) {
  return data.patterns.some((pattern) => pattern.scenarioIds.includes(id)) ? index(skeleton).byScenario.get(id) ?? [] : [];
}
export function patternsForMethod(skeleton, id) {
  return data.patterns.some((pattern) => pattern.methodIds.includes(id)) ? index(skeleton).byMethod.get(id) ?? [] : [];
}
export function reviewedPatternLinks(question) {
  return matchingPatternLinks(question, data.questionLinks);
}

export function validPatternEvidence(question, evidence, executedEdges, studentSteps) {
  if (!Array.isArray(evidence) || !Array.isArray(executedEdges) || typeof studentSteps !== 'string') return [];
  const links = reviewedPatternLinks(question);
  return evidence.filter((entry) => entry && typeof entry.studentExcerpt === 'string' && entry.studentExcerpt.trim()
    && studentSteps.includes(entry.studentExcerpt) && typeof entry.explanation === 'string' && entry.explanation.trim()
    && links.some((link) => link.patternId === entry.patternId && link.routeId === entry.routeId && link.stepIndex === entry.stepIndex
      && executedEdges.some((edge) => edge && edge.scenarioId === link.scenarioId && edge.methodId === link.methodId
        && typeof edge.studentExcerpt === 'string' && studentSteps.includes(edge.studentExcerpt))));
}

// Progress is evidence at a specific pattern/method, never inherited from broad mastery.
export function summarizePatternProgress(records, links = data.questionLinks) {
  const summary = new Map();
  for (const record of records) {
    const question = record.question, answer = record.answer;
    if (!answer) continue;
    const matched = matchingPatternLinks(question, links);
    if (!matched.length) continue;
    const attempts = [...(answer.attemptHistory ?? [])];
    if (!attempts.length && answer.mode) attempts.push(answer);
    for (const link of matched) {
      const id = `${link.patternId}:${link.methodId}`;
      if (!summary.has(id)) summary.set(id, { patternId: link.patternId, methodId: link.methodId,
        seen: false, recognitionKeys: new Set(), executionKeys: new Set() });
      const item = summary.get(id);
      // A preloaded round is not an encounter. Selection only concerns its entrance.
      if (answer.revealed || answer.assisted || attempts.some((attempt) => link.stepIndex === 0 && ['selection', 'steps'].includes(attempt.mode))) item.seen = true;
      for (const attempt of attempts) {
        if (attempt.independent !== true || attempt.revealed || attempt.assisted || attempt.outcome !== 'right') continue;
        if (attempt.mode === 'selection' && link.stepIndex === 0 && attempt.selectedIds?.includes(link.routeId)) {
          item.seen = true; item.recognitionKeys.add(question.questionKey);
        }
        if (attempt.mode === 'steps' && (attempt.patternEvidence ?? []).some((evidence) => evidence && evidence.patternId === link.patternId
          && evidence.routeId === link.routeId && evidence.stepIndex === link.stepIndex
          && validEvidenceForLink(evidence, attempt, link))) {
          item.seen = true; item.executionKeys.add(question.questionKey);
        }
      }
    }
  }
  return [...summary.values()].filter((item) => item.seen).map((item) => ({ patternId: item.patternId, methodId: item.methodId,
    seen: item.seen, recognitionKeys: [...item.recognitionKeys], executionKeys: [...item.executionKeys] }));
}

function validEvidenceForLink(evidence, attempt, link) {
  return typeof evidence.studentExcerpt === 'string' && evidence.studentExcerpt.trim()
    && typeof attempt.steps === 'string' && attempt.steps.includes(evidence.studentExcerpt)
    && typeof evidence.explanation === 'string' && Boolean(evidence.explanation.trim())
    && attempt.executedEdges?.some((edge) => edge.scenarioId === link.scenarioId && edge.methodId === link.methodId
      && typeof edge.studentExcerpt === 'string' && attempt.steps.includes(edge.studentExcerpt));
}
