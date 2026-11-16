import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSkeleton } from './compile-question-bank.mjs';
import katex from 'katex';
import { createPatternIndex, compilePatternLinks } from '../src/core/knowledge/patternSchema.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const archive = resolve(root, '题库整理/knowledge-v2');
const bankDir = resolve(root, 'frontend/src/assets/practice/question-banks');

// 知识关系与具体结构按学科分开：手写源在 knowledge/（高数）与 knowledge/high_school/，
// 运行期产物写进 frontend/src/assets/knowledge/<subject>/。每一步校验都对着**该学科**的骨架，
// 拿高数的数据去校验高中骨架会在第一条上就断链（4.3.2 实机：高中数学本题路径永远出不来）。
const SUBJECTS = ['advanced', 'high_school'];
const sourceDir = (subject) => resolve(root, subject === 'advanced' ? 'knowledge' : 'knowledge/high_school');
const outputDir = (subject) => resolve(root, 'frontend/src/assets/knowledge', subject);

function checkMath(value) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\$([^$]+)\$/gu)) katex.renderToString(match[1], { throwOnError: true, strict: 'ignore', trust: false });
  } else if (Array.isArray(value)) value.forEach(checkMath);
  else if (value && typeof value === 'object') Object.values(value).forEach(checkMath);
}

async function loadQuestions(subject) {
  const names = (await readdir(bankDir)).filter((name) => /^bank.*\.json$/.test(name))
    .filter((name) => (subject === 'high_school' ? name.startsWith('bankhs') : !name.startsWith('bankhs')));
  const banks = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(bankDir, name), 'utf8'))));
  return banks.flatMap((bank) => bank.questions ?? []);
}

// 关系先校验再落盘：断链 / 缺适用配对一律报错，不允许静默写进运行期数据。
function validateRelations(source, skeleton, subject) {
  const seen = new Set();
  for (const r of source.relations) {
    if (source.schema !== 'mathmyth-knowledge-relations/v1') throw new Error('知识关系格式无效。');
    if (seen.has(r.id) || r.review !== 'verified' || !r.conditions?.length || !r.evidence?.length || !r.task?.length
      || ![r.inputState, r.operation, r.output, r.boundary].every((t) => typeof t === 'string' && t.trim())) {
      throw new Error(`Incomplete reviewed relation ${r.id}`);
    }
    seen.add(r.id);
    for (const n of [r.from, r.to]) {
      if (!['method', 'scenario'].includes(n.kind) || !(n.kind === 'method' ? skeleton.methodById : skeleton.scenarioById).has(n.id)) {
        throw new Error(`Broken relation ${r.id}（${subject}）`);
      }
    }
    if (r.type === 'applies_to' && !skeleton.scenarioById.get(r.to.id).methods.some((e) => e.method_id === r.from.id)) {
      throw new Error(`Missing paired edge ${r.id}（${subject}）`);
    }
  }
}

async function compileSubject(subject) {
  const skeleton = await readSkeleton(subject);
  const relations = JSON.parse(await readFile(resolve(sourceDir(subject), 'relations.json'), 'utf8'));
  validateRelations(relations, skeleton, subject);
  await mkdir(outputDir(subject), { recursive: true });
  await writeFile(resolve(outputDir(subject), 'relations.json'), JSON.stringify(relations, null, 2) + '\n');

  const patterns = JSON.parse(await readFile(resolve(sourceDir(subject), 'patterns.json'), 'utf8'));
  createPatternIndex(skeleton, patterns);
  const questions = await loadQuestions(subject);
  const runtime = { ...patterns, questionLinks: compilePatternLinks(skeleton, patterns, questions) };
  createPatternIndex(skeleton, runtime);
  checkMath(runtime.patterns);
  await writeFile(resolve(outputDir(subject), 'patterns.json'), JSON.stringify(runtime, null, 2) + '\n');
  return { subject, relations: relations.relations.length, patterns: runtime.patterns.length,
    patternScenarios: new Set(runtime.patterns.flatMap((p) => p.scenarioIds)).size,
    reviewedSteps: runtime.questionLinks.length, questions: questions.length };
}

const report = [];
for (const subject of SUBJECTS) report.push(await compileSubject(subject));

// 高数那份跨章节候选归档保持原样（只服务高数审查流程）。
await mkdir(archive, { recursive: true });
const lines = (await readFile(resolve(root, '审查输出/跨章节接续候选.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const normalized = lines.map((r) => ({ id: r.record_id, status: r.status, reviewDepth: r.audit_depth,
  needsStructuring: !['input_state', 'task', 'conditions', 'operation', 'output_state_or_fact'].every((k) => Object.hasOwn(r, k)),
  inputState: r.input_state ?? null, task: r.task ?? null, conditions: r.conditions ?? null, operation: r.operation ?? null,
  output: r.output_state_or_fact ?? null, claim: r.mathematical_finding, evidence: r.evidence,
  boundary: r.boundary_or_counterexample, original: r }));
await writeFile(resolve(archive, '候选关系.normalized.json'), JSON.stringify({ runtimeEnabled: false, rows: normalized }, null, 2) + '\n');
console.log(JSON.stringify({ report, candidates: normalized.length,
  needsStructuring: normalized.filter((r) => r.needsStructuring).length }));
