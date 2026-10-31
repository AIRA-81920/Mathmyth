export function canResumeAnswer(message) {
  if (message.role !== 'assistant' || !(message.content?.trim() || message.reasoningContent?.trim())) return false;
  if (message.status === 'error') return true;
  return message.status === 'stopped' && Boolean(message.error) && message.error !== '已停止接收回答。';
}
