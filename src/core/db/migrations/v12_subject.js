// v12：给“入口级”记录加上学科，解决历史会话、进行中练习、复习安排串学科的问题。
// 旧数据全部来自高数，因此默认值 advanced；新数据由写入方显式带上当前学科。
// 情景、方法、接触记录本身不改表：它们的目标 ID 已经带 hs_ 命名空间。

// 迁移要能在“新建库”和“旧库升级”两条路径上重复执行，所以先看列是否存在。
function hasColumn(db, table, column) {
  const info = db.exec(`PRAGMA table_info(${table})`)[0];
  return Boolean(info?.values?.some((row) => row[1] === column));
}

export function migrateV12(db) {
  if (!hasColumn(db, 'conversation', 'subject')) {
    db.run("ALTER TABLE conversation ADD COLUMN subject TEXT NOT NULL DEFAULT 'advanced'");
  }
  if (!hasColumn(db, 'practice_run', 'subject')) {
    db.run("ALTER TABLE practice_run ADD COLUMN subject TEXT NOT NULL DEFAULT 'advanced'");
  }
  // 历史抽屉按“学习者 + 学科 + 更新时间”取列表；练习入口按“学习者 + 学科 + 开始时间”取。
  db.run('CREATE INDEX IF NOT EXISTS conversation_by_subject ON conversation(learner_id,subject,updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS practice_run_by_subject ON practice_run(learner_id,subject,started_at)');
  db.run('PRAGMA user_version=12');
}
