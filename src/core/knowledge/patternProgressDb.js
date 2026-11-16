import { rows } from '../db/validation.js';
import { summarizePatternProgress } from './patterns.js';
import { questionLinksForSubject } from './data.js';

// 具体结构的题目步骤关联按学科取：高中的表现在是空的，就是"没有已核对结构进度"，
// 不会拿高数的快照去套高中题。
export function loadPatternProgress(engine, subject) {
  const db = engine.ensureOpen();
  const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
  const links = questionLinksForSubject(subject);
  const ids = [...new Set(links.map((link) => link.questionId))];
  if (!learnerId || !ids.length) return [];
  const records = rows(db, `SELECT i.question,i.answer FROM practice_item i JOIN practice_run r ON r.id=i.run_id
    WHERE r.learner_id=? AND i.answer IS NOT NULL
      AND json_extract(i.question,'$.metadata.motherId') IN (${ids.map(() => '?').join(',')})`, [learnerId, ...ids]);
  return summarizePatternProgress(records.map((row) => ({ question: JSON.parse(row.question), answer: JSON.parse(row.answer) })), links);
}
