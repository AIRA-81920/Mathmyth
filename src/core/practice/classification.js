export const taskKinds = Object.freeze({ compute: '求值或求表达式', prove: '证明', determine_parameter: '反求参数',
  decide_property: '判断性质', classify_or_compare: '分类或比较', describe_or_construct: '描述或构造', verify: '验证给定对象' });
const text = value => typeof value === 'string' && value.trim().length > 0;

// Suggestions are deliberately labelled inferred. They are not a semantic
// proof and are not used to grant mastery or execute mathematical operations.
export function suggestTasks(question) {
  const value = String(question ?? ''), tasks = new Set();
  if (/验证|验算|检验.*(?:解|方程)/u.test(value)) tasks.add('verify');
  else if (/证明|证[：:]|证下列/u.test(value)) tasks.add('prove');
  if (/求.*(?:参数|常数|系数)|确定.*(?:参数|λ)|使.*(?:连续|可导|全微分)|求实常数/u.test(value)) tasks.add('determine_parameter');
  if (/敛散|收敛域|是否|间断|连续性|可导性|可微性|判断|讨论.*(?:连续|可导|可微)/u.test(value)) tasks.add('decide_property');
  if (/指明类型|比较|分类|判断.*阶/u.test(value)) tasks.add('classify_or_compare');
  if (/作图|画出|构造.*(?:函数|反例)|求.*投影/u.test(value)) tasks.add('describe_or_construct');
  if (!tasks.size) tasks.add('compute');
  return [...tasks];
}

export function validateTaskDimensions(question) {
  if (!Array.isArray(question.task) || !question.task.length || question.task.some(t => !Object.hasOwn(taskKinds, t))
    || new Set(question.task).size !== question.task.length || !Array.isArray(question.overlays)) throw new Error('任务与叠加条件无效。');
  for (const item of question.overlays) {
    if (!item || !['parameter','domain','given_fact'].includes(item.kind) || !text(item.description)) throw new Error('叠加条件缺少类型或依据。');
    if (item.kind === 'parameter' && (!['unknown','given','auxiliary'].includes(item.role) || !Array.isArray(item.symbols)
      || !item.symbols.length || item.symbols.some(s => !text(s) || !/^[\p{L}][\p{L}\p{N}_]*$/u.test(s)) || !text(item.domain))) throw new Error('参数身份或定义域无效。');
  }
  return question;
}

export function withTaskDimensions(question) {
  const supplied = question.task != null;
  const result = { ...question, task: supplied ? question.task : suggestTasks(question.question), overlays: question.overlays ?? [],
    classificationReview: question.classificationReview ?? { status: supplied ? 'declared' : 'inferred',
      needsReview: true, basis: supplied ? '题库提供的任务声明，尚未独立核对。' : '按题面文字给出的加工建议，不能视为已审核分类。',
      overlaysComplete: false } };
  validateTaskDimensions(result);
  return result;
}
