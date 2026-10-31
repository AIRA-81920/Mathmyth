import manifest from '../../assets/practice/reviewed-manifest.json' with { type: 'json' };
import { reviewedQuestionDigest } from './reviewedDigest.js';

// The Worker uses a small shipped digest index, not the multi-megabyte bank.
// Comparing only against a caller-supplied preparedTarget would let that caller
// declare any AI draft reviewed. A matching installed mathematical identity is
// required in addition to the ordinary target/payload consistency checks.
export async function isInstalledReviewedQuestion(question) {
  if (question?.metadata?.reviewStatus !== 'worked_example_checked') return false;
  const allowed = Object.hasOwn(manifest.questions, question.metadata.motherId) ? manifest.questions[question.metadata.motherId] : null;
  if (!Array.isArray(allowed)) return false;
  try { return allowed.includes(await reviewedQuestionDigest(question)); }
  catch { return false; }
}
