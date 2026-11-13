// 生成"解题思路 → 题目"的轻量索引。
// 目的：点「试一道类似题」时先查这张索引；没有匹配就直接结束，
// 不再为了一个不存在的匹配去加载 5MB 的整本题库。
//
// 产物：src/assets/practice/related-index.js / related-index-hs.js
// 两个文件都由本脚本生成，请勿手改；npm test 与打包前会自动重新生成。
import { writeFileSync } from 'node:fs';
import { preparedRouteTargets as advancedTargets } from '../src/assets/practice/route-bank.js';
import { preparedRouteTargets as highSchoolTargets } from '../src/assets/practice/route-bank-hs.js';

// 与 related.js 里的 signature 完全一致：有序的 [情景, 方法] 序列。
const signatureOf = (steps) => JSON.stringify(steps.map((step) => [step.scenarioId, step.methodId]));

function build(targets, suffix) {
  const indexTargets = [];
  const entries = {};
  const authored = {};
  const bankIds = new Set();
  const seen = new Set();

  targets.forEach((target, targetIndex) => {
    indexTargets.push({
      id: target.id,
      scenarioId: target.scenarioId,
      methodId: target.methodId,
      name: target.name,
      ...(target.batchId ? { batchId: target.batchId } : {}),
      ...(target.blockName ? { blockName: target.blockName } : {}),
      ...(target.primaryScenarioId ? { primaryScenarioId: target.primaryScenarioId } : {}),
      ...(target.primaryQuestionCount ? { primaryQuestionCount: target.primaryQuestionCount } : {}),
      ...(target.groupName ? { groupName: target.groupName } : {}),
      ...(target.presentation ? { presentation: target.presentation } : {}),
    });
    for (const question of target.questions ?? []) {
      if (question?.metadata?.reviewStatus !== 'worked_example_checked') continue;
      const motherId = question.metadata.motherId;
      if (!motherId) continue;
      const bankId = question.metadata.bankId ?? null;
      if (bankId) bankIds.add(bankId);
      else authored[motherId] = question;
      for (const route of question.routes ?? []) {
        if (!route?.valid) continue;
        const signature = signatureOf(route.steps);
        const key = `${signature}\n${targetIndex}\n${motherId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (entries[signature] ??= []).push([targetIndex, motherId, bankId]);
      }
    }
  });

  const loaders = [...bankIds].sort().map((id) =>
    `  ${JSON.stringify(id)}: () => import('./question-banks/${id}.json', { with: { type: 'json' } }),`).join('\n');
  const content = `// 自动生成，请勿手改（node scripts/build-related-index.mjs）。\n`
    + `export const targets = ${JSON.stringify(indexTargets)};\n`
    + `export const entries = ${JSON.stringify(entries)};\n`
    + `export const authored = ${JSON.stringify(authored)};\n`
    + `export const loadBank = {\n${loaders}\n};\n`;
  const file = new URL(`../src/assets/practice/related-index${suffix}.js`, import.meta.url);
  writeFileSync(file, content);
  const questionCount = new Set(Object.values(entries).flat().map((entry) => entry[1])).size;
  return { targets: indexTargets.length, signatures: Object.keys(entries).length, questions: questionCount, bytes: content.length };
}

const advanced = build(advancedTargets, '');
const highSchool = build(highSchoolTargets, '-hs');
console.log('related-index 高数:', JSON.stringify(advanced));
console.log('related-index 高中:', JSON.stringify(highSchool));
