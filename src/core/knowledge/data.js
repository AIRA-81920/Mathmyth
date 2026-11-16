import { getActiveSubject } from '../config/subject.js';
import advancedRelations from '../../assets/knowledge/advanced/relations.json' with { type: 'json' };
import advancedPatterns from '../../assets/knowledge/advanced/patterns.json' with { type: 'json' };
import highSchoolRelations from '../../assets/knowledge/high_school/relations.json' with { type: 'json' };
import highSchoolPatterns from '../../assets/knowledge/high_school/patterns.json' with { type: 'json' };

// 跨节点的知识资产（关系、具体结构）必须按学科分开：它们用"骨架里的 id"做端点，
// 拿高数那份去校验高中数学骨架会在第一条上就断链（4.3.2 实机：本题路径出不来、足迹永远空）。
// 骨架对象上带着 subject（见 skeleton/load.js），所以这里不需要再问一次全局状态；
// 只有拿裸骨架做测试时才退回 getActiveSubject()。
const RELATIONS = { advanced: advancedRelations, high_school: highSchoolRelations };
const PATTERNS = { advanced: advancedPatterns, high_school: highSchoolPatterns };
const keyOf = (subject) => (subject === 'high_school' ? 'high_school' : 'advanced');

export function subjectOfSkeleton(skeleton) {
  return keyOf(skeleton?.subject ?? getActiveSubject());
}

export function relationsForSkeleton(skeleton) {
  return RELATIONS[subjectOfSkeleton(skeleton)];
}

export function patternsForSkeleton(skeleton) {
  return PATTERNS[subjectOfSkeleton(skeleton)];
}

export function questionLinksForSkeleton(skeleton) {
  return patternsForSkeleton(skeleton).questionLinks ?? [];
}

export function questionLinksForSubject(subject) {
  return patternsForSkeleton({ subject }).questionLinks ?? [];
}

// 批改这条链路（Worker 里）手里只有题目对象、没有骨架：按母题 id 反查归属学科，
// 这样高中题永远不会套到高数的步骤快照上，也不用把学科一层层往下传。
export function questionLinksForQuestion(question) {
  const id = question?.metadata?.motherId;
  if (!id) return [];
  return [advancedPatterns, highSchoolPatterns]
    .flatMap((file) => (file?.questionLinks ?? []).filter((link) => link.questionId === id));
}
