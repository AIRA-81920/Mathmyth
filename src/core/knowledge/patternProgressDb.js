import data from '../../assets/knowledge/patterns.json' with { type: 'json' };
import { rows } from '../db/validation.js';
import { summarizePatternProgress } from './patterns.js';

export function loadPatternProgress(engine) {
  const db = engine.ensureOpen();
  const learnerId = rows(db, 'SELECT id FROM learner ORDER BY created_at,id LIMIT 1')[0]?.id;
  const ids = [...new Set(data.questionLinks.map((link) => link.questionId))];
  if (!learnerId || !ids.length) return [];
  const records = rows(db, `SELECT i.question,i.answer FROM practice_item i JOIN practice_run r ON r.id=i.run_id
    WHERE r.learner_id=? AND i.answer IS NOT NULL
      AND json_extract(i.question,'$.metadata.motherId') IN (${ids.map(() => '?').join(',')})`, [learnerId, ...ids]);
  return summarizePatternProgress(records.map((row) => ({ question: JSON.parse(row.question), answer: JSON.parse(row.answer) })));
}
