export const APPLICATION_ID = 0x4d4d5954;
export const SCHEMA_VERSION = 9;

export const V1_REQUIRED_COLUMNS = {
  learner: ['id', 'display_name', 'created_at'],
  setting: ['key', 'value'],
  conversation: ['id', 'learner_id', 'title', 'created_at', 'updated_at'],
  message: ['id', 'conversation_id', 'role', 'content', 'image_ref', 'created_at', 'seq', 'status', 'error', 'recheck_of', 'image_corrected'],
  image: ['id', 'blob', 'created_at', 'name', 'mime'],
  encounter: ['id', 'learner_id', 'scenario_id', 'method_id', 'is_main', 'source', 'occurred_at'],
  mastery: ['id', 'learner_id', 'target_type', 'target_id', 'state', 'success_count', 'faces', 'updated_at'],
  practice_run: ['id', 'learner_id', 'scenario_id', 'method_ids', 'started_at', 'finished_at'],
  practice_item: ['id', 'run_id', 'seq', 'step', 'question', 'answer', 'result', 'created_at'],
  queue_job: ['id', 'kind', 'conversation_id', 'status', 'attempts', 'payload', 'created_at'],
};

export const V2_REQUIRED_COLUMNS = {
  ...V1_REQUIRED_COLUMNS,
  encounter: [...V1_REQUIRED_COLUMNS.encounter, 'conversation_id', 'message_id'],
  queue_job: [...V1_REQUIRED_COLUMNS.queue_job, 'source_message_id', 'lease_token', 'next_attempt_at'],
};
export const V3_REQUIRED_COLUMNS = {
  ...V2_REQUIRED_COLUMNS,
  encounter: [...V2_REQUIRED_COLUMNS.encounter, 'practice_item_id'],
  practice_credit: ['learner_id', 'target_type', 'target_id', 'question_key', 'created_at'],
};
export const V4_REQUIRED_COLUMNS = {
  ...V3_REQUIRED_COLUMNS,
  conversation: [...V3_REQUIRED_COLUMNS.conversation, 'pinned'],
  encounter: [...V3_REQUIRED_COLUMNS.encounter, 'question_snapshot'],
  practice_run: [...V3_REQUIRED_COLUMNS.practice_run, 'generation_status'],
  document: ['id','name','mime','blob','text','created_at'],
  message_attachment: ['message_id','seq','image_ref','document_ref'],
};
export const V5_REQUIRED_COLUMNS = { ...V4_REQUIRED_COLUMNS, conversation: [...V4_REQUIRED_COLUMNS.conversation, 'method_id', 'title_status'] };
export const V6_REQUIRED_COLUMNS = { ...V5_REQUIRED_COLUMNS, message: [...V4_REQUIRED_COLUMNS.message, 'reasoning_content'] };
export const V7_REQUIRED_COLUMNS = { ...V6_REQUIRED_COLUMNS, personal_note: ['id', 'learner_id', 'content', 'target_type', 'target_id', 'created_at', 'updated_at'] };
export const V8_REQUIRED_COLUMNS = {
  ...V7_REQUIRED_COLUMNS,
  message: [...V7_REQUIRED_COLUMNS.message, 'is_math_question', 'recognized_question', 'question_key', 'superseded', 'revision_of', 'revision_action'],
  starred_question: ['id', 'learner_id', 'question_key', 'source_message_id', 'content', 'recognized_question', 'created_at'],
  starred_question_image: ['starred_question_id', 'seq', 'image_ref'],
};
export const REQUIRED_COLUMNS = { ...V8_REQUIRED_COLUMNS,
  chat_practice: ['run_id', 'item_id', 'conversation_id', 'message_id', 'source_message_id', 'created_at'] };

export const LEGACY_CORE_COLUMNS = Object.fromEntries(
  Object.entries(V1_REQUIRED_COLUMNS).filter(([table]) => ['learner', 'setting', 'conversation', 'message', 'image'].includes(table))
    .map(([table, columns]) => [table, columns.filter((column) => !['seq', 'status', 'error', 'recheck_of', 'image_corrected', 'name', 'mime'].includes(column))]),
);
