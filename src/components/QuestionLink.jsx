import { useAppStore } from '../store/appStore.js';

export function questionExcerpt(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, 80).join('') + (Array.from(text).length > 80 ? '…' : '');
}
export default function QuestionLink({ item, onClick }) {
  const title = useAppStore((state) => state.conversations.find((entry) => entry.id === item.conversationId)?.title);
  const label = title || questionExcerpt(item.question) || '查看这道题';
  return <button type="button" className="trail-question" onClick={onClick} aria-label={`查看题目：${label}`}><span className="question-link-label">{label}</span></button>;
}
