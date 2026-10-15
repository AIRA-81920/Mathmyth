import ModalFrame from './ModalFrame.jsx';
import MathMarkdown from './MathMarkdown.jsx';
export default function QuestionSnapshot({ question, onClose }) {
  return <ModalFrame open={Boolean(question)} titleId="snapshot-title" className="confirm-dialog practice-review" onClose={onClose}>
    <h2 id="snapshot-title">题面摘要</h2><div className="practice-review-content"><MathMarkdown>{question}</MathMarkdown></div>
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>关闭</button></div>
  </ModalFrame>;
}
