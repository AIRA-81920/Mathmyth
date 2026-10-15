CREATE TABLE IF NOT EXISTS learner (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
CREATE TABLE IF NOT EXISTS conversation (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS image (
  id TEXT PRIMARY KEY NOT NULL,
  blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/gif','image/webp'))
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  image_ref TEXT REFERENCES image(id),
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq >= 0),
  status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete','streaming','stopped','error')),
  error TEXT,
  recheck_of TEXT REFERENCES message(id) ON DELETE SET NULL,
  image_corrected INTEGER NOT NULL DEFAULT 0 CHECK(image_corrected IN (0,1)),
  UNIQUE(conversation_id, seq)
);
CREATE TABLE IF NOT EXISTS encounter (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  method_id TEXT,
  is_main INTEGER NOT NULL DEFAULT 0 CHECK(is_main IN (0,1)),
  source TEXT NOT NULL CHECK(source IN ('ask','practice')),
  occurred_at TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
  practice_item_id TEXT REFERENCES practice_item(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mastery (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('scenario','method')),
  target_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('exposed','consolidating','mastered')),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK(success_count >= 0),
  faces TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS practice_run (
  id TEXT PRIMARY KEY NOT NULL,
  learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  method_ids TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS practice_item (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES practice_run(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 3),
  step INTEGER NOT NULL CHECK(step BETWEEN 1 AND 3),
  question TEXT NOT NULL,
  answer TEXT,
  result TEXT CHECK(result IS NULL OR result IN ('right','wrong')),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE TABLE IF NOT EXISTS queue_job (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  payload TEXT,
  created_at TEXT NOT NULL,
  source_message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
  lease_token TEXT,
  next_attempt_at TEXT
);
CREATE TABLE IF NOT EXISTS practice_credit (
  learner_id TEXT NOT NULL REFERENCES learner(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('scenario','method')),
  target_id TEXT NOT NULL,
  question_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (learner_id, target_type, target_id, question_key)
);
CREATE INDEX IF NOT EXISTS conversation_by_learner_updated ON conversation(learner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS message_by_conversation ON message(conversation_id, seq);
CREATE INDEX IF NOT EXISTS message_by_image ON message(image_ref);
CREATE INDEX IF NOT EXISTS encounter_by_learner ON encounter(learner_id, occurred_at);
CREATE INDEX IF NOT EXISTS encounter_by_scenario ON encounter(scenario_id, method_id);
CREATE INDEX IF NOT EXISTS practice_run_by_learner ON practice_run(learner_id, started_at);
CREATE INDEX IF NOT EXISTS queue_job_by_status ON queue_job(status, created_at);
