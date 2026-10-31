import { useId, useState } from 'react';
import { ChevronDown, ArrowUpRight } from 'lucide-react';
import AnimatedDisclosure from './AnimatedDisclosure.jsx';
import MathMarkdown from './MathMarkdown.jsx';
import { routePresentation } from '../core/chat/questionRoutes.js';
import { useAppStore } from '../store/appStore.js';
import { retryQuestionRoutes } from '../core/db/database.js';

export default function QuestionRoutePanel({ result, skeleton }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const id = useId();
  if (!result || !skeleton) return null;
  if (!result.routes?.length) return <div className="question-route question-route-status">
    {result.status === 'failed' || result.stalled ? <button type="button" className="question-route-toggle" disabled={retrying} onClick={async () => {
      setRetrying(true);setError('');
      try { await retryQuestionRoutes(result.messageId) } catch { setError('暂时无法重新整理，请稍后再试。') }
      finally { setRetrying(false) }
    }}>{retrying ? '正在重新整理…' : '重新整理本题路径'}</button> : <span>{result.status === 'done' ? '尚未匹配本题路径' : '本题路径整理中…'}</span>}
    {error && <span role="status">{error}</span>}
  </div>;
  const ordered = result.ordered;
  const presentations = result.routes.map(route => routePresentation(route, skeleton, ordered));
  const hasChain = ordered && presentations.some(presentation => presentation.paths.some(path =>
    path.stages.length > 1 || path.stages.some(stage => stage.operations?.length > 1)));
  return <div className="question-route" data-no-area-swipe>
    <button type="button" className="question-route-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {open ? '收起' : '查看'}本题{hasChain ? '路径' : ordered ? '情景' : '涉及知识'}<ChevronDown size={14} className={open ? 'is-open' : ''} aria-hidden="true" />
    </button>
    <AnimatedDisclosure open={open} id={id}>
      <div className="question-route-card">
        {result.routes.map((route, routeIndex) => <section className="question-route-group" key={route.question_index}>
          {result.routes.length > 1 && <h3>第 {route.question_index} 题</h3>}
          {presentations[routeIndex].paths.map((path, pathIndex) => <div className="question-route-solution" key={pathIndex}>
            {presentations[routeIndex].paths.length > 1 && <h4>解法 {pathIndex + 1}</h4>}
            <ol className={ordered && path.stages.length > 1 ? 'question-route-steps' : 'question-route-related'}
              aria-label={ordered && path.stages.length > 1 ? '本题路径' : '本题情景'}>
              {path.stages.map((item, index) => <li key={`${item.scenarioId}:${index}`}>
                <span>{item.scenario}</span>{item.operations?.length > 0 ? <ol className="question-route-operations" aria-label={item.operations.length > 1 ? '本情景内的操作顺序' : '本情景中的操作'}>
                  {item.operations.map((operation, operationIndex) => <li key={operationIndex}>
                    <span className="question-route-method">{operation.method || '核对当前情景'}</span>
                    {operation.evidence && <details className="question-route-evidence"><summary>解答依据</summary><MathMarkdown>{operation.evidence}</MathMarkdown></details>}
                  </li>)}
                </ol> : item.methods.length > 0 && (presentations[routeIndex].kind === 'single'
                  ? <ul className="question-route-method-tree" aria-label="本题记录的方法，未单独标注先后">{item.methods.map(method => <li key={method}>{method}</li>)}</ul>
                  : <span className="question-route-method">{item.methods.join(' / ')}</span>)}
              </li>)}
            </ol>
          </div>)}
          <button type="button" className="question-route-locate" onClick={async () => {
            setError('');
            try { await useAppStore.getState().locateQuestionRoute(route, result.messageId) }
            catch { setError('暂时无法定位，请重试。') }
          }}>在足迹中定位<ArrowUpRight size={14} aria-hidden="true" /></button>
        </section>)}
        {error && <p role="status" className="muted">{error}</p>}
      </div>
    </AnimatedDisclosure>
  </div>;
}
