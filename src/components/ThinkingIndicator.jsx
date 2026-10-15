import '../styles/thinking-indicator.css';

export default function ThinkingIndicator({ label = '正在想' }) {
  return <span className="thinking-indicator" role="status">
    <span>{label}</span>
    <span className="thinking-indicator-dots" aria-hidden="true"><span /><span /><span /></span>
  </span>;
}
