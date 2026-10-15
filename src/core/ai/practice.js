import { streamAnswer } from './client.js';
import { completeJsonItems } from './partialJson.js';
import { isRouteQuestion, prepareRouteQuestion, routeQuestionError } from '../practice/routes.js';
import { reviewedPatternLinks, validPatternEvidence, patternsForScenario } from '../knowledge/patterns.js';
export { assessSelection } from '../mastery/selection.js';

const nonempty = (value) => typeof value === 'string' && value.trim();
function json(text) {
  try { return JSON.parse(String(text).trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')); }
  catch { throw routeQuestionError('模型返回的练习不完整，请重试或检查模型设置。'); }
}

export async function generatePractice({ config, skeleton, scenarioId, methodId, signal, anchor = '', level = 'single', onItem = () => {}, onProgress = () => {} }) {
  const scenario = skeleton.scenarioById.get(scenarioId);
  if (!scenario?.methods.some((edge) => edge.method_id === methodId)) throw routeQuestionError();
  const systemPrompt = String.raw`你是 Mathmyth 的高数路线练习编写助手。以训练目标和原题为依据，生成恰好三道题：第一道有较短的完整路线；第二道体现方法转化后产生新情景；第三道包含条件变化、相消、分支或替代思路。三题目标一致，不能仅换数字；不要求每条正确路线都包含某个指定方法。不要泄露训练目标到题干、选项标题或提示中。
每道题保留一条主路线、一至两条有效替代路线、一至两条伪路线。每个选项是完整路线摘要，不是单个方法名。多条正确路线允许独立成立，不能把正确但较长的路线判成数学错误。主路线应对应comparisonCriterion中的明确比较标准，例如少求导、少展开、少引入分支；不要笼统说“最好”。伪路线必须有确切失效条件和failedStep，不能只是无关方法。
逐条独立求解并核查所有条件，尤其等价替换在相消减法中的失效、洛必达每次使用前的未定式、除以未知函数时丢失的特殊解、换元定义域和上下限。题目不依赖外部图片或工具。你生成的是尚未人工核对的变式草稿，不得声称教材原题、用户审定或已验证经典题。来源由程序记录。
逐步给出state、scenarioId、methodId、transformedState、condition。每一对scenarioId与methodId必须对应给定骨架连线。第一步scenarioId必须是训练入口情景，后续可进入不同情景。不要用空洞的“识别”步骤伪装某个方法已实际使用；可在真实操作中包含必要代数整理，不编造ID。routes所有字段必填，valid/preferred为布尔；伪路线另加failedStep（从0开始）。
简洁中文Markdown和KaTeX的$...$、$$...$$，JSON中的反斜杠正确转义。variables为实际单字母变量列表。structure为真实运算树{op:"小写英文运算名",args:[子节点]}，变量叶{op:"var"}、常数叶{op:"const"}，不写数值、变量名、题目ID。
仅返回JSON：{"items":[{"question":"题面","solution":"关键推导与结论","variables":["x"],"structure":{"op":"divide","args":[{"op":"var"},{"op":"var"}]},"comparisonCriterion":"明确比较目标","routes":[{"id":"r1","summary":"完整路线摘要","valid":true,"preferred":true,"condition":"总适用条件","reason":"具体可行或失效依据","steps":[{"state":"当前结构","scenarioId":"S.xxx","methodId":"M.xxx","transformedState":"新结构或结论","condition":"本步骤前提"}]}],"invariants":["不可改变的条件"],"allowedVariations":["相对母题改变了什么"]}]}。每个题对象完整结束后再输出下一个，以便先交付第一题。`;
  const graph = [...skeleton.scenarioById.values()].map((entry) => ({ id: entry.id, name: entry.name, methods: entry.methods.map((edge) => edge.method_id) }));
  const methods = [...skeleton.methodById.values()].map((entry) => ({ id: entry.id, name: entry.name, preconditions: entry.preconditions }));
  const items = [];
  let raw = '', queued = 0, serial = Promise.resolve(), failed;
  const watchdog = new AbortController();
  const stop = () => watchdog.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const firstItemTimer = setTimeout(() => watchdog.abort(), 60000);
  const draftId = `ai-${globalThis.crypto.randomUUID()}`;
  try {
    const answer = await streamAnswer({ config, systemPrompt, signal: watchdog.signal,
      messages: [{ role: 'user', content: JSON.stringify({ target: { scenarioId, scenario: scenario.name, definition: scenario.definition, signals: scenario.signals,
        example_problems: scenario.recognition_examples, reference_method_id: methodId }, source_question: anchor || null, scenario_method_graph: graph, methods }) }],
      onDelta: (delta) => {
        raw += delta; onProgress('正在编写路线变式…');
        let complete;
        try { complete = completeJsonItems(raw); } catch { return; }
        while (queued < Math.min(complete.length, 3)) {
          const input = complete[queued++];
          const sequence = queued;
          serial = serial.then(async () => {
            const question = await prepareRouteQuestion({ ...input, format: 'route-v1', entranceScenarioId: scenarioId,
              metadata: { motherId: `${draftId}-${sequence}`, trainingGoal: `识别${scenario.name}后的可行路线`,
                source: { kind: 'ai_variant', label: 'AI 变式草稿', reference: anchor ? '当前接触过的原题' : '骨架识别例题' },
                reviewStatus: 'model_unverified', userApprovedClassic: false, contentVersion: 1, sourceQuestion: anchor || null,
                invariants: input.invariants, allowedVariations: input.allowedVariations,
              } }, skeleton, level);
            if (items.some((entry) => entry.questionKey === question.questionKey)) throw routeQuestionError('模型重复生成了同一道题。');
            if (watchdog.signal.aborted) return;
            clearTimeout(firstItemTimer);
            await onItem(question, items.length);
            items.push(question);
          }).catch((error) => { failed = error; watchdog.abort(); });
        }
      } });
    const output = json(answer);
    await serial;
    if (failed) throw failed;
    if (!Array.isArray(output.items) || output.items.length !== 3 || items.length !== 3) throw routeQuestionError();
  } catch (error) {
    await serial;
    if (failed) throw failed;
    if (watchdog.signal.aborted && !signal?.aborted) throw routeQuestionError('第一道题超过一分钟未生成，已准备好的本地题可以立即使用。');
    throw error;
  } finally { clearTimeout(firstItemTimer); signal?.removeEventListener('abort', stop); }
  return items;
}

export async function assessSteps({ config, question, steps, skeleton, signal }) {
  if (!nonempty(steps)) return { outcome: 'uncertain', feedback: '先写下你打算怎么做。', methodIds: [] };
  const routeBased = isRouteQuestion(question);
  const patternLinks = reviewedPatternLinks(question);
  const patternContext = patternLinks.map((link) => {
    const pattern = patternsForScenario(skeleton, link.scenarioId).find((entry) => entry.id === link.patternId);
    return { pattern_id: link.patternId, route_id: link.routeId, step_index: link.stepIndex,
      method_id: link.methodId, scenario_id: link.scenarioId, name: pattern.name,
      signals: pattern.signals, first_step: pattern.firstStep, conditions: pattern.conditions };
  });
  const blocks = new Set((question.allowedEdges ?? []).map((edge) => skeleton.scenarioById.get(edge.scenarioId)?.block_id));
  const methods = [...skeleton.methodById.values()].filter((method) => question.candidateMethodIds.includes(method.id)
    || method.block_ids?.some((block) => blocks.has(block)));
  const systemPrompt = `你是高数关键步骤批改助手。先判断学生的数学操作是否成立，再整理能记录的执行证据。这两个判断分开：参考路线不是全部正确解法，allowed_edges也不是数学正确性的白名单。正确思路即使暂时没有对应连线，也应判right，不能因此判uncertain或wrong。
支持大白话、口头运算和不规范但意思明确的公式。结合题目与上下文判断分子、分母和括号，不按代码运算符的左结合规则机械解释。比如学生说“分母凑成3x，前面乘3，用sinx/x的重要极限，3乘1等于3”，已经描述了sin(3x)/x=3·sin(3x)/(3x)，在x→0时是正确关键步骤；可以提醒给3x加括号，但不能说没有实际操作。不要求学生重复题目已给的x→0等条件，也不要求把每行推导、每个符号都写全。
只写方法名或照抄路线标题而无具体操作仍不算会用。不要从标准答案替学生补缺失操作；若缺失会影响判断，明确指出需要补哪一步，而非笼统说“不足”。忽略不影响路线的小算术笔误，但指出关键恒等变形、结论、适用范围或遗漏解的错误。反馈简洁，用学生能理解的数学理由，不暴露内部ID或连线限制。信息确实不足才返回uncertain。
${routeBased ? 'mathematical_evidence记录支持数学判断的具体原文和理由，student_excerpt必须从学生原文逐字摘出。evidence则用于掌握度：每个方法必须有method_id、scenario_id及具体原文，并只能使用allowed_edges的真实配对。缺少配对时method_ids和evidence可为空，只影响是否记录执行成绩，不改变数学判断。未执行的后续方法不能记证据。' : ''}
${patternContext.length ? 'available_patterns列出本题已核对的具体结构和参考步骤。只有学生原文实际实施了该结构的关键操作，才可在pattern_evidence中记录pattern_id、route_id、step_index、student_excerpt、explanation。不要因为选过路线、写了方法名或参考答案中有后续操作就记结构执行；不能确定则留空。不为结构标签改变数学判断，也不在反馈中暴露这些编号。' : ''}
仅返回JSON：{"outcome":"right|wrong|uncertain","method_ids":["M.xxx"],"feedback":"一句或两句","mathematical_evidence":[{"student_excerpt":"实际操作原文","explanation":"该操作为什么成立或失效"}],"evidence":[{"method_id":"M.xxx","scenario_id":"S.xxx","student_excerpt":"实际操作原文"}],"pattern_evidence":[]}。`;
  const output = json(await streamAnswer({ config, systemPrompt, signal,
    messages: [{ role: 'user', content: JSON.stringify({ question: question.question, reference_solution: question.solution, routes: question.routes,
      allowed_edges: question.allowedEdges, available_patterns: patternContext, steps, methods }) }] }));
  if (!['right', 'wrong', 'uncertain'].includes(output?.outcome) || !nonempty(output.feedback) || !Array.isArray(output.method_ids)
    || output.method_ids.some((id) => typeof id !== 'string') || new Set(output.method_ids).size !== output.method_ids.length) throw routeQuestionError();
  if (!routeBased && output.outcome === 'right' && (!output.method_ids.length || output.method_ids.some((id) => !question.applicableMethodIds.includes(id)))) throw routeQuestionError();
  let executedEdges = [];
  if (output.mathematical_evidence != null && !Array.isArray(output.mathematical_evidence)) throw routeQuestionError();
  const mathematicalEvidence = (output.mathematical_evidence ?? []).map((entry) => {
    if (!nonempty(entry.student_excerpt) || !steps.includes(entry.student_excerpt) || !nonempty(entry.explanation))
      throw routeQuestionError('模型返回的数学判断依据与作答不一致，请重试。');
    return { studentExcerpt: entry.student_excerpt, explanation: entry.explanation.trim() };
  });
  if (routeBased) {
    if (!Array.isArray(output.evidence)) throw routeQuestionError('模型没有返回实际操作证据，请补充步骤后重试。');
    executedEdges = output.evidence.flatMap((entry) => {
      if (!nonempty(entry.student_excerpt) || !steps.includes(entry.student_excerpt)
        || !output.method_ids.includes(entry.method_id)) throw routeQuestionError('模型返回的步骤证据与原文不一致，请重试。');
      if (!question.candidateMethodIds.includes(entry.method_id)
        || !question.allowedEdges?.some((edge) => edge.methodId === entry.method_id && edge.scenarioId === entry.scenario_id)) {
        if (mathematicalEvidence.length) return [];
        throw routeQuestionError('模型没有给出可核对的数学判断依据，请重试。');
      }
      return [{ methodId: entry.method_id, scenarioId: entry.scenario_id, studentExcerpt: entry.student_excerpt }];
    });
    if (!mathematicalEvidence.length && output.method_ids.some((id) => !executedEdges.some((edge) => edge.methodId === id))) throw routeQuestionError('模型漏掉了实际执行证据，请重试。');
  }
  const methodIds = routeBased ? [...new Set(executedEdges.map((edge) => edge.methodId))] : output.method_ids;
  const patternEvidence = validPatternEvidence(question, (Array.isArray(output.pattern_evidence) ? output.pattern_evidence : []).filter((entry) => entry && typeof entry === 'object').map((entry) => ({
    patternId: entry.pattern_id, routeId: entry.route_id, stepIndex: entry.step_index,
    studentExcerpt: entry.student_excerpt, explanation: entry.explanation,
  })), executedEdges, steps);
  if (routeBased && output.outcome !== 'uncertain' && !methodIds.length && !mathematicalEvidence.length)
    throw routeQuestionError('模型没有给出数学判断的具体依据，请重试。');
  return { outcome: output.outcome, methodIds, executedEdges, mathematicalEvidence, patternEvidence,
    mathematicallyValid: output.outcome === 'right', feedback: output.feedback.trim() };
}
