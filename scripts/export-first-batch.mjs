import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { firstBatchTargets } from '../src/assets/practice/route-bank.js';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { prepareRouteQuestion } from '../src/core/practice/routes.js';

const skeletonDirectory = new URL('../src/assets/skeleton/', import.meta.url);
const files = await Promise.all((await readdir(skeletonDirectory)).filter((name) => name.endsWith('.json')).map(async (name) =>
  [name, JSON.parse(await readFile(new URL(name, skeletonDirectory), 'utf8'))]));
const skeleton = createSkeleton(Object.fromEntries(files));
const groupFor = (id) => skeleton.groups.find((group) => group.scenario_ids.includes(id))?.id;
const output = new URL('../../题库整理/首批-极限与导数/', import.meta.url);
await mkdir(output, { recursive: true });
const questions = [];
for (const target of firstBatchTargets) for (const raw of target.questions) {
  const q = await prepareRouteQuestion(raw, skeleton);
  questions.push({ id: q.metadata.source.originalId ?? q.metadata.motherId,
    original: q.metadata.originalRecord ?? null,
    block_id: skeleton.scenarioById.get(q.entranceScenarioId).block_id,
    group_id: groupFor(q.entranceScenarioId), scenario_id: q.entranceScenarioId,
    entry_method_ids: [...new Set(q.routes.filter((r) => r.valid).map((r) => r.steps[0].methodId))],
    root_id: q.metadata.rootId, mother_candidate_id: q.metadata.motherCandidateId,
    training_goal: q.metadata.trainingGoal, training_role: q.metadata.trainingRole,
    text: q.question, verified_answer: q.solution, routes: q.routes,
    source: q.metadata.source, quality: { alignment: 'checked', mathematical_review: 'assistant_worked_and_symbolically_checked',
      classic_selection: 'pending_user', original_preserved: Boolean(q.metadata.originalRecord),
      new_answer: q.metadata.source.kind === 'public_course_problem' },
    variant_policy: { generation_stage: 3, preferred_types: ['改变条件并重新选择路线', '增加转折或组合环节'],
      lineage: '本批为已有题的同目标分组，不宣称原题历史上同源或已生成变式' },
    content_version: q.metadata.contentVersion, question_key: q.questionKey });
}
await writeFile(new URL('question-bank.first-batch.jsonl', output), questions.map((q) => JSON.stringify(q)).join('\n')+'\n');
const lines = ['# 首批母题候选与题链审阅', '',
  '6个同目标题组，每组4题，共24题。原始JSONL不改；17道原题记录完整保留，6道为已有自编样题，1道来自公开中文课程作业并补解。',
  '数学推导与自动辅助核对已完成，经典母题入选仍由用户把关；这些题不冒充第二版教材原题。', '',
  '第三阶段才生成变式：改变条件迫使换路线、增加转折，两种变化可以组合，但须重新核对分类与答案。', ''];
for (const target of firstBatchTargets) {
  lines.push(`## ${target.name}`, '', `候选题根：${target.questions[0].metadata.rootId}；重点母题候选：${target.questions[0].metadata.motherCandidateId}。`, '');
  for (const raw of target.questions) {
    const q = questions.find((entry) => entry.text === raw.question);
    lines.push(`### ${q.id} · ${q.training_role}`, '', q.text, '', `来源：${q.source.url ? `[${q.source.label}](${q.source.url})` : `${q.source.label}；${q.source.reference}`}`, '',
      `入口：${q.scenario_id}；归属：${q.block_id} / ${q.group_id}。`, '', '参考解答：', '', q.verified_answer, '', '路线对照：', '');
    for (const r of q.routes) lines.push(`- ${r.valid ? r.preferred ? '主路线' : '有效替代' : '干扰路线'}：${r.summary}。${r.reason}`,
      ...r.steps.map((step, index) => `  ${index+1}. ${step.state} → ${step.transformedState}；条件：${step.condition}（${step.scenarioId} / ${step.methodId}）`));
    lines.push('');
  }
}
await writeFile(new URL('母题候选审阅.md', output), lines.join('\n'));
console.log(`Exported ${questions.length} existing questions in ${firstBatchTargets.length} roots, with original records and reviewed route data.`);
