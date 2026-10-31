import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readActiveSkeleton } from './compile-question-bank.mjs';
import { preparedRouteTargets } from '../src/assets/practice/route-bank.js';
import { relatedPracticeTargets } from '../src/assets/practice/related-bank.js';
import { reviewedQuestionDigest } from '../src/core/practice/reviewedDigest.js';

export async function buildReviewedManifest() {
  const skeleton = await readActiveSkeleton();
  const questions = {};
  for (const target of [...preparedRouteTargets, ...relatedPracticeTargets]) for (const raw of target.questions) {
    if (raw.metadata?.reviewStatus !== 'worked_example_checked') continue;
    const question = structuredClone(raw);
    for (const route of question.routes) for (const step of route.steps) step.methodId = skeleton.aliases.get(step.methodId) ?? step.methodId;
    const hash = await reviewedQuestionDigest(question);
    if (!hash) throw new Error(`Cannot fingerprint reviewed problem: ${raw.metadata.motherId}`);
    const values = questions[question.metadata.motherId] ??= [];
    if (!values.includes(hash)) values.push(hash);
  }
  return { version: 1, algorithm: 'SHA-256', questions: Object.fromEntries(Object.entries(questions).sort(([a], [b]) => a.localeCompare(b))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = await buildReviewedManifest();
  await writeFile(new URL('../src/assets/practice/reviewed-manifest.json', import.meta.url), JSON.stringify(manifest) + '\n');
  console.log(`Reviewed manifest: ${Object.keys(manifest.questions).length} identities`);
}
