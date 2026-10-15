import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import katex from 'katex';
import { createSkeleton } from '../src/core/skeleton/index.js';
import { prepareRouteQuestion } from '../src/core/practice/routes.js';
import { reviewedMathMarkdown } from '../src/core/practice/reviewedMath.js';
import { withTaskDimensions } from '../src/core/practice/classification.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function formulas(text) {
  const blocks = [];
  const escaped = (i) => { let n = 0; while (i > 0 && text[--i] === '\\') n++; return n % 2 === 1; };
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$' || escaped(i)) continue;
    const width = text[i + 1] === '$' ? 2 : 1, start = i + width;
    let end = start;
    while (end < text.length && !(text[end] === '$' && !escaped(end) && (width === 1 ? text[end + 1] !== '$' : text[end + 1] === '$'))) end++;
    if (end >= text.length) throw new Error('Unclosed formula delimiter.');
    blocks.push(text.slice(start, end)); i = end + width - 1;
  }
  return blocks;
}
export async function readActiveSkeleton() {
  const dir = resolve(root, 'src/assets/skeleton');
  return createSkeleton(Object.fromEntries(await Promise.all((await readdir(dir)).filter((name) => name.endsWith('.json')).map(async (name) => [name, JSON.parse(await readFile(resolve(dir, name), 'utf8'))]))));
}
export async function compileReviewedBank({ bankId, originalRecords, reviews, skeleton, existingBanks = [] }) {
  if (!/^[a-z][a-z0-9_-]{1,48}$/.test(bankId)) throw new Error('bankId must be a stable lowercase namespace, e.g. bank402.');
  const source = new Map(), checked = new Map(), audit = [], questions = [];
  for (const original of originalRecords) {
    if (!original || !['number', 'string'].includes(typeof original.id) || !String(original.id).trim() || source.has(String(original.id))) throw new Error('Original records require unique stable IDs.');
    if (typeof original.text !== 'string' || !original.text.trim()) throw new Error(`Original ${original.id}: empty question text.`);
    source.set(String(original.id), original);
  }
  for (const review of reviews) {
    const id = String(review.originalId);
    if (!source.has(id) || checked.has(id)) throw new Error(`Review ${id}: unknown or repeated original ID.`);
    checked.set(id, review);
  }
  for (const id of source.keys()) if (!checked.has(id)) throw new Error(`Original ${id}: no review disposition.`);
  for (const [id, original] of source) {
    const review = checked.get(id);
    if (!['ready', 'blocked', 'out_of_scope', 'duplicate'].includes(review.disposition)) throw new Error(`Review ${id}: invalid disposition.`);
    if (!review.classificationReason?.trim() || !review.audit?.reasoning?.trim() || !Array.isArray(review.blockers)) throw new Error(`Review ${id}: missing substantive audit/classification evidence.`);
    if (review.entranceScenarioId != null && !skeleton.scenarioById.has(review.entranceScenarioId)) throw new Error(`Review ${id}: classification uses an inactive scenario.`);
    if (!['retained', 'corrected', 'missing_solved', 'unverified'].includes(review.audit.originalAnswerVerdict)) throw new Error(`Review ${id}: invalid answer verdict.`);
    let prepared = null;
    if (review.disposition === 'ready') {
      if (review.audit.status !== 'checked' || review.blockers.length || !review.question || review.audit.originalAnswerVerdict === 'unverified') throw new Error(`Review ${id}: ready item lacks completed mathematical review.`);
      const question = withTaskDimensions(structuredClone(review.question));
      if (question.metadata?.originalRecord && !isDeepStrictEqual(question.metadata.originalRecord, original)) throw new Error(`Review ${id}: originalRecord was modified.`);
      if (question.metadata?.source?.originalId !== original.id || question.metadata?.source?.kind !== 'dataset_import') throw new Error(`Review ${id}: source identity does not match original.`);
      if (question.metadata.motherId !== `candidate.${bankId}.${original.id}`) throw new Error(`Review ${id}: mother identity must use this bank's namespace.`);
      if (question.entranceScenarioId !== review.entranceScenarioId) throw new Error(`Review ${id}: question and review disagree on entrance.`);
      if (/\\tk\s*\{/.test(question.question)) throw new Error(`Review ${id}: answer-fill macro remains in the displayed problem.`);
      // Keep the existing curated source objects exact. New review fields are
      // formatted for KaTeX; original source records and question identity stay intact.
      if (!question.metadata.batchId) {
        question.solution = reviewedMathMarkdown(question.solution);
        for (const route of question.routes) {
          for (const field of ['summary', 'reason', 'condition']) route[field] = reviewedMathMarkdown(route[field]);
          for (const step of route.steps) for (const field of ['state', 'transformedState', 'condition']) step[field] = reviewedMathMarkdown(step[field]);
        }
      }
      question.metadata = { ...question.metadata, originalRecord: structuredClone(original), bankId, originalId: original.id,
        userApprovedClassic: false, reviewStatus: 'worked_example_checked', contentVersion: question.metadata.contentVersion ?? 1,
        answerAudit: { ...question.metadata.answerAudit, originalAnswerPreserved: true, originalAnswerVerdict: review.audit.originalAnswerVerdict,
          reasoning: review.audit.reasoning, validationScope: 'Worked review with separate structural checks; not a formal mathematical proof certificate.' } };
      prepared = await prepareRouteQuestion(question, skeleton);
      // Validate formula syntax in every route, including the distractors.
      const text = [prepared.question, reviewedMathMarkdown(prepared.question), prepared.solution, prepared.comparisonCriterion, ...prepared.routes.flatMap((route) =>
        [route.summary, route.reason, route.condition, ...route.steps.flatMap((step) => [step.state, step.transformedState, step.condition])])];
      for (const value of text) {
        try { for (const expression of formulas(value)) katex.renderToString(expression, { throwOnError: true, strict: 'ignore', trust: false }); }
        catch (error) { throw new Error(`Review ${id}: invalid formula: ${error.message}`); }
      }
      if (questions.some((other) => other.metadata.motherId === prepared.metadata.motherId || other.questionKey === prepared.questionKey)) throw new Error(`Review ${id}: duplicate ready question identity; explicitly record duplicateOf instead.`);
      questions.push(prepared);
    } else {
      if (!review.blockers.length) throw new Error(`Review ${id}: a non-published item needs a specific reason.`);
      if (review.question != null) throw new Error(`Review ${id}: non-ready items must not carry a publishable question.`);
      if (review.disposition === 'duplicate') {
        if (review.duplicateOf && typeof review.duplicateOf === 'object') {
          const parent = review.duplicateOf;
          const canonical = existingBanks.find((bank) => bank.bankId === parent.bankId)?.questions.find((q) => String(q.metadata.source.originalId) === String(parent.originalId));
          if (parent.bankId === bankId || !canonical || canonical.metadata.reviewStatus !== 'worked_example_checked') throw new Error(`Review ${id}: cross-bank duplicate has no reviewed canonical item.`);
        } else {
          const canonical = checked.get(String(review.duplicateOf));
          if (!canonical || String(review.duplicateOf) === id || canonical.disposition !== 'ready') throw new Error(`Review ${id}: duplicate points to an absent/unpublished canonical item.`);
        }
      }
    }
    const group = review.entranceScenarioId ? skeleton.groups.find((entry) => entry.scenario_ids.includes(review.entranceScenarioId)) : null;
    audit.push({ bankId, originalId: original.id, original: structuredClone(original), originalRecordSha256: hash(JSON.stringify(original)),
      disposition: review.disposition, normalizedQuestion: prepared?.question ?? review.normalizedQuestion ?? original.text,
      blockId: review.entranceScenarioId ? skeleton.scenarioById.get(review.entranceScenarioId).block_id : null,
      groupId: group?.id ?? null, entranceScenarioId: review.entranceScenarioId ?? null,
      classificationReason: review.classificationReason, blockers: review.blockers, audit: review.audit,
      task: prepared?.task ?? withTaskDimensions({ question: review.normalizedQuestion ?? original.text }).task,
      overlays: prepared?.overlays ?? [], classificationReview: prepared?.classificationReview ?? { status: 'inferred', needsReview: true, overlaysComplete: false },
      ...(review.disposition === 'duplicate' ? { duplicateOf: review.duplicateOf } : {}),
      ...(prepared ? { questionKey: prepared.questionKey, motherId: prepared.metadata.motherId } : {}) });
  }
  return { schema: 'mathmyth-question-bank/v1', bankId, questions, audit };
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`; await writeFile(temp, content); await rename(temp, path);
}
export async function compileBankFiles({ bankId, sourcePath, reviewDirectory }) {
  const sourceBytes = await readFile(sourcePath);
  const originalRecords = sourceBytes.toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid original JSONL at line ${i + 1}.`); }
  });
  const reviewFiles = (await readdir(reviewDirectory)).filter((name) => /^review-.*\.json$/.test(name)).sort();
  if (!reviewFiles.length) throw new Error('No review-*.json files found.');
  const reviews = (await Promise.all(reviewFiles.map(async (name) => JSON.parse(await readFile(resolve(reviewDirectory, name), 'utf8'))))).flat();
  const skeleton = await readActiveSkeleton();
  const bankDir = resolve(root, 'src/assets/practice/question-banks');
  let existingBanks = [];
  try { existingBanks = await Promise.all((await readdir(bankDir)).filter((name) => name.endsWith('.json') && name !== `${bankId}.json`).map(async (name) => JSON.parse(await readFile(resolve(bankDir, name), 'utf8')))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const compiled = await compileReviewedBank({ bankId, originalRecords, reviews, skeleton, existingBanks });
  const sourceHash = hash(sourceBytes);
  if (hash(await readFile(sourcePath)) !== sourceHash) throw new Error('Source changed during compilation; no bank published.');
  const outputDir = resolve(root, '../题库整理', bankId);
  const publicBank = { schema: compiled.schema, bankId, sourceSha256: sourceHash,
    taxonomy: { blocks: skeleton.blocks.map(({ id, name }) => ({ id, name })), groups: skeleton.groups,
      scenarios: [...skeleton.scenarioById.values()].map(({ id, name, definition, block_id }) => ({ id, name, definition, block_id })) },
    questions: compiled.questions };
  const manifest = { bankId, sourcePath: resolve(sourcePath), sourceSha256: sourceHash, processed: compiled.audit.length,
    dispositions: Object.fromEntries(['ready', 'blocked', 'duplicate', 'out_of_scope'].map((status) => [status, compiled.audit.filter((item) => item.disposition === status).length])),
    originalAnswerVerdicts: Object.fromEntries(['retained', 'corrected', 'missing_solved', 'unverified'].map((status) => [status, compiled.audit.filter((item) => item.audit.originalAnswerVerdict === status).length])),
    entranceScenarios: new Set(compiled.questions.map((item) => item.entranceScenarioId)).size,
    userApprovedClassics: 0, builtAt: new Date().toISOString(), inputReviewFiles: reviewFiles,
    semanticRechecked: compiled.questions.filter(q => q.metadata.semanticReview?.status === 'rechecked').length,
    taskReviewPending: compiled.questions.filter(q => q.classificationReview.needsReview).length,
    validation: { preservedOriginals: true, realPairedEdges: true, formulaSyntax: true, structuralValidationIsNotMathematicalProof: true } };
  const text = ['# 题库逐题审核清单', '', `题库：${bankId}；处理${manifest.processed}条。`, '',
    `可发布${manifest.dispositions.ready}；输入/数学问题隔离${manifest.dispositions.blocked}；重复${manifest.dispositions.duplicate}；超范围${manifest.dispositions.out_of_scope}。`,
    '“可发布”指题面、答案与路线已经逐题处理，经典母题入选仍需用户把关；结构校验本身不能证明数学正确。', ''];
  for (const item of compiled.audit) text.push(`## ${item.originalId} · ${item.disposition}`, '', item.normalizedQuestion, '',
    `入口：${item.entranceScenarioId ?? '未指定'}；分类依据：${item.classificationReason}`, '',
    `原答案处理：${item.audit.originalAnswerVerdict}；${item.audit.reasoning}`, '',
    ...(item.blockers.length ? [`阻止发布：${item.blockers.join('；')}`, ''] : []),
    `原来源：${item.original.source ?? '未提供'}；原记录SHA256：${item.originalRecordSha256}`, '');
  await atomicWrite(resolve(outputDir, 'question-bank.audit.jsonl'), compiled.audit.map((item) => JSON.stringify(item)).join('\n') + '\n');
  await atomicWrite(resolve(outputDir, '逐题审核清单.md'), text.join('\n'));
  await atomicWrite(resolve(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const coverage = [...skeleton.scenarioById.values()].map(scenario => {
    const entrants = compiled.questions.filter(q => q.entranceScenarioId === scenario.id);
    const valid = compiled.questions.filter(q => q.routes.some(r => r.valid && r.steps.some(s => s.scenarioId === scenario.id)));
    const all = compiled.questions.filter(q => q.routes.some(r => r.steps.some(s => s.scenarioId === scenario.id)));
    return { scenarioId: scenario.id, name: scenario.name, blockId: scenario.block_id,
      entranceQuestions: entrants.map(q => q.metadata.originalId), validRouteQuestions: valid.map(q => q.metadata.originalId),
      allRouteQuestions: all.map(q => q.metadata.originalId), hasCoverage: entrants.length > 0 || valid.length > 0 };
  });
  await atomicWrite(resolve(outputDir, 'coverage.json'), JSON.stringify({ bankId, sourceSha256: sourceHash, scope: 'This published bank only; valid-route coverage excludes distractors.',
    scenarios: coverage, zeroCoverage: coverage.filter(c => !c.hasCoverage).map(c => c.scenarioId) }, null, 2) + '\n');
  await atomicWrite(resolve(outputDir, '情景覆盖清单.md'), ['# 情景覆盖清单', '', `题库 ${bankId}；${compiled.questions.length}题，${coverage.length}个启用情景。`,
    '仅统计本题库；有效路线覆盖与干扰路线分开，覆盖不等于已经有足够典型的母题。', '', '|情景|入口题数|有效路线题数|待补题|', '|---|---:|---:|---|',
    ...coverage.map(c => `|${c.name} (${c.scenarioId})|${c.entranceQuestions.length}|${c.validRouteQuestions.length}|${c.hasCoverage ? '' : '是'}|`), ''].join('\n'));
  // Publish only reviewed questions. Raw/blocked input is never pulled into the app bundle.
  await atomicWrite(resolve(root, 'src/assets/practice/question-banks', `${bankId}.json`), JSON.stringify(publicBank, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (key, fallback) => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1]; };
  await compileBankFiles({ bankId: option('--bank-id', 'bank402'),
    sourcePath: resolve(root, option('--source', '../高数题库-402道/question-bank.jsonl')),
    reviewDirectory: resolve(root, option('--reviews', 'src/assets/practice/bank402')) });
}
