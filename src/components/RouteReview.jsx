import MathMarkdown from './MathMarkdown.jsx';

export default function RouteReview({ question, selectedIds = [], revealed, onReveal, busy }) {
  if (!question.routes) return null;
  const routes = revealed ? question.routes : question.routes.filter((route) => selectedIds.includes(route.id));
  return <section className="route-review" aria-label="路线反馈">
    <h2>{revealed ? '路线与条件' : '你所选的路线'}</h2>
    {routes.map((route) => <div className="route-review-item" key={route.id}>
      <div className="route-review-name"><MathMarkdown>{route.summary}</MathMarkdown></div>
      <div className="muted"><MathMarkdown>{route.valid ? `这条路线可行。${route.reason}` : `第 ${route.failedStep + 1} 个转折失效：${route.reason}`}</MathMarkdown></div>
      {revealed && <><div className="muted"><MathMarkdown>{route.condition}</MathMarkdown></div><ol>{route.steps.map((step, index) => <li key={index}>
        <MathMarkdown>{step.state}</MathMarkdown><div className="muted"><MathMarkdown>{step.condition}</MathMarkdown></div><MathMarkdown>{step.transformedState}</MathMarkdown>
      </li>)}</ol></>}
    </div>)}
    {!revealed && onReveal && <button type="button" className="practice-text-button" disabled={busy} onClick={onReveal}>展开其它路线与关键转折</button>}
  </section>;
}
